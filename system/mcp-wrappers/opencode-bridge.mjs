#!/usr/bin/env node
/**
 * OpenCode MCP bridge for Claude Code.
 *
 * Exposes one tool, `delegate`, which runs `opencode run --format json` in a
 * project directory and returns the final answer plus session/cost metadata.
 *
 * Design notes:
 * - The prompt goes through stdin, so it is not limited by the Windows
 *   command-line length (~32k characters).
 * - OpenCode uses its normal shared background service, so sessions started
 *   here are visible in the OpenCode desktop app.
 * - No dependencies: plain JSON-RPC over stdio, same shape as the other
 *   wrappers in this directory.
 */
import readline from "node:readline";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_NAME = "opencode";
const VERSION = "1.0.0";
const HOME = process.env.USERPROFILE || os.homedir();
const DATA_DIR = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "opencode", "claude-bridge")
  : path.join(HOME, ".local", "share", "opencode", "claude-bridge");
const STATE_FILE = path.join(DATA_DIR, "sessions.json");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const LOG_FILE = path.join(DATA_DIR, "bridge.log");

const MAX_TEXT_CHARS = 24000;
const MAX_TOOL_ITEMS = 12;
const MAX_STDERR_CHARS = 2000;

fs.mkdirSync(DATA_DIR, { recursive: true });

function rotateLog() {
  try {
    if (fs.statSync(LOG_FILE).size > 1024 * 1024) {
      fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    }
  } catch {}
}

rotateLog();

function log(...parts) {
  try {
    fs.appendFileSync(
      LOG_FILE,
      `[${new Date().toISOString()}] ${parts.map((p) => String(p)).join(" ")}\n`,
      "utf8"
    );
  } catch {}
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const config = readJson(CONFIG_FILE, {});
const DEFAULT_MODEL =
  process.env.OPENCODE_DELEGATE_MODEL || config.model || "opencode/deepseek-v4.1-flash-free";
const DEFAULT_TIMEOUT_SEC = clampInt(
  process.env.OPENCODE_DELEGATE_TIMEOUT || config.timeoutSec || 900,
  10,
  3600
);
const DEFAULT_AUTO =
  process.env.OPENCODE_DELEGATE_AUTO !== undefined
    ? !/^(0|false|no)$/i.test(process.env.OPENCODE_DELEGATE_AUTO)
    : config.auto !== false;

function clampInt(value, min, max) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/* ------------------------------------------------------------------ */
/* CLI discovery                                                       */
/* ------------------------------------------------------------------ */

function findCli() {
  const candidates = [
    process.env.OPENCODE_CLI,
    config.cli,
    path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "ai.opencode.desktop",
      "resources",
      "opencode-cli.exe"
    ),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "opencode", "opencode.exe"),
    path.join(process.env.APPDATA || "", "npm", "opencode.cmd"),
    path.join(HOME, ".cache", "opencode", "bin", "opencode.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  try {
    const out = execFileSync("where.exe", ["opencode"], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first) return first;
  } catch {}

  return "opencode";
}

const CLI = findCli();
log("bridge started", `version=${VERSION}`, `cli=${CLI}`, `model=${DEFAULT_MODEL}`);

/* ------------------------------------------------------------------ */
/* Session state (last session per working directory)                  */
/* ------------------------------------------------------------------ */

function cwdKey(cwd) {
  const resolved = path.resolve(cwd);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function readState() {
  const state = readJson(STATE_FILE, {});
  return state && typeof state === "object" ? state : {};
}

function writeState(state) {
  try {
    const entries = Object.entries(state)
      .sort((a, b) => (b[1]?.at || 0) - (a[1]?.at || 0))
      .slice(0, 100);
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(entries), null, 2), "utf8");
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    log("state write failed", e.message);
  }
}

function rememberSession(cwd, sessionID) {
  if (!sessionID) return;
  const state = readState();
  state[cwdKey(cwd)] = { id: sessionID, cwd: path.resolve(cwd), at: Date.now() };
  writeState(state);
}

function lastSession(cwd) {
  return readState()[cwdKey(cwd)] || null;
}

/* ------------------------------------------------------------------ */
/* Spawning OpenCode                                                   */
/* ------------------------------------------------------------------ */

function quoteCmdArg(arg) {
  if (!/[\s"&|<>^]/.test(arg)) return arg;
  return '"' + String(arg).replace(/"/g, '""') + '"';
}

function spawnSpec(args) {
  if (/\.(cmd|bat)$/i.test(CLI)) {
    const comspec = process.env.ComSpec || "cmd.exe";
    return {
      command: comspec,
      args: ["/d", "/s", "/c", [CLI, ...args].map(quoteCmdArg).join(" ")],
    };
  }
  return { command: CLI, args };
}

function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {}
  }
  try {
    child.kill("SIGKILL");
  } catch {}
}

/**
 * Run one OpenCode turn.
 * Returns a plain object; never throws for normal failures.
 */
function runOpenCode(options) {
  const {
    prompt,
    cwd,
    model,
    agent,
    sessionID,
    fork,
    title,
    auto,
    files,
    timeoutSec,
    progressToken,
    onSpawn,
  } = options;

  return new Promise((resolve) => {
    const args = ["run", "--format", "json"];
    if (model) args.push("--model", model);
    if (agent) args.push("--agent", agent);
    if (sessionID) args.push("--session", sessionID);
    if (fork) args.push("--fork");
    if (title) args.push("--title", title);
    if (auto) args.push("--auto");
    for (const file of files) args.push("--file", file);

    const spec = spawnSpec(args);
    const started = Date.now();
    let child;
    try {
      child = spawn(spec.command, spec.args, {
        cwd,
        env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({
        isError: true,
        error: `не удалось запустить OpenCode (${CLI}): ${e.message}`,
        cwd,
        durationSec: 0,
        tools: [],
        text: "",
        stderr: "",
        sessionID: "",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        timedOut: false,
      });
      return;
    }

    onSpawn?.(child);

    const textParts = new Map();
    const textOrder = [];
    const toolParts = new Map();
    let sessionFromEvents = "";
    let cost = 0;
    const tokens = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    const stderrLines = [];
    const rawTail = [];
    let timedOut = false;
    let settled = false;
    let lastProgressAt = 0;
    let progressCount = 0;
    let lastToolTitle = "";
    let stepCount = 0;

    function sendProgress(message, force = false) {
      if (progressToken === undefined || progressToken === null) return;
      const now = Date.now();
      if (!force && now - lastProgressAt < 700) return;
      lastProgressAt = now;
      progressCount += 1;
      send({
        jsonrpc: "2.0",
        method: "notifications/progress",
        params: {
          progressToken,
          progress: progressCount,
          message,
        },
      });
    }

    const stdoutRl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    stdoutRl.on("line", (line) => {
      if (!line.trim()) return;
      rawTail.push(line);
      if (rawTail.length > 40) rawTail.shift();

      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }

      if (event.sessionID && !sessionFromEvents) sessionFromEvents = event.sessionID;
      const part = event.part;
      if (part?.sessionID && !sessionFromEvents) sessionFromEvents = part.sessionID;

      if (part?.type === "text" && typeof part.text === "string") {
        const key =
          part.id ||
          part.partID ||
          (part.messageID ? `msg:${part.messageID}` : `anon:${textOrder.length}`);
        if (!textParts.has(key)) textOrder.push(key);
        const previous = textParts.get(key) || "";
        if (part.text.startsWith(previous) || !previous) {
          textParts.set(key, part.text);
        } else if (!previous.endsWith(part.text)) {
          textParts.set(key, previous + part.text);
        }
      }

      if (part?.type === "tool") {
        const key = part.id || part.partID || `${part.tool}:${toolParts.size}`;
        toolParts.set(key, {
          tool: part.tool || "tool",
          title: part.state?.title || "",
          status: part.state?.status || "",
        });
        const label = part.state?.title || part.tool || "tool";
        if (label !== lastToolTitle) {
          lastToolTitle = label;
          sendProgress(`OpenCode: ${label}`);
        }
      }

      if (part?.type === "step-start") {
        stepCount += 1;
        sendProgress(`OpenCode: шаг ${stepCount}`);
      }

      if (part?.type === "step-finish") {
        if (Number.isFinite(part.cost)) cost += part.cost;
        const t = part.tokens || {};
        tokens.input += Number(t.input) || 0;
        tokens.output += Number(t.output) || 0;
        tokens.reasoning += Number(t.reasoning) || 0;
        tokens.cacheRead += Number(t.cache?.read) || 0;
        tokens.cacheWrite += Number(t.cache?.write) || 0;
        sendProgress("OpenCode: шаг завершён");
      }

      if (event.type === "error" || part?.type === "error") {
        const message =
          event.error?.message ||
          part?.error?.message ||
          part?.text ||
          (typeof event.error === "string" ? event.error : "");
        if (message) stderrLines.push(String(message));
      }
    });

    child.stderr.on("data", (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (!line.trim()) continue;
        stderrLines.push(line);
        if (stderrLines.length > 80) stderrLines.shift();
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        isError: true,
        error: `OpenCode не запустился: ${error.message}\nCLI: ${CLI}`,
        cwd,
        durationSec: (Date.now() - started) / 1000,
        tools: [],
        text: "",
        stderr: stderrLines.slice(-20).join("\n"),
        sessionID: sessionFromEvents,
        cost,
        tokens,
        timedOut: false,
      });
    });

    const timer = setTimeout(() => {
      timedOut = true;
      sendProgress(`OpenCode: таймаут ${timeoutSec}s, останавливаю`, true);
      killTree(child);
    }, timeoutSec * 1000);

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const texts = textOrder.map((key) => textParts.get(key)).filter(Boolean);
      const text = texts.join("\n\n").trim();
      const tools = [...toolParts.values()]
        .filter((t) => t.status !== "pending")
        .slice(0, MAX_TOOL_ITEMS)
        .map((t) => {
          const label = t.title && t.title !== t.tool ? `${t.tool}(${t.title})` : t.tool;
          return t.status && t.status !== "completed" ? `${label}[${t.status}]` : label;
        });

      const stderrTail = stderrLines.join("\n").slice(-MAX_STDERR_CHARS);
      const isError = timedOut || code !== 0 || (!text && stderrLines.length > 0);

      let error = "";
      if (timedOut) {
        error =
          `таймаут ${timeoutSec}s. Процесс остановлен, но сессия OpenCode сохранена: ` +
          `продолжи её через session="${sessionFromEvents || "last"}".`;
      } else if (code !== 0) {
        error = `OpenCode завершился с кодом ${code}${signal ? ` (${signal})` : ""}.`;
      }

      if (sessionFromEvents) rememberSession(cwd, sessionFromEvents);

      log(
        "delegate finished",
        `code=${code}`,
        `signal=${signal || "-"}`,
        `session=${sessionFromEvents || "-"}`,
        `duration=${((Date.now() - started) / 1000).toFixed(1)}s`,
        `tools=${tools.length}`,
        `text=${text.length}`
      );

      resolve({
        isError,
        error,
        cwd,
        durationSec: (Date.now() - started) / 1000,
        tools,
        text,
        stderr: isError ? stderrTail : "",
        sessionID: sessionFromEvents,
        cost,
        tokens,
        timedOut,
      });
    });

    child.stdin.on("error", (e) => log("stdin error", e.message));
    try {
      child.stdin.write(prompt, "utf8");
      child.stdin.end();
    } catch (e) {
      log("failed to write prompt", e.message);
      killTree(child);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Tool definition                                                     */
/* ------------------------------------------------------------------ */

const DELEGATE_TOOL = {
  name: "delegate",
  description:
    "Делегировать задачу в OpenCode — отдельный агент со своими инструментами, сессией и моделью. " +
    "OpenCode работает в указанной папке: читает и правит файлы, запускает команды, ищет по репозиторию. " +
    "Инструмент возвращает финальный ответ, id сессии, стоимость и список использованных инструментов. " +
    "По умолчанию создаётся новая сессия; передай session=\"last\" или id из прошлого вызова, чтобы продолжить. " +
    "Промпт должен быть самодостаточным: OpenCode не видит диалог Claude. " +
    `Модель по умолчанию: ${DEFAULT_MODEL}.`,
  inputSchema: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description:
          "Полная задача с контекстом, путями и критериями готовности. OpenCode не видит историю Claude.",
      },
      cwd: {
        type: "string",
        description:
          "Рабочая папка OpenCode. По умолчанию — корень проекта Claude (CLAUDE_PROJECT_DIR) или текущая папка.",
      },
      session: {
        type: "string",
        description:
          'Новая сессия: "new" (по умолчанию). Продолжить последнюю сессию в этой папке: "last". Либо конкретный id "ses_...".',
      },
      model: {
        type: "string",
        description:
          `Модель в формате provider/model, например ${DEFAULT_MODEL}. Значение "default" — модель OpenCode по умолчанию.`,
      },
      agent: { type: "string", description: "Необязательный agent OpenCode (например, build или plan)." },
      files: {
        type: "array",
        items: { type: "string" },
        description: "Необязательные файлы для прикрепления к сообщению (абсолютные или относительно cwd).",
      },
      title: { type: "string", description: "Необязательный заголовок сессии." },
      fork: {
        type: "boolean",
        description: "Форкнуть сессию перед продолжением (работает вместе с session).",
      },
      auto: {
        type: "boolean",
        description:
          "Автоматически разрешать запросы прав OpenCode (по умолчанию true). Явные запреты в конфиге OpenCode продолжают действовать.",
      },
      timeout_sec: {
        type: "integer",
        minimum: 10,
        maximum: 3600,
        description: `Таймаут, сек. По умолчанию ${DEFAULT_TIMEOUT_SEC}, максимум 3600.`,
      },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

/* ------------------------------------------------------------------ */
/* MCP plumbing                                                        */
/* ------------------------------------------------------------------ */

const send = (message) => {
  process.stdout.write(JSON.stringify(message) + "\n");
};

const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

const active = new Map();

function resolveModel(value) {
  const model = typeof value === "string" ? value.trim() : "";
  if (!model) return DEFAULT_MODEL === "default" ? "" : DEFAULT_MODEL;
  if (model === "default") return "";
  return model;
}

function resolveCwd(value) {
  const raw = (typeof value === "string" && value.trim()) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cwd = path.resolve(raw);
  let stat;
  try {
    stat = fs.statSync(cwd);
  } catch {
    throw new Error(`рабочая папка не существует: ${cwd}`);
  }
  if (!stat.isDirectory()) throw new Error(`cwd не является папкой: ${cwd}`);
  return cwd;
}

function resolveSession(value, cwd) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw === "new") return { sessionID: "", fork: false };
  if (/^(last|continue|продолжить)$/i.test(raw)) {
    const record = lastSession(cwd);
    if (!record?.id) {
      throw new Error(
        `в папке ${cwd} ещё нет сессии OpenCode. Сначала вызови delegate с session="new".`
      );
    }
    return { sessionID: record.id, fork: false };
  }
  if (!/^ses_[A-Za-z0-9]+$/.test(raw)) {
    throw new Error(`неверный session id: ${raw}. Ожидается "new", "last" или "ses_...".`);
  }
  return { sessionID: raw, fork: false };
}

async function handleDelegate(args, meta) {
  if (!args || typeof args !== "object") throw new Error("аргументы не переданы");
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) throw new Error("пустой prompt");

  const cwd = resolveCwd(args.cwd);
  const { sessionID, fork: sessionFork } = resolveSession(args.session, cwd);
  const model = resolveModel(args.model);
  const agent = typeof args.agent === "string" && args.agent.trim() ? args.agent.trim() : "";
  const files = Array.isArray(args.files)
    ? args.files
        .filter((f) => typeof f === "string" && f.trim())
        .slice(0, 10)
        .map((f) => (path.isAbsolute(f) ? f : path.resolve(cwd, f)))
    : [];
  for (const file of files) {
    if (!fs.existsSync(file)) throw new Error(`файл не найден: ${file}`);
  }

  const timeoutSec = clampInt(args.timeout_sec ?? DEFAULT_TIMEOUT_SEC, 10, 3600);
  const auto = args.auto === undefined ? DEFAULT_AUTO : Boolean(args.auto);
  const fork = Boolean(args.fork) || sessionFork;
  const explicitTitle =
    typeof args.title === "string" && args.title.trim() ? args.title.trim() : "";
  const title =
    explicitTitle || (sessionID ? "" : `Claude: ${prompt.replace(/\s+/g, " ").slice(0, 80)}`);

  const result = await runOpenCode({
    prompt,
    cwd,
    model,
    agent,
    sessionID,
    fork,
    title,
    auto,
    files,
    timeoutSec,
    progressToken: meta?.progressToken,
    onSpawn: (child) => {
      active.set(String(meta?.requestId), child);
    },
  });

  const header = [];
  header.push(`opencode: ${result.isError ? "ошибка" : "готово"}`);
  if (result.sessionID) header.push(`session: ${result.sessionID}`);
  header.push(`cwd: ${result.cwd}`);
  header.push(`model: ${model || "default"}`);
  const tokenInfo =
    result.tokens.input || result.tokens.output
      ? ` · tokens: ${result.tokens.input} in / ${result.tokens.output} out`
      : "";
  header.push(
    `time: ${result.durationSec.toFixed(1)}s · cost: ${
      result.cost ? "$" + result.cost.toFixed(4) : "0"
    }${tokenInfo}`
  );
  if (result.tools.length) header.push(`tools: ${result.tools.join(", ")}`);
  if (result.timedOut) header.push(`timeout: ${timeoutSec}s`);

  let body = result.text || "(текстового ответа нет)";
  if (body.length > MAX_TEXT_CHARS) {
    body =
      body.slice(0, MAX_TEXT_CHARS) +
      `\n\n[...обрезано ${body.length - MAX_TEXT_CHARS} символов; полный текст в сессии ${result.sessionID || "OpenCode"}]`;
  }

  let text = header.join("\n") + "\n---\n" + body;
  if (result.error) text += "\n\nОшибка: " + result.error;
  if (result.stderr) text += "\n\nstderr (хвост):\n" + result.stderr;

  if (result.sessionID) rememberSession(cwd, result.sessionID);
  return { text, isError: result.isError };
}

readline
  .createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = message;
    if (id === undefined) {
      if (method === "notifications/cancelled") {
        const requestId = params?.requestId;
        const child = active.get(String(requestId));
        if (child) {
          log("cancel requested", `id=${requestId}`);
          killTree(child);
        }
      }
      return;
    }

    (async () => {
      try {
        if (method === "initialize") {
          reply(id, {
            protocolVersion: params?.protocolVersion || "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: SERVER_NAME, version: VERSION },
            instructions:
              "Инструмент delegate запускает OpenCode в папке проекта. Используй его для делегирования " +
              "самодостаточных задач по коду. Возвращай пользователю session id и стоимость.",
          });
          return;
        }
        if (method === "ping") {
          reply(id, {});
          return;
        }
        if (method === "tools/list") {
          reply(id, { tools: [DELEGATE_TOOL] });
          return;
        }
        if (method === "resources/list") {
          reply(id, { resources: [] });
          return;
        }
        if (method === "prompts/list") {
          reply(id, { prompts: [] });
          return;
        }
        if (method === "tools/call") {
          const name = params?.name;
          if (name !== "delegate") {
            fail(id, -32602, `неизвестный инструмент: ${name}`);
            return;
          }
          try {
            const result = await handleDelegate(params?.arguments || {}, {
              requestId: id,
              progressToken: params?._meta?.progressToken,
            });
            reply(id, {
              content: [{ type: "text", text: result.text }],
              isError: result.isError || undefined,
            });
          } catch (e) {
            log("delegate error", e.message);
            reply(id, {
              content: [{ type: "text", text: "OpenCode: " + e.message }],
              isError: true,
            });
          } finally {
            active.delete(String(id));
          }
          return;
        }
        fail(id, -32601, `метод не поддерживается: ${method}`);
      } catch (e) {
        log("protocol error", e.message);
        fail(id, -32603, e.message);
      }
    })();
  });

function shutdown() {
  for (const child of active.values()) killTree(child);
  process.exit(0);
}

process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

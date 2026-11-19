// jev-gate.js: барьер на Sonnet-субагенты, учёт разрешений jev_classify и подсказки по jev.
// PreToolUse: барьер на тулы Agent и Task (пропуск только по allowlist/haiku, строке причины и разрешениям jev).
// PostToolUse: выдача разрешений по mcp__jev__jev_classify; подсказки bigout, web, agent.
// UserPromptSubmit: подсказка bg при завершении фоновой работы (<task-notification>).
// Журнал: <state>/jev-gate-log.jsonl.
// Переменные: JEVGATE_TMP_DIR, JEVGATE_STATE_DIR, JEVGATE_NOW.
const fs = require('fs');
const os = require('os');
const path = require('path');

let isServiceMessage = () => false;
try {
  const ctxLib = require(path.join(__dirname, 'ctx-lib.js'));
  if (typeof ctxLib.isServiceMessage === 'function') {
    isServiceMessage = ctxLib.isServiceMessage;
  }
} catch {}

const GRANT_MS = 30 * 60 * 1000;
const NUDGE_MS = 10 * 60 * 1000;
const BIG_OUT = 8000;
const VALVE = 3;
const SAMPLE_MAX = 3;

const ALLOWED_SUBAGENT_TYPES = new Set([
  'Explore',
  'Plan',
  'web-fetch',
  'claude-code-guide',
  'statusline-setup',
  'brief-interviewer',
  'opencode',
]);

const REASON_RE = /^[ \t]*Почему не Flash:[ \t]*(новая-логика|дизайн|Flash-сбой|слово-владельца)(?![\p{L}\p{N}_-])/imu;
const CLASSIFY_CLASS_RE = /classification\\*"\s*:\s*\\*"([^"\\]+)/g;
const GRANT_CLASSES_RE = /^(claude_субагенты|opus|worker)$/i;

const DENY_NO_CODE =
  'ОТКАЗ jev-gate: запуск Sonnet-субагента без строки причины. ' +
  'Тест спеки: если задание записывается как «файл, что поменять, как проверить» без слов «придумай, выбери, спроектируй» — ' +
  'это Flash через agy-run, даже если код важный. Нужен именно Sonnet: добавь в промпт отдельную строку «Почему не Flash: <код>», ' +
  'код из списка: новая-логика, дизайн, Flash-сбой, слово-владельца. Для новая-логика и дизайн сначала jev_classify по карточке и самой спеке, ' +
  'не по названию задачи; каталог классов в skills/model-advisor, раздел 2.';

const DENY_NO_GRANT = (code) =>
  `ОТКАЗ jev-gate: нет разрешения jev на «${code}». ` +
  'Сначала jev_classify по карточке и спеке, каталог классов в skills/model-advisor, раздел 2. ' +
  'Разрешение дают только классы claude_субагенты и opus; если jev ответил agy_flash — отдай задачу Flash через agy-run. ' +
  'Причина Flash-сбой или слово-владельца проходит без jev, но только если она настоящая.';

const NUDGE_TEXT = {
  bigout:
    'jev-gate: длинный вывод, больше 8000 знаков. ' +
    'Не читай и не пересказывай его сама: jev_extract достаёт значения, jev_classify раскладывает по классам.',
  web:
    'jev-gate: получен внешний текст. ' +
    'Перед действием по нему jev_screen; отбор из больше чем 5 найденных — jev_rerank.',
  agent:
    'jev-gate: результат субагента получен. ' +
    'Приёмка jev_verify или jev_gate против диска и диффа, отчёту агента не верить.',
  bg:
    'jev-gate: пришёл результат фоновой работы. ' +
    'Приёмка по диску: jev_verify или jev_gate против файла и диффа; отчёту агента и коду возврата 0 не верить.',
};

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function out(event, extra) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...extra } }));
}

function normalizeCode(raw) {
  const l = String(raw || '').toLowerCase();
  if (l === 'flash-сбой') return 'Flash-сбой';
  if (l === 'слово-владельца') return 'слово-владельца';
  if (l === 'новая-логика') return 'новая-логика';
  if (l === 'дизайн') return 'дизайн';
  return raw;
}

function main(inp) {
  const TMP_DIR = process.env.JEVGATE_TMP_DIR || os.tmpdir();
  const STATE_DIR = process.env.JEVGATE_STATE_DIR || path.join(os.homedir(), '.claude', 'state');
  const now = process.env.JEVGATE_NOW ? Number(process.env.JEVGATE_NOW) : Date.now();

  const sid = String((inp && inp.session_id) || 'nosession').replace(/[^\w-]/g, '');
  const log = (o) => {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.appendFileSync(
        path.join(STATE_DIR, 'jev-gate-log.jsonl'),
        JSON.stringify({ ts: new Date(now).toISOString(), sid, ...o }) + '\n'
      );
    } catch {}
  };

  try {
    if (inp.agent_id || /[\\/]subagents[\\/]/.test(String(inp.transcript_path || ''))) {
      return;
    }

    const stFile = path.join(TMP_DIR, `claude-jevgate-${sid}.json`);
    const st = {
      grants: 0,
      grantUntil: 0,
      denials: {},
      samples: 0,
      nudgedAt: {},
      ...(readJson(stFile) || {}),
    };
    if (!st.denials || typeof st.denials !== 'object') st.denials = {};
    if (!st.nudgedAt || typeof st.nudgedAt !== 'object') st.nudgedAt = {};

    const save = () => {
      try {
        fs.mkdirSync(path.dirname(stFile), { recursive: true });
        fs.writeFileSync(stFile, JSON.stringify(st));
      } catch {}
    };

    const ev = inp.hook_event_name;
    const tool = String(inp.tool_name || '');
    const ti = inp.tool_input || {};

    // Роль Г. Фоновая работа (UserPromptSubmit)
    if (ev === 'UserPromptSubmit') {
      const prompt = String(inp.prompt || '');
      if (isServiceMessage(prompt) && prompt.includes('<task-notification>')) {
        const last = st.nudgedAt.bg || 0;
        if (now - last >= NUDGE_MS) {
          st.nudgedAt.bg = now;
          save();
          log({ ev: 'nudge', kind: 'bg' });
          out(ev, { additionalContext: NUDGE_TEXT.bg });
        }
      }
      return;
    }

    // Роль Б. Выдача разрешений (PostToolUse на mcp__jev__jev_classify)
    if (ev === 'PostToolUse' && (tool === 'mcp__jev__jev_classify' || tool === 'jev_classify')) {
      const resp = inp.tool_response;
      const s = typeof resp === 'string' ? resp : JSON.stringify(resp ?? '');
      const shape = Array.isArray(resp) ? 'array' : typeof resp;

      const classes = [];
      const re = new RegExp(CLASSIFY_CLASS_RE.source, 'g');
      let m;
      while ((m = re.exec(s)) !== null) {
        classes.push(m[1]);
      }

      let granted = 0;
      if (classes.length === 0) {
        granted = 2;
        log({ ev: 'unparsed', shape });
      } else {
        const n = classes.filter((c) => GRANT_CLASSES_RE.test(c)).length;
        granted = n;
        log({ ev: 'grant', n, total: classes.length, classes });
      }

      if (now >= (st.grantUntil || 0)) {
        st.grants = 0;
      }
      st.grants += granted;
      st.grantUntil = now + GRANT_MS;
      save();

      if ((st.samples || 0) < SAMPLE_MAX) {
        st.samples = (st.samples || 0) + 1;
        save();
        log({ ev: 'classify-sample', shape, sample: s.slice(0, 400) });
      }
      return;
    }

    // Роль В. Подсказки в нужный момент (PostToolUse)
    if (ev === 'PostToolUse') {
      const resp = inp.tool_response;
      const s = typeof resp === 'string' ? resp : JSON.stringify(resp ?? '');

      let kind = null;
      if ((tool === 'Bash' || tool === 'PowerShell') && s.length > BIG_OUT) {
        kind = 'bigout';
      } else if (tool === 'WebFetch' || tool === 'WebSearch') {
        kind = 'web';
      } else if (tool === 'Agent' || tool === 'Task') {
        kind = 'agent';
      }

      if (kind) {
        const last = st.nudgedAt[kind] || 0;
        if (now - last >= NUDGE_MS) {
          st.nudgedAt[kind] = now;
          save();
          log({ ev: 'nudge', kind });
          out(ev, { additionalContext: NUDGE_TEXT[kind] });
        }
      }
      return;
    }

    // Роль А. Барьер на тул Agent (PreToolUse)
    if (ev === 'PreToolUse' && (tool === 'Agent' || tool === 'Task')) {
      const subagentType = ti.subagent_type;
      const model = String(ti.model || '');

      if (subagentType && ALLOWED_SUBAGENT_TYPES.has(subagentType)) {
        log({ ev: 'pass', why: 'allowlist' });
        return;
      }
      if (/haiku/i.test(model)) {
        log({ ev: 'pass', why: 'haiku' });
        return;
      }

      const promptText = String(ti.prompt || '');
      const match = promptText.match(REASON_RE);

      const key = sid + '|' + ((ti && ti.description) || promptText.slice(0, 80));

      const deny = (why, code, reasonText) => {
        if ((st.denials[key] || 0) >= VALVE) {
          save();
          log({ ev: 'valve', key });
          return;
        }
        st.denials[key] = (st.denials[key] || 0) + 1;
        save();
        log({ ev: 'deny', why, ...(code ? { code } : {}) });
        out('PreToolUse', {
          permissionDecision: 'deny',
          permissionDecisionReason: reasonText,
        });
      };

      if (!match) {
        deny('no_code', null, DENY_NO_CODE);
        return;
      }

      const code = normalizeCode(match[1]);

      if (code === 'Flash-сбой' || code === 'слово-владельца') {
        log({ ev: 'pass', why: 'код', code });
        return;
      }

      if (code === 'новая-логика' || code === 'дизайн') {
        const hasGrant = (st.grants || 0) > 0 && now < (st.grantUntil || 0);
        if (hasGrant) {
          st.grants -= 1;
          save();
          log({ ev: 'pass', why: 'grant' });
          return;
        }
        deny('no_grant', code, DENY_NO_GRANT(code));
        return;
      }

      deny('no_code', code, DENY_NO_CODE);
    }
  } catch (err) {
    try {
      log({ ev: 'error', error: String((err && err.message) || err) });
    } catch {}
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  raw += d;
});
process.stdin.on('end', () => {
  let inp;
  try {
    if (!raw.trim()) return;
    if (raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }
    inp = JSON.parse(raw);
  } catch (err) {
    try {
      const STATE_DIR = process.env.JEVGATE_STATE_DIR || path.join(os.homedir(), '.claude', 'state');
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.appendFileSync(
        path.join(STATE_DIR, 'jev-gate-log.jsonl'),
        JSON.stringify({
          ts: new Date().toISOString(),
          sid: 'unknown',
          ev: 'error',
          error: String((err && err.message) || err),
        }) + '\n'
      );
    } catch {}
    return;
  }
  if (!inp || typeof inp !== 'object') return;
  main(inp);
});

// <HOME>/.claude/hooks/hook-timer.js
// Обёртка для замера времени работы хуков Claude Code.
// Вызов: node hook-timer.js <имя-хука> -- <команда и аргументы>
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LOG_FILE = process.env.HOOK_TIMING_LOG || '<HOME>/.claude/state/hook-timing.jsonl';
const ROT_FILE = process.env.HOOK_TIMING_ROT || '<HOME>/.claude/state/hook-timing.1.jsonl';
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 МБ

const dashDashIdx = process.argv.indexOf('--');
if (dashDashIdx === -1 || dashDashIdx >= process.argv.length - 1 || dashDashIdx < 3) {
  process.stderr.write('[hook-timer] Ошибка аргументов: ожидается node hook-timer.js <имя-хука> -- <команда...>\n');
  process.exit(1);
}

const hookName = process.argv[2];
const targetCmd = process.argv.slice(dashDashIdx + 1);

// Читаем весь stdin в буфер
const chunks = [];
process.stdin.on('data', (d) => chunks.push(d));
process.stdin.on('error', () => {});
process.stdin.on('end', () => {
  const stdinBuf = Buffer.concat(chunks);
  let hookEventName = null;
  let toolName = null;

  try {
    if (stdinBuf.length > 0) {
      const parsed = JSON.parse(stdinBuf.toString('utf8'));
      if (parsed && typeof parsed === 'object') {
        if (parsed.hook_event_name) hookEventName = String(parsed.hook_event_name);
        if (parsed.tool_name) toolName = String(parsed.tool_name);
      }
    }
  } catch {}

  runTarget(hookName, targetCmd, stdinBuf, hookEventName, toolName);
});

function logTiming(record) {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(LOG_FILE)) {
      const st = fs.statSync(LOG_FILE);
      if (st.size >= MAX_LOG_SIZE) {
        try {
          if (fs.existsSync(ROT_FILE)) {
            fs.unlinkSync(ROT_FILE);
          }
          fs.renameSync(LOG_FILE, ROT_FILE);
        } catch {}
      }
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8');
  } catch {}
}

function runTarget(name, cmdParts, stdinBuf, hookEventName, toolName) {
  const isPowerShell = cmdParts[0] === '&' ||
                       cmdParts[0].startsWith('&') ||
                       cmdParts.some((p) => /\.ps1\b/i.test(p)) ||
                       cmdParts[0].toLowerCase() === 'powershell' ||
                       cmdParts[0].toLowerCase() === 'powershell.exe';

  let file;
  let args;
  const options = {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  };

  if (isPowerShell) {
    file = 'powershell.exe';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmdParts.join(' ')];
  } else if (cmdParts.length === 1) {
    file = cmdParts[0];
    args = [];
    options.shell = true;
  } else {
    file = cmdParts[0];
    args = cmdParts.slice(1);
  }

  const startMs = Date.now();
  let stdoutBytes = 0;
  let child;

  try {
    child = spawn(file, args, options);
  } catch (err) {
    process.stderr.write(`[hook-timer] Не удалось запустить хук "${name}": ${err.message}\n`);
    process.exit(1);
  }

  child.on('error', (err) => {
    process.stderr.write(`[hook-timer] Не удалось запустить хук "${name}": ${err.message}\n`);
    process.exit(1);
  });

  child.stdin.on('error', () => {});
  if (stdinBuf.length > 0) {
    child.stdin.write(stdinBuf);
  }
  child.stdin.end();

  child.stdout.on('data', (d) => {
    process.stdout.write(d);
    stdoutBytes += d.length;
  });

  child.stderr.on('data', (d) => {
    process.stderr.write(d);
  });

  child.on('close', (code, signal) => {
    const durationMs = Date.now() - startMs;
    const exitCode = code !== null ? code : (signal ? 1 : 0);

    logTiming({
      time: new Date().toISOString(),
      hook: name,
      event: hookEventName,
      tool: toolName,
      duration_ms: durationMs,
      exit_code: exitCode,
      stdout_bytes: stdoutBytes
    });

    process.exit(exitCode);
  });
}

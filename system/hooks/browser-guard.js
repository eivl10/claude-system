// browser-guard.js: сторож встроенного браузера (mcp__Claude_Browser__*). Один скрипт на два события, событие берём из hook_event_name.
// Зачем: владелец 01.11.2026 велел браузер оставить, но пользоваться редко. Аудит: ~82-86% вызовов браузера - самопроверка Клода.
// UserPromptSubmit: обнуляет счётчик сессии (session_id) и ставит лимит хода: 15, если в промпте есть слова про браузер/страницу/вёрстку
//   (браузер, скриншот, скрин, посмотри, глянь, страниц, вёрстк, верстк, превью, preview, сайт; без учёта регистра), иначе 3. Вывода нет.
// PreToolUse (в settings.json matcher mcp__Claude_Browser__.*): счётчик +1; счётчик больше лимита - permissionDecision deny с текстом.
//   browser_batch - один вызов PreToolUse, то есть один в счёте. Отказанные вызовы тоже считаются: повтор получит отказ снова.
//   Фильтра по имени тула в скрипте нет: его делает matcher.
// Состояние: ~/.claude/state/browser-guard.json (в тестах BROWSER_GUARD_STATE), ключ - session_id, запись {count, limit, ts}.
//   При каждой записи удаляются записи старше 2 суток или без ts.
// Любая ошибка (нет stdin, битый JSON, нет прав) - выход 0 без вывода: сторож не должен ломать работу.
// Известное: параллельные вызовы браузера в одном сообщении пишут файл без блокировки, один прирост может потеряться.
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_FILE = process.env.BROWSER_GUARD_STATE || path.join(os.homedir(), '.claude', 'state', 'browser-guard.json');
const LIMIT_LOW = 3;
const LIMIT_HIGH = 15;
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const WORDS = /браузер|скриншот|скрин|посмотри|глянь|страниц|вёрстк|верстк|превью|preview|сайт/i;

function readState() {
  try {
    const o = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch { return {}; }
}

function saveState(st) {
  const now = Date.now();
  for (const k of Object.keys(st)) {
    const ts = st[k] && Number(st[k].ts);
    if (!ts || now - ts > MAX_AGE_MS) delete st[k];
  }
  const data = JSON.stringify(st);
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, STATE_FILE);
    } catch {
      try { fs.unlinkSync(tmp); } catch {}
      fs.writeFileSync(STATE_FILE, data);
    }
  } catch {}
}

const reason = (n, limit) =>
  `Браузер: ${n}-й вызов за ход, лимит ${limit}. Правило владельца (память ui-check-before-showing): ` +
  'браузер только по его просьбе или один финальный взгляд на прод-страницу. ' +
  'Остановись и одной строкой спроси владельца, нужен ли браузер дальше.';

function main(inp) {
  const ev = inp.hook_event_name;
  const sid = String(inp.session_id || 'nosession');
  const st = readState();

  if (ev === 'UserPromptSubmit') {
    st[sid] = { count: 0, limit: WORDS.test(String(inp.prompt || '')) ? LIMIT_HIGH : LIMIT_LOW, ts: Date.now() };
    saveState(st);
    return;
  }

  if (ev === 'PreToolUse') {
    const cur = st[sid] && typeof st[sid] === 'object' ? st[sid] : {};
    const limit = Number(cur.limit) || LIMIT_LOW;
    const count = (Number(cur.count) || 0) + 1;
    st[sid] = { count, limit, ts: Date.now() };
    saveState(st);
    if (count > limit) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason(count, limit),
        },
      }));
    }
  }
}

let raw = '';
process.stdin.on('error', () => {});
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => { try { main(JSON.parse(raw.replace(/^﻿/, ''))); } catch {} });

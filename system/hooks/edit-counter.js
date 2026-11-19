// PostToolUse (Edit|Write): счётчики правок за сессию в tmpdir/claude-edits-<sid>.json. Два счётчика (16.11.2026):
//   n: ВСЕ правки, как до 15.11.2026. Его читает idle-handoff-arm.js (сессия «достойна» handoff от 5 правок, в том числе документов). Не менять.
//   c: правки кода (без .md/.txt и служебных папок). По нему на 3-й правке один раз напоминает загрузить локальный скилл no-regressions.
const fs = require('fs');
const os = require('os');
const path = require('path');

const THRESHOLD = 3;
const SKIP_EXT = /\.(md|txt)$/i;
// Служебные папки: черновики агентов, архив и папка памяти Claude (.claude/projects/<проект>/memory). Код проектов с папкой memory считается.
const SKIP_DIR = /(^|\/)(docs\/tmp-agy|_архив)\/|(^|\/)\.claude\/projects\/[^/]+\/memory\//i;

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { return; }
  // Правки текста и служебных папок в счёт no-regressions не идут (она про регрессии в коде), но в общий счётчик n идут.
  const fp = String((inp.tool_input && inp.tool_input.file_path) || '').replace(/\\/g, '/');
  const isCode = !(SKIP_EXT.test(fp) || SKIP_DIR.test(fp));
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stateFile = path.join(os.tmpdir(), `claude-edits-${sid}.json`);
  let st = { n: 0, notified: false };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}
  // файл мог быть записан прежней версией без поля c: тогда её n и был счётчиком правок кода
  if (typeof st.c !== 'number') st.c = st.n || 0;
  st.n += 1;
  if (isCode) st.c += 1;
  const fire = isCode && st.c >= THRESHOLD && !st.notified;
  if (fire) st.notified = true;
  try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {}
  if (!fire) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `В сессии уже ${st.c} правок. Загрузи локальный скилл no-regressions (Skill, имя "no-regressions", не anthropic-skills:no-regressions) и дальше следуй ему.`,
    },
  }));
});

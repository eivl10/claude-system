// PostToolUse (Edit|Write): счётчик правок за сессию. На 3-й правке один раз напоминает загрузить локальный скилл no-regressions.
const fs = require('fs');
const os = require('os');
const path = require('path');

const THRESHOLD = 3;

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { return; }
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stateFile = path.join(os.tmpdir(), `claude-edits-${sid}.json`);
  let st = { n: 0, notified: false };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}
  st.n += 1;
  const fire = st.n >= THRESHOLD && !st.notified;
  if (fire) st.notified = true;
  try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {}
  if (!fire) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `В сессии уже ${st.n} правок. Загрузи локальный скилл no-regressions (Skill, имя "no-regressions", не anthropic-skills:no-regressions) и дальше следуй ему.`,
    },
  }));
});

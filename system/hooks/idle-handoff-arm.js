// UserPromptSubmit: авто-handoff при простое.
// 1) Сообщение владельца: если сессия "достойна" handoff (orc/brief, 3+ правок, контекст >100k или ручной флаг),
//    просит агента поставить ScheduleWakeup на IDLE_SEC секунд с тиком "/idle-handoff тик t=<ts>".
// 2) Тик: сверяет t с временем последнего сообщения владельца и говорит агенту, что делать (устарел / тишина).
// Состояние: tmpdir/claude-idle-handoff-<sid>.json. IDLE_HANDOFF_SEC и IDLE_HANDOFF_EDITS переопределяют пороги (для проверки).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastMain } = require('./ctx-lib');

const IDLE_SEC = Number(process.env.IDLE_HANDOFF_SEC) || 3000;
const EDITS_MIN = Number(process.env.IDLE_HANDOFF_EDITS) || 5;
const TOKENS_MIN = 100000;
const MODE_RE = /(^|\s)\/(super-orc|orc|short-brief|brief)\b|короткий бриф/i;
const TICK_RE = /^\s*\/idle-handoff\s+тик\s+t=(\d+)/i;
const OTHER_TICK_RE = /^\s*\/cache-warm\s+тик/i;

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { return; }
  const prompt = String(inp.prompt || '');
  if (OTHER_TICK_RE.test(prompt)) return;
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stateFile = path.join(os.tmpdir(), `claude-idle-handoff-${sid}.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {} };
  const out = (msg) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: msg } }));

  const tick = TICK_RE.exec(prompt);
  if (tick) {
    if (Number(tick[1]) !== st.lastUserTs) {
      out('Тик idle-handoff устарел: после него было сообщение владельца. Ответь одним словом «ок», инструментов не вызывай, таймер не ставь.');
    } else {
      out('Тик idle-handoff: владелец молчит с прошлого хода. Загрузи скилл idle-handoff (Skill, имя "idle-handoff") и выполни его проверку handoff. Таймер заново не ставить.');
    }
    return;
  }

  // сообщение владельца
  st.lastUserTs = Math.floor(Date.now() / 1000);
  if (/idle\s*выкл/i.test(prompt)) st.off = true;
  if (/idle\s*вкл/i.test(prompt)) { st.off = false; st.on = true; }
  if (MODE_RE.test(prompt)) st.mode = true;
  let edits = 0;
  try { edits = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), `claude-edits-${sid}.json`), 'utf8')).n || 0; } catch {}
  const last = lastMain(inp.transcript_path);
  const tokens = last ? last.tokens : 0;
  const worthy = st.on || st.mode || edits >= EDITS_MIN || tokens > TOKENS_MIN;
  save();
  if (st.off || !worthy) return;
  out(`idle-handoff включён для этой сессии. В КОНЦЕ этого хода (после всей работы, одним из последних вызовов) вызови ScheduleWakeup: delaySeconds=${IDLE_SEC}, prompt="/idle-handoff тик t=${st.lastUserTs}", reason="проверка handoff при простое", noop=true. Владельцу об этом не пиши.`);
});

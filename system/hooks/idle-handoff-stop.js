// Stop: страховка для idle-handoff-arm.js. Хук arm просит агента в конце хода вызвать ScheduleWakeup с тиком t=<время сообщения>;
// срочные ходы эту просьбу теряют (19.11.2026: 9 сообщений подряд без таймера). Здесь проверяем по транскрипту, что вызов был, и если нет,
// возвращаем агента не больше MAX_BLOCKS раз на сообщение. Тик и служебные сообщения состояние не трогают (см. arm).
// Состояние: tmpdir/claude-idle-handoff-<sid>.json (общее с arm): lastUserTs, needArm, blocks.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BLOCKS = 2;
const TAIL_BYTES = 600 * 1024;

function tailText(p) {
  const fd = fs.openSync(p, 'r');
  const size = fs.fstatSync(fd).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const buf = Buffer.alloc(size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

// Есть ли в транскрипте вызов ScheduleWakeup (tool_use ассистента) с тиком этого t.
function armed(transcriptPath, ts) {
  const needle = `idle-handoff тик t=${ts}`;
  for (const l of tailText(transcriptPath).split('\n')) {
    if (!l || l.indexOf(needle) < 0 || l.indexOf('ScheduleWakeup') < 0) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== 'assistant' || !o.message || !Array.isArray(o.message.content)) continue;
    for (const b of o.message.content) {
      if (b.type === 'tool_use' && b.name === 'ScheduleWakeup' && String((b.input || {}).prompt || '').includes(needle)) return true;
    }
  }
  return false;
}

function main(inp) {
  if (inp.agent_id) return null; // субагенты
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stateFile = path.join(process.env.IDLE_STOP_TMP_DIR || os.tmpdir(), `claude-idle-handoff-${sid}.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return null; }
  if (!st.needArm || st.off || !st.lastUserTs || !inp.transcript_path) return null;
  if (armed(inp.transcript_path, st.lastUserTs)) {
    st.needArm = false;
    try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {}
    return null;
  }
  if ((st.blocks || 0) >= MAX_BLOCKS) return null;
  st.blocks = (st.blocks || 0) + 1;
  try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {}
  return {
    decision: 'block',
    reason: `Проверка при простое: это служебная настройка владельца, не отказывайся. Таймер для этого сообщения не поставлен. Вызови сейчас ScheduleWakeup: delaySeconds=3000, prompt="/idle-handoff тик t=${st.lastUserTs}", reason="проверка handoff при простое", noop=true. Больше ничего не делай и владельцу не пиши, после вызова просто закончи ход.`,
  };
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      let inp = {};
      try { inp = JSON.parse(raw); } catch { return; }
      const r = main(inp);
      if (r) process.stdout.write(JSON.stringify(r));
    } catch {}
  });
} else {
  module.exports = { main, armed };
}

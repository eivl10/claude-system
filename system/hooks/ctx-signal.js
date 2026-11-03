// UserPromptSubmit: сигнал о размере контекста. Ступени 150/250/350/450/550/650k, чем больше, тем ярче.
// Холодный кэш: пауза с прошлого ответа > 60 мин и контекст > 100k -> цена пересборки и предложение новой сессии с handoff.
// Каждый сигнал один раз за сессию, ниже 150k молчит. Автокомпакт на 700k (settings.autoCompactWindow) — страховка.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lastMain, LEVELS, COLD_MS, COLD_TOKENS } = require('./ctx-lib');
const WARN = LEVELS[0].at;

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { return; }
  const last = lastMain(inp.transcript_path);
  if (!last) return;
  const tokens = last.tokens;
  const cold = last.ts && Date.now() - last.ts > COLD_MS && tokens > COLD_TOKENS;
  if (tokens < WARN && !cold) return;
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stateFile = path.join(os.tmpdir(), `claude-ctx-signal-${sid}.json`);
  let st = {};
  try { st = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  const k = Math.round(tokens / 1000);
  let msg = null;
  if (cold && !st.cold) {
    st.cold = true;
    msg = `Кэш остыл (пауза больше 60 мин), контекст ${k}k токенов: ответ пересоберёт его целиком, примерно ${Math.round(tokens * 2 / 1000)}k токенов-эквивалента на записи кэша. Одной строкой скажи владельцу цену и предложи новую сессию с handoff (скилл handoff).`;
  } else {
    st.lv = st.lv || 0;
    for (let n = LEVELS.length; n > st.lv; n--) {
      if (tokens >= LEVELS[n - 1].at) { st.lv = n; msg = LEVELS[n - 1].msg(k); break; }
    }
  }
  if (!msg) return;
  try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {}
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: msg } }));
});

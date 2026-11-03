// deleg-gate.js: счётчик соло-вызовов основной сессии на один ход владельца.
// UserPromptSubmit: сброс счётчика и короткое напоминание. Слово /solo в промпте выключает подсказки на этот ход.
// PostToolUse: счёт вызовов без agy и Agent, подсказки на 4, 12 и 30 вызове с конкретным следующим шагом.
// PreToolUse: только при DELEG_MODE=deny. Один отказ на пороге 12 и один на 30, повторный вызов проходит.
// Порог 4, не 3: однострочная правка = Read + Edit + проверка = 3 вызова, на ней хук молчит.
// Режим оркестратора (orc): включается словом /orc, /super-orc или «скилл super-orc» в промпте либо загрузкой скилла orc или super-orc,
//   выключается «/orc off». Состояние живёт всю сессию. В нём: пороги 3, 6, 10 и дальше каждые 8 вызовов (после 30 тишины нет),
//   напоминание без «важный код — сама». Один отказ на крупную запись кода (Write/Edit свыше BIG_WRITE символов, не документ,
//   повтор по тому же пути проходит) включается DELEG_BIGWRITE=on, по умолчанию выключен: блокировку Edit владелец отклонял 14.10.
// Делегирование: тул Agent или Task, либо Bash или PowerShell с вызовом agy и ключом --print или -p, либо со сторожем agy-run.js (--name или --resume). Сбрасывает счётчик.
// Вызовы субагентов (поле agent_id в событии) пропускаются. Журнал: <state>/deleg-log.jsonl.
// Переменные для тестов: DELEG_STATE_DIR, DELEG_TMP_DIR. Режим по умолчанию nudge: работу не блокирует.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODE = process.env.DELEG_MODE === 'deny' ? 'deny' : 'nudge';
const BIGWRITE = process.env.DELEG_BIGWRITE === 'on';
const BIG_WRITE = Number(process.env.DELEG_BIG_WRITE) || 1500;
const STATE_DIR = process.env.DELEG_STATE_DIR || path.join(os.homedir(), '.claude', 'state');
const TMP_DIR = process.env.DELEG_TMP_DIR || os.tmpdir();
const LEVELS = [4, 12, 30];
const LEVELS_ORC = [3, 6, 10];
const ORC_STEP = 8;
const COUNTED = /^(Bash|PowerShell|Read|Edit|Write|MultiEdit|NotebookEdit|WebFetch|WebSearch|mcp__jcodemunch__.+|mcp__jdocmunch__.+)$/;
const CODE_EXT = /\.(js|mjs|cjs|ts|tsx|jsx|py|php|css|html?|sh|ps1|sql|go|rs|c|cpp|cs|java)$/i;
const ORC_SKILL = /^(super-)?orc$/i;

const REMINDER =
  'ДЕЛЕГИРОВАНИЕ (deleg-gate). Простое (разведка, чтение, логи, прогоны, сборка, тесты, правки по спеке) идёт в agy Flash через agy-run. ' +
  'Сама: однострочная правка, HANDOFF/FIXES/README, приёмка; логику и дизайн сериями до 3 вызовов, остаток agy Flash. ' +
  'Больше 3 вызовов подряд без agy: «Соло: причина» из: agy отказал (429 или два сбоя), однострочная правка, HANDOFF/FIXES/README, приёмка. «Нужен контекст», «правки небольшие» не причины.';

const REMINDER_ORC =
  'РЕЖИМ ОРКЕСТРАТОРА (deleg-gate). Ты раздаёшь, не делаешь: каждый твой вызов читает весь контекст по ставке твоей модели. ' +
  'Поиск, чтение, прогоны, цикл правка-прогон, код по готовой спеке — agy Flash через agy-run. ' +
  'Новая логика, важный код, дизайн, тексты сайта — спека в файл и Agent с model: sonnet; владелец это разрешил заранее, спрашивать не надо. ' +
  '«Важный код» причиной делать самой НЕ является. Сама: правка до 10 строк, приёмка (jev, git diff --stat), брифы, спеки, HANDOFF. ' +
  'Четвёртый свой вызов подряд без запуска исполнителя — стоп.';

const MSG = [
  (n) => `Соло-вызовов в этом ходе: ${n}, agy и Agent не было. Если это не однострочная правка, не HANDOFF, FIXES, README и не приёмка, отдай остаток agy Flash: ` +
    'бриф в файл docs/tmp-agy/prompt-<имя>.md, agy-run.js в фоне (скилл agy §2), куски параллельно, свой кусок делай, пока он идёт. ' +
    'Остаёшься соло: «Соло: причина» из списка: agy отказал (429 или два сбоя), однострочная правка, HANDOFF/FIXES/README, приёмка. «Нужен контекст», «правки небольшие» не причины.',
  (n) => `Соло-вызовов: ${n}, агентов 0. Если строки «Соло: причина» в этом ходе ещё не было, напиши её сейчас: что сделано и почему остаток нельзя раздать. ` +
    'Либо раздай остаток по файлам. Строка уже есть и причина действует — продолжай.',
  (n) => `Соло-вызовов: ${n}. Скажи владельцу одну строку: что сделано, что осталось. ` +
    'Остаток, который делится по файлам, отдай agy параллельно.',
];

const MSG_ORC = [
  (n) => `Своих вызовов подряд: ${n}, исполнителей не было. Если это не мелочь (до 10 строк) и не приёмка, следующий вызов — запуск исполнителя: ` +
    'бриф в файл (цель, файлы, команда приёмки, «прочитай HANDOFF.md»), затем agy-run в фоне или Agent с model: sonnet. Цикл «правка → прогон» отдают целиком.',
  (n) => `Своих вызовов подряд: ${n}, исполнителей 0. Напиши в чат «Соло: <причина из списка §4 super-orc: мелочь, приёмка, слово владельца, отказ исполнителей>» ` +
    'или запусти исполнителя на остаток. «Важный код», «нужен контекст», «правки небольшие» в списке нет.',
  (n) => `Своих вызовов подряд: ${n}. Остановись: что из сделанного было работой исполнителя? Остаток раздай: Flash — по готовой спеке и циклы прогонов, ` +
    'Sonnet — новая логика и важный код. Одна строка владельцу: что сделано, что отдаёшь.',
];

const DENY_REASON = (n) =>
  `ОТКАЗ deleg-gate: ${n} соло-вызовов в этом ходе без agy и Agent. Отдай следующий кусок агенту ` +
  'либо напиши строку «Соло: причина» и повтори вызов, повтор пройдёт.';

const DENY_BIG = (n) =>
  `ОТКАЗ deleg-gate (режим оркестратора): запись кода на ${n} символов. Крупный код пишет исполнитель: спека в файл (что, файлы, интерфейсы, команда приёмки) ` +
  'и Agent с model: sonnet, а по готовой спеке без новых решений — agy Flash. Повтор вызова по этому же пути пройдёт, если причина из списка «Сама» ' +
  '(мелочь, отказ исполнителей, слово владельца): назови её строкой «Соло: …».';

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

function isDelegation(tool, ti) {
  if (tool === 'Agent' || tool === 'Task') return true;
  if (tool !== 'Bash' && tool !== 'PowerShell') return false;
  const cmd = String((ti && ti.command) || '');
  if (/agy-quota-gate|cred-switch/.test(cmd)) return false;
  if (/agy-run\.js["']?\s[\s\S]*--(name|resume)\b/.test(cmd)) return true;
  return /(^|[\s;&|"'`(\\/])agy(\.exe)?\s/.test(cmd) && /(--print|(^|\s)-p[= ])/.test(cmd);
}

function levelOf(calls, orc) {
  if (!orc) return LEVELS.filter((n) => calls >= n).length;
  const base = LEVELS_ORC.filter((n) => calls >= n).length;
  const last = LEVELS_ORC[LEVELS_ORC.length - 1];
  return calls >= last ? base + Math.floor((calls - last) / ORC_STEP) : base;
}

function writeSize(tool, ti) {
  if (tool === 'Write') return String(ti.content || '').length;
  if (tool === 'Edit') return String(ti.new_string || '').length;
  return (Array.isArray(ti.edits) ? ti.edits : []).reduce((a, e) => a + String((e && e.new_string) || '').length, 0);
}

function out(event, extra) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...extra } }));
}

function main(inp) {
  const ev = inp.hook_event_name;
  if (inp.agent_id || /[\\/]subagents[\\/]/.test(String(inp.transcript_path || ''))) return;
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stFile = path.join(TMP_DIR, `claude-deleg-${sid}.json`);
  const fresh = () => ({ calls: 0, level: 0, solo: false, denied: 0, delegations: 0 });
  const st = { ...fresh(), orc: false, bigDenied: {}, ...(readJson(stFile) || {}) };
  const save = () => { try { fs.writeFileSync(stFile, JSON.stringify(st)); } catch {} };
  const log = (o) => {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.appendFileSync(path.join(STATE_DIR, 'deleg-log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), sid, ...o }) + '\n');
    } catch {}
  };
  const tool = String(inp.tool_name || '');
  const ti = inp.tool_input || {};

  if (ev === 'UserPromptSubmit') {
    const p = String(inp.prompt || '');
    const solo = /(^|\s)\/solo(\s|$)/.test(p);
    let orc = !!st.orc;
    if (/(^|\s)\/orc\s+off\b/i.test(p)) orc = false;
    else if (/(^|[\s"'«(>])\/(super-)?orc(?![\w-])/i.test(p) || /(скилл|skill)\s+super-orc/i.test(p)) orc = true;
    if (orc !== !!st.orc) log({ ev: orc ? 'orc-on' : 'orc-off', via: 'prompt' });
    Object.assign(st, fresh(), { solo, delegations: st.delegations, orc, bigDenied: st.bigDenied });
    save();
    log({ ev: 'reset', solo, orc });
    out(ev, { additionalContext: solo ? 'Режим /solo на этот ход: подсказки deleg-gate выключены.' : (orc ? REMINDER_ORC : REMINDER) });
    return;
  }

  if (ev === 'PostToolUse') {
    if (tool === 'Skill' && ORC_SKILL.test(String(ti.skill || ''))) {
      if (!st.orc) { st.orc = true; save(); log({ ev: 'orc-on', via: 'skill' }); }
      return;
    }
    if (isDelegation(tool, ti)) {
      st.calls = 0; st.level = 0; st.denied = 0; st.delegations += 1;
      save();
      log({ ev: 'delegation', tool });
      return;
    }
    if (!COUNTED.test(tool)) return;
    st.calls += 1;
    let msg = null;
    if (!st.solo) {
      const lv = levelOf(st.calls, st.orc);
      if (lv > st.level) { st.level = lv; msg = (st.orc ? MSG_ORC[Math.min(lv, 3) - 1] : MSG[lv - 1])(st.calls); }
    }
    save();
    if (msg) { log({ ev: 'nudge', level: st.level, calls: st.calls, orc: st.orc }); out(ev, { additionalContext: msg }); }
    return;
  }

  if (ev === 'PreToolUse') {
    if (st.solo) return;
    if (st.orc && BIGWRITE && /^(Write|Edit|MultiEdit)$/.test(tool)) {
      const fp = String(ti.file_path || '');
      const n = writeSize(tool, ti);
      if (n > BIG_WRITE && CODE_EXT.test(fp) && !(st.bigDenied && st.bigDenied[fp])) {
        st.bigDenied = { ...(st.bigDenied || {}), [fp]: true };
        save();
        log({ ev: 'deny-big', path: fp, chars: n });
        out(ev, { permissionDecision: 'deny', permissionDecisionReason: DENY_BIG(n) });
        return;
      }
    }
    if (MODE === 'deny') {
      if (isDelegation(tool, ti) || !COUNTED.test(tool)) return;
      const need = st.calls >= LEVELS[2] - 1 ? 2 : st.calls >= LEVELS[1] - 1 ? 1 : 0;
      if (st.denied < need) {
        st.denied = need;
        save();
        log({ ev: 'deny', calls: st.calls + 1 });
        out(ev, { permissionDecision: 'deny', permissionDecisionReason: DENY_REASON(st.calls + 1) });
      }
    }
  }
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => { try { main(JSON.parse(raw)); } catch {} });

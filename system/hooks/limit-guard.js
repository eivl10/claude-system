// Остаток лимита подписки. Хуки rate_limits не получают, поэтому снимок пишут:
//  - PostToolUse на mcp__ccd_session_mgmt__get_usage (десктоп; statusline там не запускается);
//  - statusline.js (CLI), тот же формат.
// Снимок: ~/.claude/state/rate-limits.json. Пороги: 5ч 85/95%, неделя 90/97%.
// UserPromptSubmit и PostToolUse(Bash|Edit|Write|Agent): нет свежего снимка -> подсказка вызвать get_usage;
// Основная сессия: только предупреждения, без блока и отказа от задачи. warn/crit -> одна строка владельцу, работа продолжается.
// Блок (PreToolUse) только для Claude-субагентов (tool Agent) при свежем снимке >= 97% (5ч или неделя). agy идёт через Bash, не блокируется.
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(__dirname, '..', 'state');
const SNAP = path.join(STATE_DIR, 'rate-limits.json');
const USAGE_TOOL = 'mcp__ccd_session_mgmt__get_usage';
const FIVE = { warn: 85, crit: 95 };
const WEEK = { warn: 90, crit: 97 };
const SUBAGENT_DENY = 97;
const MIN = 60 * 1000;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); } catch {} };

// tool_response у get_usage в десктопе — массив блоков {type,text} (проверено 03.10.2026); объект и строку тоже принимаем
function parseResponse(r) {
  if (r == null) return null;
  if (typeof r === 'string') { try { return parseResponse(JSON.parse(r)); } catch { return null; } }
  if (Array.isArray(r)) {
    const text = r.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
    return text ? parseResponse(text) : null;
  }
  if (typeof r === 'object') {
    if (r.plan) return r;
    if (r.content) return parseResponse(r.content);
    if (typeof r.text === 'string') return parseResponse(r.text);
  }
  return null;
}

function snapFromUsage(obj) {
  const plan = obj && obj.plan;
  const snap = { ts: Date.now(), source: 'get_usage', status: (plan && plan.status) || 'unknown', five_hour: null, weekly: [] };
  if (!plan || plan.status !== 'ok' || !Array.isArray(plan.windows)) return snap;
  for (const w of plan.windows) {
    const v = { label: w.label, pct: Number(w.percentUsed), resets_at: Date.parse(w.resetsAt) || null };
    if (/5-hour/i.test(w.label || '')) snap.five_hour = v;
    else if (/week/i.test(w.label || '')) snap.weekly.push(v);
  }
  return snap;
}

function level(s) {
  if (!s || s.status !== 'ok') return 'unknown';
  const f = s.five_hour ? s.five_hour.pct : 0;
  const w = Math.max(0, ...s.weekly.map((x) => x.pct));
  if (f >= FIVE.crit || w >= WEEK.crit) return 'crit';
  if (f >= FIVE.warn || w >= WEEK.warn) return 'warn';
  return 'ok';
}

// Ближе к порогу — проверять чаще
function staleMs(s) {
  if (!s || s.status !== 'ok') return 30 * MIN;
  const f = s.five_hour ? s.five_hour.pct : 0;
  const w = Math.max(0, ...s.weekly.map((x) => x.pct));
  return f >= 70 || w >= 85 ? 15 * MIN : 30 * MIN;
}

function fmtTime(ms) {
  if (!ms) return '?';
  const d = new Date(ms);
  const hm = d.toTimeString().slice(0, 5);
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')} ${hm}`;
}

function describe(s) {
  const parts = [];
  if (s.five_hour) parts.push(`5ч ${Math.round(s.five_hour.pct)}%, сброс ${fmtTime(s.five_hour.resets_at)}`);
  for (const w of s.weekly) parts.push(`${w.label} ${Math.round(w.pct)}%, сброс ${fmtTime(w.resets_at)}`);
  return parts.join('; ');
}

function message(lv, s) {
  if (lv === 'crit') return `Лимит почти исчерпан (${describe(s)}). Одной строкой предупреди владельца и продолжай задачу: не отказывайся, не останавливайся, не откладывай из-за лимита. Если упрёшься в лимит на деле, сохрани состояние на диск и скажи.`;
  if (lv === 'warn') return `Лимит близко (${describe(s)}). Одной строкой предупреди владельца и продолжай как обычно. Механику по возможности отдавай в agy.`;
  return null;
}

const NUDGE = `Нет свежих данных о лимите подписки. Перед продолжением: ToolSearch select:${USAGE_TOOL}, затем вызвать его без параметров. Тула нет (CLI) — пропусти.`;

function out(event, extra) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, ...extra } }));
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { return; }
  const ev = inp.hook_event_name;
  const tool = inp.tool_name || '';

  // 1. Свежие данные из get_usage
  if (ev === 'PostToolUse' && tool === USAGE_TOOL) {
    const snap = snapFromUsage(parseResponse(inp.tool_response));
    writeJson(SNAP, snap);
    const msg = message(level(snap), snap);
    if (msg) out(ev, { additionalContext: msg });
    return;
  }

  const snap = readJson(SNAP);
  const fresh = snap && snap.ts && Date.now() - snap.ts < staleMs(snap);
  const lv = fresh ? level(snap) : 'stale';

  // 2. Блок только Claude-субагентов (tool Agent) при свежем снимке >= 97%. Основную сессию и agy не блокирует.
  if (ev === 'PreToolUse') {
    if (tool === 'Agent' && fresh && snap.status === 'ok') {
      const f = snap.five_hour ? snap.five_hour.pct : 0;
      const w = Math.max(0, ...snap.weekly.map((x) => x.pct));
      if (f >= SUBAGENT_DENY || w >= SUBAGENT_DENY) {
        out(ev, { permissionDecision: 'deny', permissionDecisionReason: `Лимит подписки ${describe(snap)}: Claude-субагенты заблокированы с ${SUBAGENT_DENY}%. Основная сессия работает как обычно; механику отдай в agy (через Bash) или сделай сама.` });
      }
    }
    return;
  }

  // 3. Подсказки с троттлингом на сессию
  if (lv === 'ok' || lv === 'unknown') return;
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stFile = path.join(os.tmpdir(), `claude-limit-guard-${sid}.json`);
  const st = readJson(stFile) || {};
  const gap = { stale: 30 * MIN, warn: 30 * MIN, crit: 10 * MIN }[lv];
  if (st[lv] && Date.now() - st[lv] < gap) return;
  st[lv] = Date.now();
  writeJson(stFile, st);
  out(ev, { additionalContext: lv === 'stale' ? NUDGE : message(lv, snap) });
});

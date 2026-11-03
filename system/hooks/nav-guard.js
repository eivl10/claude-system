// PreToolUse (Read|Grep|Bash|PowerShell): не даёт читать код мимо индекса jcodemunch.
// Срабатывает только на файлах кода внутри проиндексированных репо (корни берутся из ~/.code-index/*.db).
// Read: первый раз на файл — отказ с подсказкой; повторный Read того же файла (перед Edit) и Read с offset/limit — пропускаются.
//   Read .md в репо, проиндексированном jdocmunch (~/.doc-index/local), — мягкая подсказка без отказа, не больше 3 за сессию.
// Grep: отказ. Bash/PowerShell: команда делится на сегменты (&&, ||, ;, |, перевод строки); каждый сегмент проверяется отдельно,
//   освобождается только сам сегмент (git, ssh, agy, sed -i, служебные папки). Счётчик отказов общий на оба шелла, не больше MAX_BASH_DENY за сессию.
// Пути берутся с кавычками и пробелами, форма <VIBECODING>/... приводится к <VIBECODING>\..., `cd <путь>` задаёт базу для следующих сегментов.
// Не блокирует .md, конфиги, логи, файлы вне индексированных репо, служебные папки.
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_BASH_DENY = 15;
const MAX_DOC_NUDGE = 3;
const ROOTS_TTL_MS = 10 * 60 * 1000;
const INDEX_DIR = path.join(os.homedir(), '.code-index');
const DOC_INDEX_DIR = path.join(os.homedir(), '.doc-index', 'local');
const ROOTS_CACHE = path.join(os.tmpdir(), 'claude-nav-roots.json');
const DOC_ROOTS_CACHE = path.join(os.tmpdir(), 'claude-nav-docroots.json');

const EXTS = 'jsx?|tsx?|mjs|cjs|py|go|css|scss|html?|php|ps1|sh|cs|lua|rs|java|kt|rb|sql|vue|svelte';
const CODE_EXT = new RegExp('\\.(' + EXTS + ')$', 'i');
const CODE_EXT_IN_CMD = new RegExp('\\.(' + EXTS + ')\\b', 'i');
const EXEMPT_PATH = /\.claude|AppData|[\\/]Temp[\\/]|[\\/]tmp[\\/]|\.code-index|node_modules|\.gemini/i;
const EXEMPT_SEG = /\.claude|AppData|[\\/]Temp[\\/]|\/tmp\/|\.code-index|\.doc-index|node_modules|sed\s+-i/i;
const EXEMPT_HEAD = /^(git|gh|ssh|scp|agy|rsync|sftp)\b|agy-run|[\\/]agy(\.exe)?\b|(^|[\s"'])agy\s/i;
const READER = /(^|[|;&(`]\s*|\s)(grep|egrep|fgrep|rg|find|cat|head|tail|awk|Select-String|Get-Content|gc|type)\s|(^|\s)sed\s+-n\b/i;
const RECURSIVE = /\b(grep|egrep|rg)\b[^|;&]*\s-[a-zA-Z]*[rR]|\bfind\s+\S+[^|;&]*-(name|iname)\b|\brg\b|Select-String[^|;&]*-Path[^|;&]*\*|Get-ChildItem[^|;&]*-Recurse[^|;&]*\|\s*Select-String/i;

const norm = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const under = (p, roots) => {
  const n = norm(p);
  return roots.some((r) => n === r || n.startsWith(r + '\\'));
};

function loadRootsFrom(cache, collect) {
  try {
    const c = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (Date.now() - c.ts < ROOTS_TTL_MS) return c.roots;
  } catch {}
  const roots = new Set();
  try { collect(roots); } catch {}
  const arr = [...roots];
  try { fs.writeFileSync(cache, JSON.stringify({ ts: Date.now(), roots: arr })); } catch {}
  return arr;
}

const loadRoots = () => loadRootsFrom(ROOTS_CACHE, (roots) => {
  const { DatabaseSync } = require('node:sqlite');
  for (const f of fs.readdirSync(INDEX_DIR)) {
    if (!f.endsWith('.db')) continue;
    try {
      const db = new DatabaseSync(path.join(INDEX_DIR, f), { readOnly: true });
      const row = db.prepare("select value from meta where key='source_root'").get();
      db.close();
      if (row && row.value) roots.add(norm(row.value));
    } catch {}
  }
});

const loadDocRoots = () => loadRootsFrom(DOC_ROOTS_CACHE, (roots) => {
  for (const f of fs.readdirSync(DOC_INDEX_DIR)) {
    if (!/^[^.]+\.json$/.test(f)) continue;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(DOC_INDEX_DIR, f), 'utf8'));
      if (j && j.source_root) roots.add(norm(j.source_root));
    } catch {}
  }
});

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

function nudge(text) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
  }));
  process.exit(0);
}

const HINT =
  'Код в проиндексированном репо читать через jcodemunch: get_file_outline → get_symbol_source, поиск — search_symbols / search_text. ' +
  'Тулы отложены: ToolSearch "select:mcp__jcodemunch__resolve_repo,mcp__jcodemunch__search_symbols,mcp__jcodemunch__search_text,mcp__jcodemunch__get_file_outline,mcp__jcodemunch__get_symbol_source". ';

// Делит команду на сегменты по &&, ||, ;, |, переводу строки вне кавычек.
function splitSegments(cmd) {
  const segs = [];
  let cur = '';
  let q = '';
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '\n' || (ch === '&' && cmd[i + 1] === '&')) {
      if (ch === '&' || (ch === '|' && cmd[i + 1] === '|')) i++;
      segs.push(cur); cur = ''; continue;
    }
    cur += ch;
  }
  segs.push(cur);
  return segs.map((s) => s.trim()).filter(Boolean);
}

// Приводит <VIBECODING>/... и F:/... к F:\...; относительный путь возвращает как есть.
function toWin(p) {
  let s = String(p).trim();
  let m = s.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (m) s = m[1].toUpperCase() + ':\\' + (m[2] || '');
  return s.replace(/\//g, '\\');
}
const isAbs = (p) => /^[A-Za-z]:[\\/]/.test(p) || /^\/[a-zA-Z](\/|$)/.test(p);

// Абсолютные пути сегмента: в кавычках (с пробелами) и без.
function absPaths(seg) {
  const out = [];
  const re = /"([^"]+)"|'([^']+)'|([^\s"'|;&<>]+)/g;
  let m;
  while ((m = re.exec(seg))) {
    const t = m[1] || m[2] || m[3];
    if (t && isAbs(t)) out.push(toWin(t));
  }
  return out;
}

// Цель cd/Set-Location/Push-Location в начале сегмента.
function cdTarget(seg) {
  const m = seg.match(/^(?:cd|chdir|Set-Location|sl|Push-Location|pushd)\s+(?:-Path\s+|-LiteralPath\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))/i);
  return m ? (m[1] || m[2] || m[3]) : null;
}

function checkShell(cmd, cwd, roots) {
  let base = cwd || '';
  for (const seg of splitSegments(cmd)) {
    const target = cdTarget(seg);
    if (target) { if (isAbs(target)) base = toWin(target); continue; }
    if (EXEMPT_HEAD.test(seg) || EXEMPT_SEG.test(seg)) continue;
    if (!READER.test(seg)) continue;
    const hasCode = CODE_EXT_IN_CMD.test(seg);
    if (!(hasCode || RECURSIVE.test(seg))) continue;
    const abs = absPaths(seg);
    if (abs.length ? abs.some((a) => under(a, roots)) : under(base, roots)) return true;
  }
  return false;
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch { process.exit(0); }
  const tool = inp.tool_name;
  const ti = inp.tool_input || {};
  const sid = String(inp.session_id || 'nosession').replace(/[^\w-]/g, '');
  const stateFile = path.join(os.tmpdir(), `claude-nav-${sid}.json`);
  let st = { seen: [], bashDenials: 0, docNudges: 0 };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(stateFile, JSON.stringify(st)); } catch {} };

  if (tool === 'Read') {
    const fp = String(ti.file_path || '');
    if (EXEMPT_PATH.test(fp) || ti.offset != null || ti.limit != null) process.exit(0);
    if (/\.mdx?$/i.test(fp)) {
      if (st.docNudges >= MAX_DOC_NUDGE || !under(fp, loadDocRoots())) process.exit(0);
      const key = norm(fp);
      if (st.seen.includes(key)) process.exit(0);
      st.seen.push(key);
      st.docNudges += 1;
      save();
      nudge('Эта папка проиндексирована jdocmunch: доки читать через search_sections → get_section, структуру — get_document_outline. ' +
        'Целиком Read нужен только ради номеров строк под Edit. Тулы отложены: ToolSearch "select:mcp__jdocmunch__search_sections,mcp__jdocmunch__get_section,mcp__jdocmunch__get_document_outline".');
    }
    if (!CODE_EXT.test(fp)) process.exit(0);
    const roots = loadRoots();
    if (!under(fp, roots)) process.exit(0);
    const key = norm(fp);
    if (st.seen.includes(key)) process.exit(0);
    st.seen.push(key);
    save();
    deny('READ ЗАБЛОКИРОВАН на ' + fp + '. ' + HINT + 'Повторный Read этого файла (перед Edit) будет пропущен.');
  }

  if (tool === 'Grep') {
    const p = String(ti.path || inp.cwd || '');
    if (!under(p, loadRoots())) process.exit(0);
    deny('GREP ЗАБЛОКИРОВАН. ' + HINT);
  }

  if (tool === 'Bash' || tool === 'PowerShell') {
    if (st.bashDenials >= MAX_BASH_DENY) process.exit(0);
    const cmd = String(ti.command || '');
    if (!checkShell(cmd, inp.cwd || '', loadRoots())) process.exit(0);
    st.bashDenials += 1;
    save();
    deny('BASH-НАВИГАЦИЯ ЗАБЛОКИРОВАНА (' + st.bashDenials + '/' + MAX_BASH_DENY + '). ' + HINT);
  }

  process.exit(0);
});

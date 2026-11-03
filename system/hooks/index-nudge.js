// SessionStart: если рабочая папка не под корнем индекса jcodemunch, подсказывает проиндексировать её (хук сам MCP не зовёт).
// Пропускает: <VIBECODING> и любую папку выше проекта (корень рабочего пространства), служебные папки, cwd уже под индексом.
const fs = require('fs');
const os = require('os');
const path = require('path');

const INDEX_DIR = path.join(os.homedir(), '.code-index');
const SKIP = /\.claude|AppData|[\\/]Temp[\\/]|[\\/]tmp[\\/]|node_modules|\.gemini/i;
const WORKSPACE_ROOTS = ['<VIBECODING>', 'f:\\', '<HOME>'];
const CODE_HINT = /\.(jsx?|tsx?|mjs|py|go|php|ps1|cs|rs|java|kt|rb|vue|svelte)$/i;
const norm = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const under = (p, roots) => roots.some((r) => p === r || p.startsWith(r + '\\'));

function roots() {
  const out = [];
  try {
    const { DatabaseSync } = require('node:sqlite');
    for (const f of fs.readdirSync(INDEX_DIR)) {
      if (!f.endsWith('.db')) continue;
      try {
        const db = new DatabaseSync(path.join(INDEX_DIR, f), { readOnly: true });
        const row = db.prepare("select value from meta where key='source_root'").get();
        db.close();
        if (row && row.value) out.push(norm(row.value));
      } catch {}
    }
  } catch {}
  return out;
}

// Есть ли в папке код (поверхностно, 2 уровня), чтобы не дёргать из-за пустой/документной папки.
function hasCode(dir, depth) {
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of names) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    if (e.isFile() && CODE_HINT.test(e.name)) return true;
    if (e.isDirectory() && depth > 0 && hasCode(path.join(dir, e.name), depth - 1)) return true;
  }
  return false;
}

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const inp = JSON.parse(raw);
    const cwd = String(inp.cwd || '');
    const n = norm(cwd);
    if (!cwd || SKIP.test(cwd) || WORKSPACE_ROOTS.includes(n) || under(n, roots())) return;
    if (!hasCode(cwd, 2)) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Рабочая папка ' + cwd + ' с кодом не проиндексирована jcodemunch. Для навигации по коду: ToolSearch ' +
          '"select:mcp__jcodemunch__index_folder,mcp__jcodemunch__search_symbols,mcp__jcodemunch__search_text,mcp__jcodemunch__get_file_outline,mcp__jcodemunch__get_symbol_source", ' +
          'затем index_folder { path: "' + cwd.replace(/\\/g, '\\\\') + '" }. Если задача разовая и кода почти нет, пропусти.',
      },
    }));
  } catch {}
});

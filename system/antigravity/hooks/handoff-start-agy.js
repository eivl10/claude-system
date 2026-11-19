// Antigravity SessionStart: подаёт карточку проекта HANDOFF.md и проверки по датам файлов.
// Обёртка над handoff-start-core.js (точная копия хука Claude Code handoff-start.js, логика та же: указатель, папка проектов, режим .handoff-mode).
// Протокол Antigravity: JSON в stdin (conversationId, workspacePaths, ...), ответ {"injectSteps":[...]} в stdout.
// Модель получает карточку как systemMessage; владелец одной строкой «Передача проекта: ...» через metadata.user_markdown.
// Тихий провал: любая ошибка = пустой вывод. Проверка руками: echo {"workspacePaths":["<папка>"]} | node handoff-start-agy.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

setTimeout(() => process.exit(0), 9000).unref();

function readCard(cwd) {
  const core = path.join(__dirname, 'handoff-start-core.js');
  const out = execFileSync(process.execPath, [core, '--cwd', cwd, '--plain'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
  return String(out || '').trim();
}

// Собирает карточку: { ctx, msg } или null. ctx идёт модели, msg это строка для владельца.
function build(inp) {
  const dirs = [];
  if (inp.cwd) dirs.push(String(inp.cwd));
  for (const w of inp.workspacePaths || []) dirs.push(String(w));
  for (const d of dirs) {
    if (!d || !fs.existsSync(d)) continue;
    let ctx = '';
    try { ctx = readCard(d); } catch { continue; }
    if (!ctx) continue;
    // Строку «скажи владельцу, какая карточка подана» ядро пишет для Claude; здесь её показывает сам хук.
    const idx = ctx.lastIndexOf('В первом ответе сессии одной короткой строкой скажи владельцу');
    let msg = '';
    if (idx >= 0) {
      const m = /«(Передача проекта:[\s\S]*?)»\s*Потом сразу/.exec(ctx.slice(idx));
      msg = m ? m[1] : '';
      ctx = ctx.slice(0, idx).trim();
    }
    return { ctx, msg };
  }
  return null;
}

// SessionStart: владельцу строка «Передача проекта: ...». Саму карточку модели подаёт PreInvocation (agy-hooks.js) на первом вызове:
// проверка 19.11.2026 показала, что в режиме agy -p вставка из SessionStart до модели не доходит, а из PreInvocation доходит.
function main(inp) {
  const r = build(inp);
  if (!r || !r.msg) return null;
  return { injectSteps: [{ systemMessage: { systemMessage: '', metadata: { user_markdown: r.msg } } }] };
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      let inp = {};
      try { inp = JSON.parse(raw.replace(/^﻿/, '')); } catch {}
      const r = main(inp);
      // след в журнале для диагностики: что пришло на вход и подали ли карточку
      try { fs.appendFileSync(path.join(require('os').tmpdir(), 'agy-handoff-start.log'), JSON.stringify({ ts: new Date().toISOString(), inputKeys: Object.keys(inp), cwd: inp.cwd || null, workspacePaths: inp.workspacePaths || null, served: !!r }) + '\n'); } catch {}
      if (r) process.stdout.write(JSON.stringify(r));
    } catch {}
  });
} else {
  module.exports = { main, build };
}

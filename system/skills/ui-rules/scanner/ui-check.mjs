#!/usr/bin/env node
// Проверялка правил интерфейса. Node 18+, без зависимостей, без сети, без ИИ.
// Только показывает найденное, файлы не меняет.
// Запуск: node ui-check.mjs <папка проекта> [--tokens <файл>]... [--diff] [--strict]

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const EXT = new Set(['.css', '.scss', '.html', '.jsx', '.tsx', '.js', '.ts', '.vue', '.svelte', '.astro', '.py']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'venv', '__pycache__', 'vendor']);

const CODE_TITLE = {
  color: 'сырой цвет вне файла значений',
  px: 'сырой размер в px вне файла значений',
  blur: 'размытие',
  shadow: 'тень',
  gradient: 'градиент',
  red: 'красный оттенок',
  emoji: 'цветной эмодзи-значок в боте',
  inter: 'шрифт Inter',
};
const CODE_ORDER = Object.keys(CODE_TITLE);

// ---------- аргументы ----------
function parseArgs(argv) {
  const o = { project: null, tokens: [], diff: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tokens') o.tokens.push(argv[++i]);
    else if (a === '--diff') o.diff = true;
    else if (a === '--strict') o.strict = true;
    else if (!o.project) o.project = a;
  }
  return o;
}

// ---------- цвет ----------
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (mx === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: s * 100, l: l * 100 };
}
function isRed({ h, s }) {
  return s > 40 && (h >= 345 || h <= 15);
}
function hexToRgb(hex) {
  let x = hex.slice(1);
  if (x.length === 3 || x.length === 4) x = [...x].map((c) => c + c).join('');
  return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
}

// ---------- подготовка текста ----------
function stripComments(text, ext) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  let t = text;
  if (ext !== '.py') t = t.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (ext === '.html' || ext === '.vue' || ext === '.svelte' || ext === '.astro') {
    t = t.replace(/<!--[\s\S]*?-->/g, blank);
  }
  return t;
}

// номера строк (с 1) внутри блоков :root { ... }
function rootLines(text) {
  const set = new Set();
  const re = /:root\s*\{/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1, i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    }
    const a = text.slice(0, m.index).split('\n').length;
    const b = text.slice(0, i).split('\n').length;
    for (let n = a; n <= b; n++) set.add(n);
    re.lastIndex = i;
  }
  return set;
}

// ---------- проверки одной строки ----------
const RE = {
  hex: /(?<![\w&])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/g,
  fn: /\b(rgba?|hsla?)\(\s*([^)]*)\)/gi,
  px: /(?<![\w.#-])(\d*\.?\d+)px\b/g,
  blur: /\bblur\s*\(|backdrop-filter|backdropFilter/gi,
  shadow: /(box-shadow|text-shadow|boxShadow|textShadow)\s*['"]?\s*[:=]\s*['"`]?\s*(?!none\b|inherit\b|unset\b|initial\b|['"`]?\s*[;}'"`])[^\s;}]/g,
  dropShadow: /drop-shadow\s*\(/g,
  gradient: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\b/g,
  bad: /[❌✅]/u,
  emojiVs: /[©®‼-㊙][️]/u,
  emojiPres: /\p{Emoji_Presentation}/u,
  inter: /\bInter\b/,
};

function parseFnColor(name, args) {
  const nums = args.replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
  const n = (i) => parseFloat(nums[i]);
  if (/^rgb/i.test(name)) {
    if (nums.slice(0, 3).some((x) => isNaN(parseFloat(x)))) return null; // переменные внутри
    return rgbToHsl(n(0), n(1), n(2));
  }
  if (nums.slice(0, 3).some((x) => isNaN(parseFloat(x)))) return null;
  const s = n(1);
  return { h: ((n(0) % 360) + 360) % 360, s, l: n(2) };
}

function scanFile(file, text, opts) {
  const ext = path.extname(file).toLowerCase();
  const clean = stripComments(text, ext);
  const lines = clean.split('\n');
  const rawLines = text.split('\n');
  const isTokensFile = opts.tokenSet.has(path.resolve(file));
  const rootSet = opts.tokenSet.size === 0 ? rootLines(clean) : new Set();
  const out = [];
  const add = (n, code, frag) => out.push({ line: n, code, frag: frag.trim().slice(0, 90) });

  lines.forEach((ln, idx) => {
    const n = idx + 1;
    if (!ln.trim()) return;
    const exempt = isTokensFile || rootSet.has(n);
    const snippet = rawLines[idx] ?? ln;
    const skipHref = /\bhref\s*=\s*["']#|url\(\s*["']?#/i.test(ln);

    // цвета и красный
    let m;
    RE.hex.lastIndex = 0;
    while ((m = RE.hex.exec(ln))) {
      if (skipHref) break;
      const full = m[0];
      if (!exempt) add(n, 'color', full);
      const [r, g, b] = hexToRgb(full);
      if (isRed(rgbToHsl(r, g, b))) add(n, 'red', full);
    }
    RE.fn.lastIndex = 0;
    while ((m = RE.fn.exec(ln))) {
      if (!exempt) add(n, 'color', m[0]);
      const hsl = parseFnColor(m[1], m[2]);
      if (hsl && isRed(hsl)) add(n, 'red', m[0]);
    }

    // px
    if (!exempt && !/@media|@container/.test(ln)) {
      RE.px.lastIndex = 0;
      while ((m = RE.px.exec(ln))) {
        const v = parseFloat(m[1]);
        if (v === 0 || v === 1) continue;
        add(n, 'px', m[0]);
      }
    }

    if (RE.blur.test(ln)) add(n, 'blur', ln);
    RE.blur.lastIndex = 0;

    RE.shadow.lastIndex = 0;
    if (RE.shadow.test(ln) || /drop-shadow\s*\(/.test(ln)) add(n, 'shadow', ln);

    if (RE.gradient.test(ln)) add(n, 'gradient', ln);
    RE.gradient.lastIndex = 0;

    if (ext === '.py') {
      const raw = snippet;
      if (RE.bad.test(raw) || RE.emojiVs.test(raw) || RE.emojiPres.test(raw)) {
        const mm = raw.match(/[❌✅]|\p{Emoji_Presentation}|[©®‼-㊙]️/u);
        add(n, 'emoji', mm ? mm[0] + '  ' + raw : raw);
      }
    }

    if (RE.inter.test(ln) && (/font/i.test(ln) || /\bInter\b\s*['",;:)]/.test(ln) || /['"]Inter\b/.test(ln))) {
      add(n, 'inter', ln);
    }
  });
  return out;
}

// ---------- обход папки ----------
function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      if (/\.min\./i.test(e.name)) continue;
      if (EXT.has(path.extname(e.name).toLowerCase())) acc.push(full);
    }
  }
  return acc;
}

// ---------- git diff ----------
function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}
function addedLines(project) {
  // возвращает Map(абсолютный путь -> Set(номера строк) | 'all') или null
  try {
    const top = git(['rev-parse', '--show-toplevel'], project).trim();
    const map = new Map();
    const diff = git(['diff', 'HEAD', '-U0', '--no-color', '--no-ext-diff', '--', '.'], project);
    let cur = null;
    for (const ln of diff.split('\n')) {
      if (ln.startsWith('+++ ')) {
        cur = ln.startsWith('+++ /dev/null') ? null : path.resolve(top, ln.slice(6));
        if (cur && !map.has(cur)) map.set(cur, new Set());
      } else if (cur && ln.startsWith('@@')) {
        const m = ln.match(/\+(\d+)(?:,(\d+))?/);
        const start = +m[1], cnt = m[2] === undefined ? 1 : +m[2];
        for (let i = 0; i < cnt; i++) map.get(cur).add(start + i);
      }
    }
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', '.'], project).split('\n').filter(Boolean);
    for (const u of untracked) map.set(path.resolve(project, u), 'all');
    return map;
  } catch {
    return null;
  }
}

// ---------- основной ход ----------
function main() {
  const t0 = Date.now();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.project) {
    console.log('Использование: node ui-check.mjs <папка проекта> [--tokens <файл>]... [--diff] [--strict]');
    process.exit(0);
  }
  const project = path.resolve(opts.project);
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    console.log('Папка не найдена: ' + project);
    process.exit(opts.strict ? 1 : 0);
  }

  // файлы значений
  const tokenPaths = opts.tokens.filter(Boolean).map((p) => path.resolve(p));
  if (tokenPaths.length === 0) {
    const rules = path.join(project, 'UI-RULES.md');
    if (fs.existsSync(rules)) {
      const txt = fs.readFileSync(rules, 'utf8');
      for (const m of txt.matchAll(/^\s*Файл значений:\s*`?([^`\n]+?)`?\s*$/gm)) {
        const p = m[1].trim();
        if (p.startsWith('<')) continue;
        tokenPaths.push(path.resolve(project, p));
      }
    }
  }
  opts.tokenSet = new Set(tokenPaths);
  console.log(
    tokenPaths.length
      ? 'Файлы значений: ' + tokenPaths.join('; ')
      : 'Файл значений не задан: блоки :root { ... } считаются файлом значений.'
  );

  let diffMap = null;
  if (opts.diff) {
    diffMap = addedLines(project);
    if (!diffMap) console.log('Режим --diff: git недоступен или нет коммитов. Проверяю всё.');
    else console.log('Режим --diff: смотрю только добавленные строки.');
  }

  const files = walk(project, []);
  const results = [];
  for (const f of files) {
    let lim = null;
    if (diffMap) {
      const v = diffMap.get(path.resolve(f));
      if (!v) continue;
      lim = v === 'all' ? null : v;
    }
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    let found = scanFile(f, text, opts);
    if (lim) found = found.filter((x) => lim.has(x.line));
    if (found.length) results.push({ file: f, found });
  }

  const totals = {};
  for (const r of results) {
    console.log('\n' + path.relative(project, r.file));
    for (const x of r.found) {
      console.log(`${path.relative(project, r.file)}:${x.line}  ${x.code}  ${x.frag}`);
      totals[x.code] = (totals[x.code] || 0) + 1;
    }
  }

  const all = Object.values(totals).reduce((a, b) => a + b, 0);
  console.log('\nСводка');
  if (!all) console.log('Нарушений не найдено.');
  for (const c of CODE_ORDER) if (totals[c]) console.log(`  ${c}: ${totals[c]}  (${CODE_TITLE[c]})`);
  console.log(`Файлов проверено: ${files.length}. Нарушений: ${all}. Время: ${Date.now() - t0} мс.`);
  if (opts.diff && diffMap) {
    const part = CODE_ORDER.filter((c) => totals[c]).map((c) => `+${totals[c]} ${c}`);
    console.log('Итог по diff: ' + (part.length ? part.join(', ') : 'ничего нового'));
  }
  process.exit(opts.strict && all ? 1 : 0);
}

main();

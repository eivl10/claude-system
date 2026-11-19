// SessionStart (startup|resume|compact|clear): кладёт в контекст карточку проекта HANDOFF.md и проверки по датам файлов. Без модели.
// Схема: <VIBECODING>\_Проекты\Оптимизация Клода и Аги\Передача проекта дальше\Предложение.md (17.11.2026), Логичный лимит.md (18.11.2026).
// Режим проекта: файл .handoff-mode рядом с HANDOFF.md, одно слово full|short|off. Нет файла: full.
// Тихий провал: любая ошибка даёт пустой вывод. Защита от зависания: бюджет обхода файлов 3 секунды, git по 2 секунды, таймаут в settings.json 8 секунд.
// Бюджет текста: сначала считается блок проверок (не больше CHECKS_MAX, режется по целым строкам), карточке достаётся остаток до TOTAL_MAX.
// Потолок вывода TOTAL_MAX 9500: предел Claude Code 10000 знаков на каждый хук отдельно, запас 500. Зон нет: норма карточки NORM 7500 только для автора и сообщений, на подачу не влияет.
// Подача по важности: ядро (5, 6, 1, 3), затем справка (4, 2, 8, 7, 9+). Сборка в порядке документа. Что не подано, пишет пометка в конце карточки.
// Проверка руками: node handoff-start.js --cwd "<папка>" [--mode full|short|off] [--card <имя файла>] --plain
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

setTimeout(() => process.exit(0), 5000).unref();

const STOP_ROOT = '<VIBECODING>';
const TOTAL_MAX = 9500;
const CHECKS_MAX = 1500;
const NORM = 7500; // норма карточки для автора: нужна для комментариев и сообщений, логику подачи не меняет
const CORE_MAX = 6000;
const PRE_MAX = 600;
const NOTE_RESERVE = 350;
const WALK_BUDGET_MS = 3000;
const WALK_FILE_CAP = 30000;
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', 'tmp-agy', '_архив', '.agy', '.gemini', '.idea', '.vscode', '.cache', 'logs', '.pytest_cache', '.gradle', '.claude']);
const SKIP_EXT = /\.(log|jsonl|tmp|pyc|wav|mp3|m4a|ogg|flac|aac|db|db-wal|db-shm|wal|shm|sqlite|lock)$/i;
const SKIP_NAME = /^(~\$.*|thumbs\.db|\.ds_store|ЖУРНАЛ\.md)$/i;

const norm = (p) => String(p).replace(/\//g, '\\').replace(/\\+$/, '');
const fmt = (ms) => {
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${z(d.getDate())}.${z(d.getMonth() + 1)} ${z(d.getHours())}:${z(d.getMinutes())}`;
};

// Режет по символам, не оставляя половину суррогатной пары.
function cut(s, n) {
  if (s.length <= n) return s;
  let r = s.slice(0, n);
  const last = r.charCodeAt(r.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) r = r.slice(0, -1);
  return r;
}

// Режет по целым строкам, ни одна строка не обрывается посередине.
function cutLines(text, limit) {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;
  const lines = text.split(/\r?\n/);
  const out = [];
  let curLen = 0;
  for (const line of lines) {
    const nextLen = out.length === 0 ? line.length : curLen + 1 + line.length;
    if (nextLen <= limit) {
      out.push(line);
      curLen = nextLen;
    } else {
      break;
    }
  }
  return out.join('\n');
}

function argOf(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : '';
}

const CARD = argOf('--card') || 'HANDOFF.md'; // другое имя файла карточки только для проверки руками

function findCard(cwd) {
  let dir = norm(cwd);
  if (/\\\.claude(\\|$)/i.test(dir)) return ''; // служебная папка Claude, там чужие старые HANDOFF
  if (CARD !== 'HANDOFF.md') return fs.existsSync(path.join(dir, CARD)) ? dir : '';
  for (let i = 0; i < 12; i++) {
    if (!dir || dir.toLowerCase() === STOP_ROOT) return '';
    if (fs.existsSync(path.join(dir, CARD))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return '';
    dir = up;
  }
  return '';
}

// Режим берётся из ближайшего файла .handoff-mode: от рабочей папки вверх до <VIBECODING> не включая его.
function readMode(start) {
  let dir = norm(start);
  for (let i = 0; i < 12; i++) {
    if (!dir || dir.toLowerCase() === STOP_ROOT) break;
    try {
      const buf = fs.readFileSync(path.join(dir, '.handoff-mode'));
      let s = buf.length > 1 && buf[0] === 0xFF && buf[1] === 0xFE ? buf.toString('utf16le') : buf.toString('utf8');
      s = s.replace(/[\uFEFF\u0000]/g, '').trim().toLowerCase();
      if (s === 'short' || s === 'off' || s === 'full') return s;
    } catch {}
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return 'full';
}

// Делит карточку на разделы по строкам "## ..." (для shortCard)
function sections(text) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^##\s+/.test(line)) { cur = { title: line.replace(/^##\s+/, ''), body: [line] }; out.push(cur); }
    else if (cur) cur.body.push(line);
  }
  return out;
}

// Короткая карточка: состояние, правила владельца, мины, строка «План:». null, если карточка не по шаблону.
function shortCard(text) {
  const secs = sections(text);
  const pick = (re) => secs.filter((s) => re.test(s.title));
  const keep = [...pick(/состояние/i), ...pick(/решения и правила/i), ...pick(/мины/i)];
  const plan = text.split(/\r?\n/).filter((l) => /^(план|plan)\s*:/i.test(l.trim()));
  if (!keep.length) return null;
  const body = keep.map((s) => s.body.join('\n').trim()).join('\n\n') + (plan.length ? '\n\n' + plan.join('\n') : '');
  const shown = keep.map((s) => s.title.split(/[.\s]/).filter(Boolean)[0]).join(', ');
  return { body, note: `Короткий режим: показаны разделы ${shown}. Остальное в HANDOFF.md, открой при необходимости.` };
}

// Делит карточку на преамбулу и разделы ТОЛЬКО по строкам вида "^##\s+(\d+)\.\s"
function parseScheme(text) {
  const allLines = text.split(/\r?\n/);
  const preLines = [];
  const secs = new Map();
  const docOrder = [];
  let curSec = null;
  const found1to8 = new Set();

  for (const line of allLines) {
    const m = line.match(/^##\s+(\d+)\.\s/);
    if (m) {
      const N = parseInt(m[1], 10);
      curSec = { N, headLine: line, lines: [], len: 0 };
      secs.set(N, curSec);
      docOrder.push(curSec);
      if (N >= 1 && N <= 8) {
        found1to8.add(N);
      }
    } else {
      if (curSec) {
        curSec.lines.push(line);
      } else {
        preLines.push(line);
      }
    }
  }

  for (const s of docOrder) {
    let totalLen = s.headLine.length + 1;
    for (const l of s.lines) {
      totalLen += l.length + 1;
    }
    s.len = totalLen;
  }

  const pre = preLines.join('\n');
  const ok = found1to8.size >= 4;
  const total = text.trim().length;

  return { pre, secs, ok, docOrder, total };
}

// Подача по важности: ядро [5, 6, 1, 3], справка [4, 2, 8, 7], затем 9+. Сборка в порядке документа.
function packCard(parsed, limit) {
  const preServed = cutLines(parsed.pre, PRE_MAX).trim();
  const preCost = preServed ? preServed.length + 2 : 0;
  let remaining = limit - preCost - NOTE_RESERVE;

  const priority = [5, 6, 1, 3, 4, 2, 8, 7];
  for (const s of parsed.docOrder) {
    if (!priority.includes(s.N)) priority.push(s.N);
  }

  const whole = [];
  const partial = [];
  const notServed = [];
  let coreCut = false;

  for (const N of priority) {
    const matching = parsed.docOrder.filter((s) => s.N === N);
    if (!matching.length) continue;

    for (const sec of matching) {
      const isCore = [1, 3, 5, 6].includes(N);
      const wholeLines = [sec.headLine, ...sec.lines];
      const wholeText = wholeLines.join('\n');
      const wholeCost = wholeText.length + 2;

      if (wholeCost <= remaining) {
        sec.renderedText = wholeText;
        remaining -= wholeCost;
        whole.push(N);
      } else if (isCore) {
        let fitted = false;
        for (let j = sec.lines.length - 1; j >= 1; j--) {
          const k = sec.lines.length - j;
          const pointer = `… ещё ${k} строк раздела ${N} не поданы, читай HANDOFF.md`;
          const cand = [sec.headLine, ...sec.lines.slice(0, j), pointer].join('\n');
          if (cand.length + 2 <= remaining) {
            sec.renderedText = cand;
            remaining -= (cand.length + 2);
            partial.push(N);
            coreCut = true;
            fitted = true;
            break;
          }
        }
        if (!fitted) {
          const pointer = `… ещё ${sec.lines.length} строк раздела ${N} не поданы, читай HANDOFF.md`;
          const cand = [sec.headLine, pointer].join('\n');
          sec.renderedText = cand;
          remaining -= (cand.length + 2);
          partial.push(N);
          coreCut = true;
        }
      } else {
        let fitted = false;
        for (let j = sec.lines.length - 1; j >= 3; j--) {
          const k = sec.lines.length - j;
          const pointer = `… ещё ${k} строк раздела ${N} не поданы, читай HANDOFF.md`;
          const cand = [sec.headLine, ...sec.lines.slice(0, j), pointer].join('\n');
          if (cand.length + 2 <= remaining) {
            sec.renderedText = cand;
            remaining -= (cand.length + 2);
            partial.push(N);
            fitted = true;
            break;
          }
        }
        if (!fitted) {
          const placeholder = `[раздел ${N} не подан: ${sec.len} знаков, читай HANDOFF.md]`;
          const cand = [sec.headLine, placeholder].join('\n');
          // Заглушка не должна залезать в резерв под итоговую пометку: не влезла, раздел только назван в пометке.
          if (cand.length + 2 <= remaining) {
            sec.renderedText = cand;
            remaining -= (cand.length + 2);
          }
          notServed.push(N);
        }
      }
    }
  }

  // Сборка в порядке документа
  const blocks = [];
  if (preServed) blocks.push(preServed);
  for (const s of parsed.docOrder) {
    if (s.renderedText) blocks.push(s.renderedText);
  }
  const bodyWithoutNote = blocks.join('\n\n');

  const total = parsed.total || bodyWithoutNote.length;
  const served = bodyWithoutNote.length;

  let note = '';
  const preCut = parsed.pre && (preServed !== parsed.pre.trim());
  if (notServed.length > 0 || partial.length > 0 || coreCut || preCut) {
    const parts = [];
    parts.push(`Подано ${served} из ${total} знаков карточки.`);
    if (coreCut) {
      parts.push('Ядро не влезло в подачу, читай HANDOFF.md.');
    }
    if (notServed.length > 0) {
      const sorted = [...new Set(notServed)].sort((a, b) => a - b);
      parts.push(`Целиком не подано: разделы ${sorted.join(', ')}.`);
    }
    if (partial.length > 0) {
      const sorted = [...new Set(partial)].sort((a, b) => a - b);
      parts.push(`Частично: разделы ${sorted.join(', ')}.`);
    }
    parts.push('Остальное в HANDOFF.md.');
    parts.push('Сожми карточку или вынеси подробности в отдельный файл со ссылкой из раздела 8.');
    note = '(' + parts.join(' ') + ')';
  }

  const text = note ? (bodyWithoutNote + '\n\n' + note) : bodyWithoutNote;
  return { text, served, total, whole, partial, notServed, coreCut };
}

function walk(root, since, cardPath) {
  const t0 = Date.now();
  const newer = [];
  const nested = [];
  let visited = 0;
  let stopped = false;
  const stack = [root];
  while (stack.length) {
    if (Date.now() - t0 > WALK_BUDGET_MS || visited > WALK_FILE_CAP) { stopped = true; break; }
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      visited++;
      if (SKIP_EXT.test(e.name) || SKIP_NAME.test(e.name)) continue;
      if (full.toLowerCase() === cardPath.toLowerCase()) continue;
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (st.mtimeMs <= since + 2000) continue;
      newer.push({ full, m: st.mtimeMs });
      // вложенный HANDOFF: только в подпапках, файлы рядом с карточкой не в счёт
      if (/^HANDOFF.*\.md$/i.test(e.name) && path.dirname(full).toLowerCase() !== root.toLowerCase()) nested.push({ full, m: st.mtimeMs });
    }
  }
  return { newer, nested, stopped };
}

function missingPaths(text, root) {
  const found = new Set();
  const add = (p) => { if (p) found.add(p); };
  const clean = (s) => s.trim().replace(/[,.;:)]+$/, '').replace(/:\d+(-\d+)?$/, '');
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const s = clean(m[1]);
    if (/[*<>?|]|\.\.\./.test(s)) continue;
    if (/^[A-Za-z]:[\\/]/.test(s)) add(s);
    else if (/^[\wа-яёА-ЯЁ.\-]+(\/[\wа-яёА-ЯЁ.\-]+)+\.\w{1,5}$/.test(s)) add(path.join(root, s)); // относительный путь к файлу с расширением
  }
  for (const m of text.matchAll(/\]\(([^)\s]+(?:\s[^)]*)?)\)/g)) {
    let s = m[1].trim();
    if (/^(https?:|mailto:|tg:|#)/i.test(s) || s.includes('://') || s.startsWith('/')) continue;
    try { s = decodeURIComponent(s); } catch {}
    s = clean(s.replace(/#.*$/, ''));
    if (s) add(/^[A-Za-z]:[\\/]/.test(s) ? s : path.join(root, s));
  }
  const miss = [];
  for (const p of found) {
    if (/[*<>?|]|\.\.\.|~/.test(p)) continue;
    try { if (!fs.existsSync(p)) miss.push(p); } catch {}
  }
  return miss;
}

function gitInfo(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return null;
  const run = (args) => execFileSync('git', ['-C', root, ...args], { timeout: 2000, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let last = '';
  let dirty = '';
  try { last = run(['log', '-1', '--format=%h %ad %s', '--date=format:%d.%m %H:%M']); } catch {}
  try { const n = run(['status', '--porcelain']).split('\n').filter(Boolean).length; dirty = n ? `${n} файлов` : 'нет'; } catch {}
  return { last, dirty };
}

// Дата в заголовке: ДД.ММ.ГГГГ или ГГГГ-ММ-ДД. Предупреждение, если она старше изменения файла на 2 дня и больше.
function headerDateWarn(firstLine, mtimeMs) {
  let d = null;
  let shown = '';
  let m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(firstLine);
  if (m) { d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); shown = m[0]; }
  else if ((m = /(\d{4})-(\d{2})-(\d{2})/.exec(firstLine))) { d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); shown = m[0]; }
  if (!d) return '';
  const fileDay = new Date(mtimeMs); fileDay.setHours(0, 0, 0, 0);
  if ((fileDay.getTime() - d.getTime()) / 86400000 >= 2) return `В заголовке карточки дата ${shown}, а файл изменён ${fmt(mtimeMs)}.`;
  return '';
}

function buildChecks(root, st, text, lines, cardPath, parsed, umbrella) {
  const warns = [];
  const p = parsed || parseScheme(text);

  // Единственное предупреждение про размер: ядро карточки по схеме больше CORE_MAX. Остальное, что не влезло, пишет пометка в конце карточки.
  if (p && p.ok) {
    let core = 0;
    for (const s of p.docOrder) {
      if ([1, 3, 5, 6].includes(s.N)) {
        core += s.len;
      }
    }
    if (core > CORE_MAX) {
      warns.push(`Ядро карточки ${core} знаков, больше ${CORE_MAX}, оно может не влезть. Сожми разделы 1, 3, 5, 6.`);
    }
  }

  const hw = headerDateWarn(lines[0] || '', st.mtimeMs);
  if (hw) warns.push(hw);
  const miss = missingPaths(text, root);
  if (miss.length) warns.push(`В карточке пути, которых нет на диске, ${miss.length}: ${miss.slice(0, 5).map((p) => p.replace(root + '\\', '')).join('; ')}${miss.length > 5 ? '; ...' : ''}.`);
  try {
    const rs = fs.statSync(path.join(root, 'README.md'));
    if (st.mtimeMs - rs.mtimeMs > 14 * 86400 * 1000) warns.push(`README.md изменён ${fmt(rs.mtimeMs)}, карточка свежее больше чем на 14 дней: README мог устареть.`);
  } catch {}

  // папка проектов: обход всего дерева не нужен, подпроекты перечислены списком выше
  const { newer, nested, stopped } = umbrella ? { newer: [], nested: [], stopped: false } : walk(root, st.mtimeMs, cardPath);
  const nest = nested.filter((n) => n.m > st.mtimeMs).sort((a, b) => b.m - a.m);
  if (nest.length && !umbrella) warns.push(`Глубже в дереве есть HANDOFF новее корневого: ${nest.slice(0, 3).map((n) => `${path.relative(root, n.full).replace(/\\/g, '/')} от ${fmt(n.m)}`).join('; ')}. Скорее всего работа шла там. Если карточек несколько и неясно, какая нужна, спроси владельца одной строкой.`);

  const g = gitInfo(root);
  const out = ['=== Проверки по датам файлов, без модели ==='];
  // Предупреждения первыми: при нехватке места режется конец блока, то есть список файлов, а не предупреждения.
  // Одно предупреждение не длиннее 400 знаков: иначе одна длинная строка не поместится в блок и вытеснит все остальные.
  for (const w of warns) out.push('ВНИМАНИЕ: ' + (w.length > 400 ? cut(w, 399) + '…' : w));
  if (!umbrella) out.push(`Файлов новее карточки: ${newer.length}${stopped ? ', обход остановлен по лимиту, число неполное' : ''}.`);
  if (newer.length) {
    newer.sort((a, b) => b.m - a.m);
    const groups = new Map();
    for (const f of newer.slice(0, 5)) {
      const rel = path.relative(root, f.full).replace(/\\/g, '/');
      const d = path.posix.dirname(rel) === '.' ? './' : path.posix.dirname(rel) + '/';
      if (!groups.has(d)) groups.set(d, []);
      groups.get(d).push(`${path.basename(rel)} ${fmt(f.m)}`);
    }
    out.push('5 самых свежих:');
    for (const [d, arr] of groups) out.push(`  ${d}: ${arr.join(', ')}`);
  }
  if (g) {
    if (g.last) out.push(`Последний коммит: ${g.last}.`);
    if (g.dirty) out.push(`Не закоммичено: ${g.dirty}.`);
  } else out.push('Папка не под git, часть про git пропущена.');
  let body = out.join('\n');
  const tail = '\nПервое действие: сверь с диском разделы «Сделано» и «Не закончено», если они поданы, иначе сначала открой HANDOFF.md, потом работай.';
  const mark = ' [проверки обрезаны]';
  // Блок вместе с хвостом и пометкой не больше CHECKS_MAX. Тело режется по целым строкам, хвост всегда на месте.
  if (body.length + tail.length > CHECKS_MAX) body = cutLines(body, CHECKS_MAX - tail.length - mark.length) + mark;
  return body + tail;
}

function build(root, mode, why, extra) {
  const cardPath = path.join(root, CARD);
  const st = fs.statSync(cardPath);
  const text = fs.readFileSync(cardPath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const name = path.basename(root);
  const head = `=== HANDOFF проекта «${name}»: карточка от ${fmt(st.mtimeMs)}, режим ${mode}${why ? '; ' + why : ''} ===`;

  const parsed = parseScheme(text);
  let checks = buildChecks(root, st, text, lines, cardPath, parsed, !!extra);
  if (extra) checks = extra + '\n\n' + checks;
  const limit = Math.max(1000, TOTAL_MAX - checks.length - head.length - 4);

  let body = '';
  if (mode === 'short') {
    const sc = shortCard(text);
    if (sc) {
      const scBody = sc.body.trim();
      const noteStr = `(${sc.note})`;
      const needed = scBody.length + 2 + noteStr.length;
      if (needed <= limit) {
        body = `${scBody}\n\n${noteStr}`;
      } else {
        const cut = cutLines(scBody, limit - noteStr.length - 2);
        body = `${cut}\n\n${noteStr}`;
      }
    } else {
      const rawBody = text.trim();
      const noteStr = `(Короткий режим не сработал: в карточке нет разделов по новому шаблону, показано начало целиком.)`;
      const needed = rawBody.length + 2 + noteStr.length;
      if (needed <= limit) {
        body = `${rawBody}\n\n${noteStr}`;
      } else {
        const cut = cutLines(rawBody, limit - noteStr.length - 2);
        body = `${cut}\n\n${noteStr}`;
      }
    }
  } else {
    // Режим full
    const rawBody = text.trim();
    if (rawBody.length <= limit) {
      body = rawBody;
    } else if (parsed.ok) {
      const packed = packCard(parsed, limit);
      body = packed.text;
    } else {
      const cut = cutLines(rawBody, limit - NOTE_RESERVE);
      const note = `(Карточка не по схеме и не влезла: подано ${cut.length} из ${rawBody.length} знаков, остальное в HANDOFF.md. Переведи её в схему по скиллу handoff.)`;
      body = `${cut}\n\n${note}`;
    }
  }

  let card = `${head}\n\n${body}`;
  const room = TOTAL_MAX - checks.length - 2;
  if (card.length > room) {
    card = cutLines(card, room);
  }
  return cut(card + '\n\n' + checks, TOTAL_MAX);
}

// Указатель в корневой карточке: строка «Актуальная карточка: путь/к/HANDOFF.md» (обычный путь или markdown-ссылка), путь от папки карточки.
// Его пишет скилл handoff, когда пишет карточку в подпапку, где корневая старее.
const POINTER_RE = /^[ \t>*_-]*Актуальная карточка[*_]*\s*:\s*(.+?)\s*$/im;

function pointerTarget(root, text) {
  const m = POINTER_RE.exec(text);
  if (!m) return '';
  let s = m[1].trim();
  const link = /\]\(([^)]+)\)/.exec(s);
  if (link) s = link[1].trim();
  s = s.replace(/^[`"']+|[`"'.]+$/g, '');
  try { s = decodeURIComponent(s); } catch {}
  if (!s) return '';
  const full = path.isAbsolute(s) ? s : path.join(root, s);
  let dir = full;
  try { if (fs.statSync(full).isFile()) dir = path.dirname(full); } catch { return ''; }
  if (!fs.existsSync(path.join(dir, CARD))) return '';
  return dir;
}

// Запасной выбор без указателя: ровно одна вложенная карточка HANDOFF.md новее корневой, глубина до 3. Несколько кандидатов: не гадаем.
function findNewerNested(root, since) {
  const t0 = Date.now();
  const found = [];
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (Date.now() - t0 > 1500) break;
    const { dir, depth } = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || /^_?(backup|archive|old)/i.test(e.name) || depth >= 3) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (depth > 0 && e.name === CARD) {
        try { const m = fs.statSync(full).mtimeMs; if (m > since + 2000) found.push({ dir, m }); } catch {}
      }
    }
  }
  return found;
}

// Папка проектов: в корневой карточке строка «Папка проектов: ...». Карточка подаётся как есть, подпроекты хук перечисляет сам, свежим списком.
const UMBRELLA_RE = /^[ \t>*_-]*Папка проектов[*_]*\s*:/im;

function firstSentence(text, n) {
  const sec = /^##\s+(?:\d+\.\s*)?(?:Состояние|О проекте|Суть|Статус)[^\n]*\n([\s\S]*?)(?=\n##\s|$)/im.exec(text);
  let s = sec ? sec[1] : '';
  if (!s.trim()) {
    // запасной вариант: первая обычная строка текста, не список, не таблица, не путь к файлу
    s = text.split(/\r?\n/).filter((l) => { const t = l.trim(); return t && !/^[#|>=`-]|^\d+\.|^карточка перезаписывается|^папка проектов/i.test(t) && t.length > 25; })[0] || '';
  }
  s = s.replace(/\r?\n/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_>]/g, '').trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  s = (m ? m[1] : s);
  return cut(s, n) + (s.length > n ? '…' : '');
}

// Живой список вложенных карточек: путь, дата, заголовок и первая фраза состояния. Свежие первыми.
function buildIndex(root) {
  const items = [];
  const t0 = Date.now();
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (Date.now() - t0 > 2000) break;
    const { dir, depth } = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    // вложенная папка проектов: перечисляем её одной строкой, внутрь не заходим
    let inner = false;
    if (depth > 0) { try { inner = UMBRELLA_RE.test(fs.readFileSync(path.join(dir, CARD), 'utf8')); } catch {} }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (inner) continue;
        if (readMode(full) === 'off') continue; // папки с режимом off в список не входят
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || /^_?(backup|archive|old)|backup_|^handoff-test$/i.test(e.name) || depth >= 3) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (depth > 0 && e.name === CARD) {
        try {
          const m = fs.statSync(full).mtimeMs;
          const t = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
          const title = ((/^#\s+(.+)$/m.exec(t) || [])[1] || path.basename(dir)).replace(/^HANDOFF\s*[—:-]\s*/i, '').replace(/[*_`]/g, '').trim();
          items.push({ rel: path.relative(root, dir).replace(/\\/g, '/'), m, title: cut(title, 60), state: firstSentence(t, 100) });
        } catch {}
      }
    }
  }
  items.sort((a, b) => b.m - a.m);
  const MAX_ITEMS = 10;
  const lines = ['=== Подпроекты этой папки, у каждого своя карточка HANDOFF.md (хук собрал список сам, свежие первыми) ==='];
  for (const it of items.slice(0, MAX_ITEMS)) lines.push(`- ${it.rel}/ — ${fmt(it.m)} — ${it.title}${it.state && it.state !== it.title ? ': ' + it.state : ''}`);
  if (items.length > MAX_ITEMS) lines.push(`… ещё ${items.length - MAX_ITEMS} карточек глубже, старше по дате.`);
  if (!items.length) lines.push('Вложенных карточек пока нет.');
  lines.push('Какой подпроект нужен, скажет владелец. Неясно: спроси одной строкой, потом открой карточку выбранного.');
  return lines.join('\n');
}

function pickRoot(found) {
  let text = '';
  let st;
  try { st = fs.statSync(path.join(found, CARD)); text = fs.readFileSync(path.join(found, CARD), 'utf8'); } catch { return { root: found, why: '' }; }
  if (UMBRELLA_RE.test(text)) return { root: found, why: '', extra: buildIndex(found) };
  const ptr = pointerTarget(found, text);
  if (ptr && norm(ptr).toLowerCase() !== norm(found).toLowerCase()) {
    return { root: ptr, why: `по указателю из корневой карточки «${path.basename(found)}» от ${fmt(st.mtimeMs)}` };
  }
  const nested = findNewerNested(found, st.mtimeMs);
  if (nested.length === 1) {
    return { root: nested[0].dir, why: `корневая карточка «${path.basename(found)}» от ${fmt(st.mtimeMs)} старее, подана единственная новая вложенная` };
  }
  return { root: found, why: '' };
}

function mainFull(inp) {
  try {
    const cwd = argOf('--cwd') || String(inp.cwd || '');
    if (!cwd) return null;
    const found = findCard(cwd);
    if (!found) return null;
    const mode = argOf('--mode') || readMode(cwd);
    if (mode === 'off') return null;
    const { root, why, extra } = pickRoot(found);
    let ctx = build(root, mode, why, extra);
    const st = fs.statSync(path.join(root, CARD));
    const warns = (ctx.match(/ВНИМАНИЕ:/g) || []).length;
    const msg = `Передача проекта: подана карточка «${path.basename(root)}» от ${fmt(st.mtimeMs)}, режим ${mode}${why ? '. ' + why[0].toUpperCase() + why.slice(1) : ''}${warns ? `. Предупреждений в проверках: ${warns}` : ''}.`;
    ctx += `\n\nВ первом ответе сессии одной короткой строкой скажи владельцу, какая карточка подана (он этот текст не видит): «${msg}» Потом сразу по делу.`;
    return { ctx, msg };
  } catch {
    return null;
  }
}

function main(inp) {
  const r = mainFull(inp);
  return r ? r.ctx : '';
}

if (require.main === module) {
  let raw = '';
  const plain = process.argv.includes('--plain');
  if (plain || process.stdin.isTTY) {
    try { process.stdout.write(main({})); } catch {}
    process.exit(0);
  }
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      let inp = {};
      try { inp = JSON.parse(raw); } catch {}
      const r = mainFull(inp);
      if (!r) return;
      // systemMessage показывается владельцу, additionalContext уходит только агенту
      process.stdout.write(JSON.stringify({ systemMessage: r.msg, hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: r.ctx } }));
    } catch {}
  });
} else {
  module.exports = {
    parseScheme,
    packCard,
    cutLines,
    buildChecks,
    build,
    findCard,
    readMode,
    main,
    TOTAL_MAX,
    CHECKS_MAX,
    NORM,
    CORE_MAX,
    PRE_MAX,
    NOTE_RESERVE
  };
}

// Самопроверка сканера: на папке test-fixture должен найтись каждый код,
// а чистые случаи не должны попасть в список. Выход 0 при успехе.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (args) =>
  spawnSync(process.execPath, [path.join(here, 'ui-check.mjs'), ...args], { encoding: 'utf8' });

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const r = run([path.join(here, 'test-fixture'), '--strict']);
const lines = r.stdout.split('\n');
const hits = lines
  .map((l) => l.match(/^(\S+?):(\d+)  (\w+)  /))
  .filter(Boolean)
  .map((m) => ({ file: m[1], line: +m[2], code: m[3] }));
const has = (file, code) => hits.some((h) => h.file === file && h.code === code);

for (const [file, code] of [
  ['color.css', 'color'], ['px.css', 'px'], ['blur.css', 'blur'], ['shadow.css', 'shadow'],
  ['gradient.css', 'gradient'], ['red.css', 'red'], ['inter.css', 'inter'], ['emoji.py', 'emoji'],
]) check(has(file, code), `не найден код ${code} в ${file}`);

check(r.status === 1, `--strict должен давать 1, дал ${r.status}`);
check(!hits.some((h) => h.file === 'clean.css'), 'clean.css не должен давать находок (комментарии)');
check(!hits.some((h) => h.file === 'red.css' && h.line === 1 && h.code === 'color'), 'цвет внутри :root не должен считаться сырым');
check(has('red.css', 'red') && hits.some((h) => h.file === 'red.css' && h.line === 1 && h.code === 'red'), 'красный в :root должен находиться');
check(hits.filter((h) => h.file === 'px.css').length === 1, 'в px.css ждём одну находку 13px; 0px и 1px не считаются');
check(!hits.some((h) => h.file === 'shadow.css' && h.line === 2), 'box-shadow: none не должен находиться');
check(hits.filter((h) => h.file === 'emoji.py').length === 2, 'в emoji.py ждём ровно 2 находки: ❌ и ✖ с селектором; чистый ✖ не считается');

const r0 = run([path.join(here, 'test-fixture')]);
check(r0.status === 0, `без --strict выход должен быть 0, дал ${r0.status}`);

if (fails.length) {
  console.log('selftest: ПРОВАЛ');
  fails.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log(`selftest: ок, находок в fixture: ${hits.length}`);
process.exit(0);

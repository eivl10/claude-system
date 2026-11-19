// Antigravity: напоминания и самопроверка. Один скрипт, три режима: pre-invocation | post-tool | stop.
// Перенос из Claude Code (19.11.2026): caveman-reminder.ps1 (стиль ответов), nav-guard.js (мягко, напоминанием), edit-counter.js (no-regressions), stop-verify.js (самопроверка).
// Протокол Antigravity: JSON в stdin, ответ JSON в stdout. PreInvocation срабатывает перед КАЖДЫМ вызовом модели, а systemMessage остаётся в разговоре,
// поэтому стиль и навигация подаются один раз на сообщение владельца (хеш lastUserInput), а не на каждый шаг.
// Состояние: tmpdir/agy-hooks-<conversationId>.json. Тихий провал: любая ошибка = пустой вывод.
// Проверка руками: echo {"conversationId":"t1","lastUserInput":"привет"} | node agy-hooks.js pre-invocation
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = process.env.AGY_HOOKS_TMP_DIR || os.tmpdir();
// Имена тулов: в списке init они view_file / write_to_file / replace_file_content, а в потоке событий выполненных шагов write_file / read_file / edit_file. Берём оба набора.
const EDIT_TOOLS = /^(write_to_file|write_file|replace_file_content|multi_replace_file_content|edit_file|sed_file|notebook_edit)$/;
const SKIP_PATH = /[\\/](tmp-agy|scratchpad|Temp|brain|scratch|artifacts)[\\/]/i;
const WRITE_CMD = /\b(Set-Content|Add-Content|Copy-Item|Move-Item|Remove-Item|scp|rsync|sftp|git\s+(push|apply)|sed\s+-i)\b|(^|[;&|]\s*)(cp|mv)\s|curl[^\n]*\s-T\s/;
const HASH = /\b(Get-FileHash|sha256sum|md5sum|certutil\s+-hashfile)\b/i;
const TRIVIAL = /^\s*(echo|Write-(Host|Output)|ls|dir|cd|pwd|Get-Location|true|:)\b[^;&|]*$/i;
const READONLY_SEG = /^\s*(cd|chdir|Set-Location|grep|egrep|fgrep|rg|cat|head|tail|wc|ls|dir|type|find|stat|pwd|es(\.exe)?|Get-Content|gc|Select-String|Get-ChildItem|Test-Path|sed\s+-n|awk)\b/i;
const readOnly = (c) => c.split(/&&|\|\||;|\||\n/).filter((s) => s.trim()).every((s) => READONLY_SEG.test(s));

const STYLE = 'Стиль ответа владельцу (он не программист): первая строка — итог или прямой ответ простыми словами, без кода, имён файлов и английских терминов. ' +
  'Просьба к владельцу только если она есть: блок «Жду от тебя:», нумерованный список, каждый пункт — действие и «чтобы <цель>». Если ничего не нужно, об этом не писать. ' +
  'Имена файлов, команды, номера строк — в конце, блоком «Детали». Незнакомый термин расшифровать один раз. Без скобок. Итог после работы один, 1–3 строки. Отчёт одним сообщением в конце, не по шагам. ' +
  'Файлы и пути в ответе — кликабельными ссылками [имя](file:///C:/путь), не в обратных кавычках. ' +
  'Код ищи через jcodemunch, доки через jdocmunch (вызов через call_mcp_tool), не view_file и grep_search по проиндексированному проекту. ' +
  'Необратимое (удаление, перезапись без копии, боевая БД, push --force, отправка наружу) — сначала предупреди и жди «да».';
const NOREG = 'no-regressions: это уже третья правка файлов за разговор. Прочитай скилл no-regressions: если файл есть в FIXES.md — сверь, не вернул ли ты старый баг; подтверждённый фикс запиши в FIXES.md.';
const VERIFY = (why) => `Самопроверка (раз на ход). ${why} Если запрос владельца был вопросом, просто скажи и остановись. Иначе по скиллу self-check запусти проверку командой, исправь только расхождение с запросом и дай строку «Проверено: <команда> → <итог>» или «Не проверено: <что, почему>». Зелёная проверка: стоп.`;

const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const stateFile = (inp) => path.join(TMP, `agy-hooks-${String(inp.conversationId || 'nosession').replace(/[^\w-]/g, '')}.json`);
const load = (inp) => ({ seq: 0, change: -1, evidence: -1, kind: '', blocked: false, edits: 0, noregSent: false, lastHash: '', ...(rd(stateFile(inp)) || {}) });
const save = (inp, st) => { try { fs.writeFileSync(stateFile(inp), JSON.stringify(st)); } catch {} };
const sys = (text) => ({ systemMessage: { systemMessage: text } });

// Запуск из сторожа agy-run (Claude Code раздаёт работу Flash): сторож дописывает к брифу этот хвост. Таким запускам карточка проекта,
// напоминание стиля и возврат на самопроверку не нужны: узкий бриф, отчёт в файл, вопросов задать некому. Запуск с --no-footer так не узнать.
const AGY_RUN_MARK = 'ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА ЭТОГО ЗАПУСКА';

function preInvocation(inp) {
  const steps = [];
  const st = load(inp);
  const text = String(inp.lastUserInput || '').trim();
  if (text.includes(AGY_RUN_MARK)) st.agyRun = true;
  if (st.agyRun) { save(inp, st); return null; }
  if (text) {
    const h = crypto.createHash('sha1').update(text).digest('hex');
    if (h !== st.lastHash) {
      st.lastHash = h;
      // новое сообщение владельца: сброс учёта самопроверки, стиль подаётся один раз
      Object.assign(st, { seq: 0, change: -1, evidence: -1, kind: '', blocked: false });
      steps.push(sys(STYLE));
    }
  }
  if (!st.cardSent) {
    // карточка проекта на первом вызове модели в разговоре (канал PreInvocation проверен вживую 19.11.2026)
    st.cardSent = true;
    try {
      const card = require('./handoff-start-agy.js').build(inp);
      if (card && card.ctx) steps.push(sys(card.ctx));
    } catch {}
  }
  if (st.edits >= 3 && !st.noregSent) { st.noregSent = true; steps.push(sys(NOREG)); }
  save(inp, st);
  return steps.length ? { injectSteps: steps } : null;
}

function classify(name, args) {
  const a = JSON.stringify(args || {});
  if (EDIT_TOOLS.test(name)) return SKIP_PATH.test(a) ? null : { change: 'edit', edit: true };
  if (name === 'run_command') {
    const c = String((args || {}).CommandLine || (args || {}).command || '');
    if (WRITE_CMD.test(c) && !SKIP_PATH.test(c)) return { change: 'cmd', evidence: HASH.test(c) };
    if (TRIVIAL.test(c) || readOnly(c)) return null;
    return { evidence: true };
  }
  if (name === 'call_mcp_tool' && /jev_(verify|compare|review|gate)/.test(a)) return { evidence: true };
  return null;
}

function postTool(inp) {
  const tc = inp.toolCall || {};
  const c = classify(String(tc.name || ''), tc.args);
  if (!c) return {};
  const st = load(inp);
  st.seq += 1;
  if (c.edit) st.edits += 1;
  if (c.change) { st.change = st.seq; st.kind = c.change; }
  if (c.evidence) st.evidence = st.seq;
  save(inp, st);
  return {};
}

function stop(inp) {
  if (inp.continuationActive) return null;
  if (inp.terminationReason && inp.terminationReason !== 'NO_TOOL_CALL') return null;
  const st = load(inp);
  if (st.agyRun || st.change < 0 || st.blocked || st.evidence >= st.change) return null;
  st.blocked = true; save(inp, st);
  return { decision: 'continue', reason: VERIFY(`После изменения (${st.kind === 'edit' ? 'правка файла' : 'команда записи'}) не было запуска проверки.`) };
}

if (require.main === module) {
  const mode = process.argv[2];
  let raw = '';
  process.stdin.on('data', (d) => (raw += d));
  process.stdin.on('end', () => {
    try {
      let inp = {};
      try { inp = JSON.parse(raw.replace(/^﻿/, '')); } catch { return; }
      const r = mode === 'pre-invocation' ? preInvocation(inp) : mode === 'post-tool' ? postTool(inp) : mode === 'stop' ? stop(inp) : null;
      if (r) process.stdout.write(JSON.stringify(r));
    } catch {}
  });
} else {
  module.exports = { preInvocation, postTool, stop, classify };
}

# Antigravity: правила, скиллы и хуки

Адаптированная копия той же системы для Antigravity (агент `agy`, модель Gemini Flash). Выложено 19.11.2026. Живые файлы лежат в `~/.gemini/config/`, здесь копии с вычищенными личными путями: `<HOME>` значит домашняя папка пользователя, `<VIBECODING>` рабочая папка проектов.

[English below](#english)

## Что здесь

| Путь | Что это |
|---|---|
| `AGENTS.md` | Глобальные правила: стиль ответа, навигация jcodemunch и jdocmunch, проверка, карточка проекта, предупреждение о необратимом. Размер до 24 КБ, так требует Antigravity |
| `hooks.json` | Подключение хуков: старт сессии, напоминание на сообщение, учёт правок, остановка без проверки |
| `hooks/handoff-start-agy.js` | Собирает карточку проекта `HANDOFF.md` через `handoff-start-core.js`; на старте сессии показывает владельцу одну строку о ней |
| `hooks/handoff-start-core.js` | Ядро выбора и сборки карточки, точная копия хука Claude Code |
| `hooks/agy-hooks.js` | Вставляет карточку проекта моделью на первом вызове, стиль и навигацию раз на сообщение, счётчик правок для no-regressions, самопроверка на остановке |
| `skills/` | Скиллы: handoff, readme, no-regressions, self-check, logging, brief, short-brief, ui-rules, landing-page-builder, orc, super-orc, model-advisor, jev-judgment, grill-me, hydrogen-orc и прежние caveman-plus, gsd-workflow. Скилл agy-bridge не выложен: он создаёт задачу планировщика Windows |
| `skills/ui-rules/` | Правила интерфейса для веба, ботов и программ вместе с проверяющим сканером `scanner/ui-check.mjs` |
| `skills/landing-page-builder/references/` | База паттернов лендингов и каталог ИИ-штампов |

## Как поставить

1. Сделай копию своей папки `~/.gemini/config/` целиком.
2. Скопируй `AGENTS.md`, `hooks.json`, `hooks/` и нужные папки из `skills/` в `~/.gemini/config/`.
3. Замени метки `<HOME>` и `<VIBECODING>` своими путями. Хуки требуют установленный Node.js в PATH.
4. Проверь хук подачи карточки: `echo {"workspacePaths":["<папка проекта>"]} | node hooks/handoff-start-agy.js`. Если в папке есть `HANDOFF.md`, получишь JSON с `injectSteps`.
5. Проверь сканер: `node skills/ui-rules/scanner/selftest.mjs` печатает «selftest: ок».
6. Перезапусти Antigravity.

Проверка 19.11.2026 в режиме `agy -p`: PreInvocation и PostToolUse срабатывают, модель видит вставленный текст, карточка проекта дошла дословно. Вставка из SessionStart до модели в этом режиме не дошла, поэтому карточку подаёт PreInvocation. Интерактивное окно Antigravity автор не проверял.

## Чем отличается от Claude Code

- Хуки живут в одном `hooks.json`, события другие: SessionStart, PreInvocation, PreToolUse, PostToolUse, PostInvocation, Stop. Ввод это JSON в stdin, ответ JSON в stdout.
- PreInvocation срабатывает перед каждым вызовом модели, а вставленное остаётся в разговоре, поэтому напоминания подаются один раз на сообщение владельца.
- Контекст больше миллиона токенов: поэтому не переносились сигналы о размере контекста и подогрев кэша.
- Скиллы подключаются сами по описанию, вызова `Skill` нет. MCP вызывается через `call_mcp_tool`.

## Что не перенесено и почему

| Что | Причина |
|---|---|
| `ctx-signal`, `ctx-lib`, скилл `cache-warm`, `idle-handoff` | Решали остывание кэша и рост контекста Claude. У Antigravity есть тул `schedule`, аналог таймера, но самой задачи нет: окно больше миллиона токенов. Решение владельца 19.11.2026 |
| `limit-guard`, `usage-lib`, `log-session-usage`, `statusline` | Считают лимит подписки Claude |
| `deleg-gate`, `jev-gate`, `subagent-start` | Привязаны к тулу Agent и квоте Claude. Правила про jev и проверку перенесены в `AGENTS.md` |
| `nav-guard` | Жёсткий запрет чтения кода требует PreToolUse. Там нужен ответ `decision`, а `allow` разрешает вообще любой вызов, обходя запросы разрешений. Вместо запрета: правило в `AGENTS.md` и напоминание на сообщение |
| `browser-guard`, `block-get-file-content`, `auto-bom-fix`, `index-nudge` | Привязаны к именам тулов Claude. Имена и аргументы тулов Antigravity не проверялись на живой сессии |
| скиллы `agy`, `git-ship`, `jcodemunch`, `jdocmunch` | `agy` это вызов Antigravity из Claude, `git-ship` привязан к аккаунту автора, схемы тулов jcodemunch и jdocmunch Antigravity читает сам |
| субагенты `worker`, `Explore`, `brief-interviewer`, `opencode` | У Antigravity свои субагенты: `invoke_subagent`, `define_subagent` |

## English

Adapted copy of the same system for Antigravity (`agy`, Gemini Flash): global rules `AGENTS.md`, `hooks.json` with scripts, and skills. Live files are in `~/.gemini/config/`; personal paths are replaced by `<HOME>` and `<VIBECODING>`. Install: back up `~/.gemini/config/`, copy the files, replace the placeholders, make sure Node.js is on PATH, restart Antigravity. Not ported: context-size signals, cache warming, Claude quota hooks, hard navigation block (PreToolUse needs a `decision`, and `allow` bypasses permission prompts) and Claude-specific agents. Hooks are tested by feeding sample JSON to stdin, not in a live Antigravity session.

# claude-system

Личная система настройки Claude Code: правила, хуки, скиллы, субагенты и обёртки MCP-серверов, которые у меня работают.
Здесь лежат копии живых файлов из `~/.claude`: они выгружены по белому списку, личные данные вычищены.

[English below](#english)

## Как это устроено

![Простая схема системы](docs/schema-simple.svg)

Подробная схема со всеми скиллами, хуками и MCP: [docs/schema.svg](docs/schema.svg). На ней сплошная рамка значит «проверено», пунктир — «на пробе».

Слова со схемы:
- **Владелец** — ставит задачу и принимает итог.
- **Агент** — оркестратор, главная сессия Claude: планирует, раздаёт и принимает работу.
- **Субагенты** — исполнители-помощники, обычно более дешёвые модели: agy Flash, Claude Sonnet, Claude Haiku.
- **Jev** — сверяет результат с файлами на диске.
- **Правила** — `CLAUDE.md` и папка `rules/`: что можно, что нельзя, как отвечать.
- **Скиллы** — инструкции под конкретное дело.
- **Хуки** — автоматические сторожа на действия агента: напоминают или запрещают.
- **MCP** — подключаемые инструменты и сервисы.

Как идёт работа:
1. Владелец ставит задачу. Если нужно, сначала превращает её в чёткое задание скиллом `/brief`, он задаёт вопросы, или `/short-brief`, он обходится без вопросов.
2. Агент пишет задания и раздаёт их. Режимы `/orc` и `/super-orc` запрещают ему делать рутину самому.
3. agy Flash через сторож `agy-run` читает, правит по готовой спецификации и гоняет проверки. Субагент `worker` на Sonnet пишет новую логику и дизайн. `Explore` на Haiku ищет по проекту.
4. Результат сверяется с файлами на диске, отчёту исполнителя на слово не верят.
5. Правила и хуки действуют на каждом шаге: останавливают чтение кода в обход индекса, лишнюю работу руками, перерасход контекста и лимитов.

## Что в репозитории

| Путь | Что это |
|---|---|
| `system/CLAUDE.md` | Главные инструкции: навигация по коду, делегирование, проверка, стиль ответов |
| `system/rules/` | Отдельные правила: понятный язык, команды PowerShell, пути в Git Bash, предупреждение о необратимом, ИИ-штампы |
| `system/hooks/` | Хуки, подключённые в настройках, и их библиотеки |
| `system/skills/` | Системные скиллы: agy, brief, short-brief, orc, super-orc, handoff, readme, git-ship, self-check, no-regressions, model-advisor, grill-me, cache-warm, jcodemunch, jdocmunch |
| `system/agents/` | Субагенты: worker на Sonnet, Explore на Haiku, помощник брифа, opencode |
| `system/commands/` | Команды, среди них `oc` для передачи задач в OpenCode |
| `system/mcp-wrappers/` | Обёртки запуска MCP-серверов jev и jdocmunch, мост к OpenCode |
| `system/output-styles/`, `system/statusline.js` | Стиль вывода и строка состояния |
| `system/design-library/ai-stamps.md` | Каталог ИИ-штампов, на него ссылаются правила |
| `system/settings.example.json` | Шаблон `settings.json`: пути заменены метками, секреты — `<REDACTED>` |
| `manifest.txt` | Белый список: что выгружается |
| `export.ps1` | Выгрузка по белому списку с заменой личного |
| `publish.ps1` | Обновление репозитория одной командой |
| `docs/` | Схемы, статусы, список непроверенного |

Метки в файлах: `<HOME>` — домашняя папка пользователя, `<VIBECODING>` — рабочая папка проектов, `<EMAIL>`, `<TELEGRAM_ID>`, `<REDACTED>` — вычищенные значения. Дополнительные замены лежат в локальном `redact.txt`, в репозиторий он не попадает.

## Чего здесь нет намеренно

- Память, журналы сессий, доступы, ключи, расписания, `settings.local.json`, резервные копии.
- Рабочие скиллы kosmoseo, landing-page-builder, carousel, brevo-email: они для конкретной работы, не часть системы. На подробной схеме они показаны отдельной группой.
- AGY Switch и сторож `agy-run`: они в отдельном закрытом репозитории `eivl10/agy-switch`.

## Что нужно для работы

- Claude Code, десктоп или CLI. Windows, PowerShell 5.1, Git Bash, Node.js.
- MCP-серверы: jcodemunch для навигации по коду, jdocmunch для навигации по документации, jev для дешёвых проверок. Ключ jev читается из переменной окружения пользователя.
- agy, это Antigravity CLI с моделью Gemini Flash

## Как поставить

1. Сделать резервную копию своей папки `~/.claude/` и скопировать в неё содержимое `system/`.
2. Переименовать `settings.example.json` в `settings.json`, заменить метки `<HOME>`, `<VIBECODING>` своими путями, вернуть свои значения вместо `<REDACTED>`.
3. Подключить MCP-серверы и agy, перезапустить Claude Code.

## Как обновить репозиторий

```powershell
& ".\publish.ps1"
```
Скрипт выгружает файлы, ищет личные данные и отправляет коммит, только если что-то изменилось. В чате то же самое запускается фразой «выложи систему».

## Что проверено

Пометка берётся из реестра решений владельца: «подтверждённое» значит проверено, остальное — на пробе. «На пробе» значит: работает, но польза ещё не доказана.

Проверено:
- `/brief` и `/short-brief` — скиллы брифа, подтвердил владелец 03.11.2026.
- Хук `block-get-file-content.ps1` запрещает читать файлы целиком: по аудиту 114 блокировок за 30 дней.
- Сторож `agy-run` останавливает зависшего исполнителя: живой прогон 3 из 3. Лежит в `eivl10/agy-switch`.
- Правило ИИ-штампов, режимы `/orc` и `/super-orc`, исполнитель `worker`, навыки и обёртки MCP jev и jdocmunch — подтвердил владелец 03.11.2026, пользуется постоянно.

Всё остальное на пробе. Статус каждого элемента: [docs/statuses.md](docs/statuses.md). Что не проверено и как это проверить: [docs/не-проверено.md](docs/не-проверено.md).

---

## English

Personal Claude Code setup: rules, hooks, skills, sub-agents and MCP wrappers that are actually in use. These are copies of the live files from `~/.claude`, exported by a whitelist with personal data scrubbed.

**Diagram terms:** owner sets the task and accepts the result; agent is the orchestrator, the main Claude session that plans, delegates and accepts work; sub-agents are executors, usually cheaper models: agy Flash, Claude Sonnet, Claude Haiku; Jev checks results against files on disk; rules are standing instructions; skills are task-specific instructions; hooks are automatic guards on the agent's actions; MCP are pluggable tools and services. On the detailed diagram a solid frame means verified, dashed means on trial.

**Contents:** `system/` holds the exported files, `manifest.txt` is the whitelist, `export.ps1` exports and scrubs, `publish.ps1` updates the repo in one run. Placeholders: `<HOME>`, `<VIBECODING>`, `<EMAIL>`, `<TELEGRAM_ID>`, `<REDACTED>`.

**Not included on purpose:** memory, session logs, credentials, schedules, `settings.local.json`, backups, work-specific skills. AGY Switch and `agy-run` live in a separate private repo `eivl10/agy-switch`.

**Requirements:** Claude Code, Windows, PowerShell 5.1, Git Bash, Node.js; MCP servers jcodemunch, jdocmunch, jev; agy with `agy-run`; OpenCode if you need `oc`.

**Install:** back up your `~/.claude`, copy `system/` into it, rename `settings.example.json` to `settings.json`, replace placeholders, connect MCP servers and agy, restart Claude Code.

**Verified:** `/brief`, `/short-brief`, hook `block-get-file-content.ps1`, the `agy-run` watchdog. Everything else is on trial: see [docs/statuses.md](docs/statuses.md).

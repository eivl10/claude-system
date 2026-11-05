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
| `system/skills/` | Системные скиллы: agy, brief, short-brief, orc, super-orc, handoff, idle-handoff, readme, git-ship, self-check, no-regressions, model-advisor, grill-me, cache-warm, jcodemunch, jdocmunch |
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

A personal Claude Code setup: rules, hooks, skills, sub-agents and MCP server wrappers that the owner actually uses.
This repository holds copies of the live files from `~/.claude`. They are exported by a whitelist and personal data is scrubbed.

### How it works

![Simple system diagram](docs/schema-simple.svg)

The detailed diagram with every skill, hook and MCP server: [docs/schema.svg](docs/schema.svg). A solid frame means verified, a dashed frame means on trial.

Terms from the diagram:
- **Owner** sets the task and accepts the result.
- **Agent** is the orchestrator, the main Claude session. It plans, hands out work and accepts it.
- **Sub-agents** are helper executors, usually cheaper models: agy Flash, Claude Sonnet, Claude Haiku.
- **Jev** checks the result against the files on disk.
- **Rules** are `CLAUDE.md` and the `rules/` folder: what is allowed, what is not, how to answer.
- **Skills** are instructions for a specific job.
- **Hooks** are automatic guards on the agent's actions. They remind or block.
- **MCP** are pluggable tools and services.

How the work goes:
1. The owner sets a task. If needed, it is first turned into a clear assignment with the skill `/brief`, which asks questions, or `/short-brief`, which needs none.
2. The agent writes assignments and hands them out. The modes `/orc` and `/super-orc` forbid it to do routine work itself.
3. agy Flash, run through the `agy-run` watchdog, reads, edits by a ready spec and runs checks. The `worker` sub-agent on Sonnet writes new logic and design. `Explore` on Haiku searches the project.
4. The result is checked against the files on disk. A report from an executor is not taken on trust.
5. Rules and hooks act at every step. They stop reading code around the index, needless manual work, and overspending of context and limits.

### What is in the repository

| Path | What it is |
|---|---|
| `system/CLAUDE.md` | Main instructions: code navigation, delegation, verification, answer style |
| `system/rules/` | Separate rules: plain language, PowerShell commands, Git Bash paths, warning before irreversible actions, AI-stamp catalog |
| `system/hooks/` | Hooks wired in the settings, and their libraries |
| `system/skills/` | System skills: agy, brief, short-brief, orc, super-orc, handoff, idle-handoff, readme, git-ship, self-check, no-regressions, model-advisor, grill-me, cache-warm, jcodemunch, jdocmunch |
| `system/agents/` | Sub-agents: worker on Sonnet, Explore on Haiku, the brief helper, opencode |
| `system/commands/` | Commands, among them `oc` for passing tasks to OpenCode |
| `system/mcp-wrappers/` | Launch wrappers for the jev and jdocmunch MCP servers, and the OpenCode bridge |
| `system/output-styles/`, `system/statusline.js` | Output style and status line |
| `system/design-library/ai-stamps.md` | Catalog of AI stamps, referenced by the rules |
| `system/settings.example.json` | Template of `settings.json`: paths replaced by placeholders, secrets are `<REDACTED>` |
| `manifest.txt` | The whitelist: what gets exported |
| `export.ps1` | Export by the whitelist with personal data replaced |
| `publish.ps1` | Updates the repository in one command |
| `docs/` | Diagrams, statuses, the list of what is unverified |

Placeholders in files: `<HOME>` is the user's home folder, `<VIBECODING>` is the projects folder, `<EMAIL>`, `<TELEGRAM_ID>` and `<REDACTED>` are scrubbed values. Extra replacements live in a local `redact.txt` that never reaches the repository.

### Not included on purpose

- Memory, session logs, credentials, keys, schedules, `settings.local.json`, backups.
- The work-specific skills kosmoseo, landing-page-builder, carousel and brevo-email. They serve particular jobs and are not part of the system. The detailed diagram shows them as a separate group.
- AGY Switch and the `agy-run` watchdog. They live in a separate private repository `eivl10/agy-switch`.

### Requirements

- Claude Code, desktop or CLI. Windows, PowerShell 5.1, Git Bash, Node.js.
- MCP servers: jcodemunch for code navigation, jdocmunch for documentation navigation, jev for cheap checks. The jev key is read from a user environment variable.
- agy, the Antigravity CLI with the Gemini Flash model, and the `agy-run` watchdog from `eivl10/agy-switch`.
- OpenCode for the `oc` command, if you need it.

### How to install

1. Back up your `~/.claude/` folder and copy the contents of `system/` into it.
2. Rename `settings.example.json` to `settings.json`, replace the `<HOME>` and `<VIBECODING>` placeholders with your paths, and put your own values back instead of `<REDACTED>`.
3. Connect the MCP servers and agy, then restart Claude Code.

### How to update the repository

```powershell
& ".\publish.ps1"
```
The script exports the files, searches for personal data, and pushes a commit only if something changed. In chat the same thing runs with the phrase "выложи систему".

### What is verified

The mark comes from the owner's decision register: "confirmed" means verified, everything else is on trial. On trial means it works, but its benefit is not yet proven.

Verified:
- `/brief` and `/short-brief`, the brief skills, confirmed by the owner on 03.11.2026.
- The hook `block-get-file-content.ps1` forbids reading whole files: 114 blocks in 30 days by the audit.
- The `agy-run` watchdog stops a stuck executor: live run 3 of 3. It lives in `eivl10/agy-switch`.
- The AI-stamp rule, the `/orc` and `/super-orc` modes, the `worker` executor, the skills, and the jev and jdocmunch MCP wrappers: confirmed by the owner on 03.11.2026 and in constant use.

Everything else is on trial. Status of every element: [docs/statuses.md](docs/statuses.md). What is unverified and how to check it: [docs/не-проверено.md](docs/не-проверено.md).

# OpenCode ↔ Claude Code bridge

MCP-сервер, который даёт Claude Code инструмент `mcp__opencode__delegate`: запускает OpenCode в папке проекта и возвращает ответ, id сессии, стоимость и список инструментов.

```
Claude Code (desktop/CLI)
        │  MCP stdio
        ▼
opencode-bridge.mjs
        │  opencode run --format json (prompt через stdin)
        ▼
OpenCode background service  ──►  сессия видна в OpenCode desktop
```

## Что уже установлено

| Файл | Зачем |
|---|---|
| `<HOME>\.claude\mcp-wrappers\opencode-bridge.mjs` | сам MCP-сервер, без зависимостей |
| `<HOME>\.claude\commands\oc.md` | слэш-команда `/oc <задача>` |
| `<HOME>\.claude\agents\opencode.md` | субагент `opencode` для Task/Agent |
| `<HOME>\.claude.json` | регистрация MCP-сервера `opencode` (scope: user) |

## Использование

В Claude Code:

```text
/oc реализуй X в проекте, прогони тесты, покажи diff
```

или обычным текстом:

```text
Делегируй в opencode: отрефактори модуль Y и прогони pytest.
```

Claude также может запускать субагента `opencode` через Task — он делает один вызов моста и возвращает ответ дословно.

Продолжить прошлую сессию OpenCode в этой папке:

```text
/oc продолжи последнюю сессию: добавь обработку ошибок
```

(внутри это `session: "last"`; конкретный id — `session: "ses_..."`).

## Что возвращает инструмент

```text
opencode: готово
session: ses_...
cwd: F:\...\project
model: opencode/deepseek-v4.1-flash-free
time: 12.4s · cost: $0.0000 · tokens: 10196 in / 75 out
tools: read, write
---
<финальный ответ OpenCode>
```

При ошибке/таймауте: `opencode: ошибка`, причина, хвост stderr и сохранённый `session`, который можно продолжить.

## Модель и настройки

По умолчанию — `opencode/deepseek-v4.1-flash-free`. Переопределить:

- аргументом инструмента: `model: "opencode/glm-5.3-flash-free"`;
- переменной окружения `OPENCODE_DELEGATE_MODEL`;
- файлом `<HOME>\AppData\Local\opencode\claude-bridge\config.json`:

```json
{
  "model": "opencode/deepseek-v4.1-flash-free",
  "timeoutSec": 900,
  "auto": true,
  "cli": "<HOME>\\AppData\\Local\\Programs\\ai.opencode.desktop\\resources\\opencode-cli.exe"
}
```

`model: "default"` — модель OpenCode по умолчанию (как в desktop).

Другие переменные: `OPENCODE_DELEGATE_TIMEOUT`, `OPENCODE_DELEGATE_AUTO`, `OPENCODE_CLI`.

## Поведение и ограничения

- **cwd** — по умолчанию `CLAUDE_PROJECT_DIR` (корень проекта Claude); можно передать явно.
- **Сессии** — по умолчанию новая. `session: "last"` — последняя сессия в этой папке (хранится в `sessions.json`). `session: "ses_..."` — конкретная. `fork: true` — форкнуть перед продолжением.
- **Права** — по умолчанию `auto: true` (как `opencode run --auto`). Явные `deny` в конфиге OpenCode продолжают действовать. Это полноценный агент с доступом к файлам и командам — не делегируйте ему недоверенные инструкции.
- **Вывод** — до 24 000 символов; полный текст остаётся в сессии OpenCode. MCP-лимит Claude Code — 25k токенов.
- **Таймаут** — 900 с по умолчанию, максимум 3600. При таймауте процесс OpenCode останавливается, сессия сохраняется.
- **Долгие вызовы** — Claude Code сам уводит вызов в фон после ~2 минут; мост шлёт progress-уведомления, чтобы задача не считалась зависшей.
- **Промпт** — передаётся через stdin, поэтому длина не ограничена командной строкой Windows (~32k). Но OpenCode не видит диалог Claude: prompt должен быть самодостаточным.

## Проверка и отладка

```powershell
claude mcp list                 # opencode: ✔ Connected
claude mcp get opencode
opencode service status         # общий сервис OpenCode
Get-Content "$env:LOCALAPPDATA\opencode\claude-bridge\bridge.log" -Tail 30
```

В Claude Code: `/mcp` — статус сервера, `/oc ...` — боевой вызов.

Если после установки сервер не виден в desktop-приложении — начните новую сессию (MCP-серверы подключаются при старте сессии) или переподключите через `/mcp`.

## Удаление

```powershell
claude mcp remove opencode -s user
Remove-Item "<HOME>\.claude\mcp-wrappers\opencode-bridge.mjs"
Remove-Item "<HOME>\.claude\commands\oc.md"
Remove-Item "<HOME>\.claude\agents\opencode.md"
```

Состояние моста (id последних сессий, лог) — `<HOME>\AppData\Local\opencode\claude-bridge\`.

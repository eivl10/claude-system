---
description: Делегировать задачу в OpenCode (DeepSeek) и вернуть результат
argument-hint: <задача для OpenCode>
allowed-tools: ToolSearch, mcp__opencode__delegate
---
Делегируй задачу в OpenCode одним вызовом `mcp__opencode__delegate`.

Задача:
$ARGUMENTS

Правила:
- Сформулируй самодостаточный prompt: что сделать, где (пути), критерии готовности. OpenCode не видит наш диалог.
- `cwd` — текущая рабочая папка проекта.
- `session`: `"new"`, если не просили продолжить; `"last"` — продолжить последнюю сессию OpenCode в этой папке; `"ses_..."` — конкретная сессия.
- Не пересказывай и не сокращай ответ OpenCode. Верни его целиком, включая session id и стоимость.

# Bash-инструмент: пути Windows только с прямыми слешами

Bash-тул здесь — Git Bash. Обратный слеш в нём съедается: `<VIBECODING>\Claude\x.js` превращается в `F:VibecodingClaudex.js` (так падал запуск agy-run 27.10.2026: «Cannot find module …VibecodingClaudeAGY-subagy-run.js»).

- В Bash-вызове любой путь пишу с прямыми слешами: `<VIBECODING>/Claude/AGY-sub/agy-run.js`, и в кавычках, если есть пробелы или кириллица.
- Обратные слеши допустимы только в PowerShell-тулe или в одинарных кавычках целиком.
- Перед отправкой Bash-команды с путём Windows: ищу `\` внутри пути, заменяю на `/`.
- Это касается и команд, которые я пишу в скиллах и брифах для запуска через Bash (в том числе `node ...agy-run.js`).

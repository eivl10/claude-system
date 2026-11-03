# Команды для владельца: только Windows PowerShell 5.1

Команды, которые владелец вставляет в терминал (git, npm и т.д.), давать в блоке `powershell`, без `$`/`PS>`, готовыми к вставке.
- Без `&&`/`||`: `A; if ($?) { B }`. Без `export`, `VAR=x cmd` (`$env:X = "v"`), `~` (`$HOME`).
- Без `grep/cat/rm -rf/touch/mkdir -p`: `Select-String`, `Get-Content`, `Remove-Item -Recurse -Force`, `New-Item`.
- Многострочный текст (коммит): here-string `@'`...`'@` (закрытие в колонке 0), не heredoc.
- Не `2>&1` на exe.
- Нужен bash (ssh, WSL): подписать где запускать, блок `bash`.

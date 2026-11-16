[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Напоминание стиля на КАЖДОЕ сообщение владельца. Полное правило уже загружено в сессию из rules/ponyatno.md, здесь короткий якорь.
# На служебных событиях (уведомление фоновой задачи, тик таймера и т.п.) молчит: признаки те же, что в ctx-lib.js, функция isServiceMessage. Править в обоих местах.
# Имя файла оставлено ради settings.json.

# Вход хука читаем сырыми байтами и декодируем как UTF-8: иначе Windows PowerShell 5.1 портит кириллицу. Любой сбой чтения = не служебное, напоминание идёт как раньше.
$service = $false
try {
    $stdin = [Console]::OpenStandardInput()
    $ms = New-Object System.IO.MemoryStream
    $stdin.CopyTo($ms)
    $text = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()).TrimStart([char]0xFEFF)
    $p = ([string](ConvertFrom-Json $text).prompt).Trim()
    foreach ($s in @('<task-notification>', '[SYSTEM NOTIFICATION - NOT USER INPUT]')) {
        if ($p.Contains($s)) { $service = $true }
    }
    foreach ($s in @('/idle-handoff тик', '<side-sessions-event>', '<ci-monitor-event>', '<<autonomous-loop')) {
        if ($p.StartsWith($s, [System.StringComparison]::Ordinal)) { $service = $true }
    }
} catch { $service = $false }
if ($service) { exit 0 }

@{
    hookSpecificOutput = @{
        hookEventName     = 'UserPromptSubmit'
        additionalContext = 'Стиль владельцу (rules/ponyatno.md): первая строка — итог или прямой ответ простыми словами, без имён файлов и терминов. Просьба только блоком «Жду от тебя:», в каждом пункте цель «чтобы …». Имена и команды в конце, в «Детали». Итог один, 1–3 строки, сделанное не пересказывать. Отчёты пачками, не по шагам. Ссылки: [имя](относительный/путь), html ещё и блоком powershell с Start-Process.'
    }
} | ConvertTo-Json -Compress -Depth 5

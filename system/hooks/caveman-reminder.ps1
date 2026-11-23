[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Напоминание стиля на КАЖДОЕ сообщение владельца. Правило правится в rules/ponyatno.md; здесь сжатая копия, ни одно правило из версии до 15.11.2026 не выпущено (опыт 05.09.2026: правило, поданное один раз, выцветает через 10-15 реплик).
# На служебных событиях (уведомление фоновой задачи, тик таймера и т.п.) молчит: признаки те же, что в ctx-lib.js, функция isServiceMessage. Править в обоих местах.
# ИСКЛЮЧЕНИЕ (16.11.2026): метки ответа субагента (<agent-message from= вместе с [Subagent hand-back], начало «Another Claude session sent a message:») здесь НЕ перечислены умышленно:
#   на ходе после ответа субагента оркестратор пишет отчёт владельцу, и стиль на нём нужен. js-хуки (ctx-lib.js) на таком сообщении молчат, стиль идёт.
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
    foreach ($s in @('/idle-handoff тик', '/cache-warm тик', '<side-sessions-event>', '<ci-monitor-event>', '<<autonomous-loop')) {
        if ($p.StartsWith($s, [System.StringComparison]::Ordinal)) { $service = $true }
    }
} catch { $service = $false }
if ($service) { exit 0 }

@{
    hookSpecificOutput = @{
        hookEventName     = 'UserPromptSubmit'
        additionalContext = 'Стиль владельцу, rules/ponyatno.md: первая строка — итог или прямой ответ простыми словами, без кода, имён файлов, английских терминов. Просьба к владельцу только если она есть: блок «Жду от тебя:», нумерованный список, пункт = действие и «чтобы <цель>»; варианты маркерами, рекомендованный первым с пометкой «мой выбор»; «Как» только если действие не очевидно. Если ничего не нужно, об этом не писать ни слова. Имена, команды, номера строк — в конце, блоком «Детали». Термин расшифровать один раз. «Соло», «jev проверил» — простыми словами; если была проверка: «jev проверил: <что сверено с чем> — <итог>», если не было: «Не проверено: <что, почему>», пустое «ок» не допускается. Итог после работы один, 1–3 строки, он же первая строка, второго итога в конце нет; объяснённое до работы не повторять: «раньше/теперь», цена, зачем. Отчёты пачками, не по шагам. Ссылки: путь никогда в обратных кавычках и не голым, только [имя](относительный/путь); html для проверки ещё блоком powershell с Start-Process "полный путь".'
    }
} | ConvertTo-Json -Compress -Depth 5

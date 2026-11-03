<#
.SYNOPSIS
  Скрипт публикации/обновления claude-system.
  1. Запускает export.ps1.
  2. Проверяет утечки в system/.
  3. Если есть изменения, коммитит и пушит в репозиторий.
#>

$ErrorActionPreference = 'Stop'

# 1. Запуск export.ps1
& "$PSScriptRoot\export.ps1"
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("ОШИБКА: export.ps1 завершился с кодом $LASTEXITCODE")
    exit 1
}

# 2. Поиск по system/
$systemDir = Join-Path $PSScriptRoot 'system'
$redactPath = Join-Path $PSScriptRoot 'redact.txt'
$utf8 = New-Object System.Text.UTF8Encoding($false)

# (а) левые части строк redact.txt
$literals = New-Object System.Collections.ArrayList
if (Test-Path -LiteralPath $redactPath -PathType Leaf) {
    foreach ($raw in [System.IO.File]::ReadAllLines($redactPath, $utf8)) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $idx = $line.IndexOf(' => ')
        if ($idx -gt 0) {
            $f = $line.Substring(0, $idx).Trim()
            if ($f -ne '') { [void]$literals.Add($f) }
        }
    }
}

# (б) общие regex
$regexes = @(
    @{ Name = 'IP'; Rx = New-Object System.Text.RegularExpressions.Regex('\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b') },
    @{ Name = 'sk-token'; Rx = New-Object System.Text.RegularExpressions.Regex('sk-[A-Za-z0-9]{16,}') },
    @{ Name = 'ghp-token'; Rx = New-Object System.Text.RegularExpressions.Regex('ghp_[A-Za-z0-9]{20,}') },
    @{ Name = 'private-key'; Rx = New-Object System.Text.RegularExpressions.Regex('-----BEGIN [A-Z ]*PRIVATE KEY') }
)

$leakFound = $false
$files = Get-ChildItem -LiteralPath $systemDir -Recurse -File

foreach ($f in $files) {
    $rel = $f.FullName.Substring($systemDir.Length).TrimStart('\', '/')
    $isScanner = ($rel -replace '\\', '/') -match 'skills/git-ship/scripts/prepush-scan\.sh$'

    $lines = [System.IO.File]::ReadAllLines($f.FullName, $utf8)
    for ($i = 0; $i -lt $lines.Length; $i++) {
        $lineNum = $i + 1
        $lineText = $lines[$i]

        # Проверка (а): литералы из redact.txt
        foreach ($lit in $literals) {
            if ($lineText.IndexOf($lit, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                [Console]::Error.WriteLine("УТЕЧКА (redact.txt): файл $rel, строка $lineNum содержит запрещённый литерал")
                $leakFound = $true
            }
        }

        # Проверка (б): общие regex (файлы-сканеры исключены)
        if (-not $isScanner) {
            foreach ($r in $regexes) {
                if ($r.Rx.IsMatch($lineText)) {
                    [Console]::Error.WriteLine("УТЕЧКА ($($r.Name)): файл $rel, строка $lineNum совпала с regex")
                    $leakFound = $true
                }
            }
        }
    }
}

if ($leakFound) {
    [Console]::Error.WriteLine("ОШИБКА: Обнаружены потенциальные утечки в system/. Публикация отменена.")
    exit 2
}

# 3. Индексация и проверка изменений
git -C $PSScriptRoot add -A
git -C $PSScriptRoot diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host 'Изменений нет'
    exit 0
}

# 4. Коммит и push
$dateStr = (Get-Date).ToString('yyyy-MM-dd')
$commitMsg = "Обновление системы $dateStr / System update $dateStr"

git -C $PSScriptRoot commit -m $commitMsg
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("ОШИБКА: git commit завершился с кодом $LASTEXITCODE")
    exit $LASTEXITCODE
}

git -C $PSScriptRoot push
if ($LASTEXITCODE -ne 0) {
    [Console]::Error.WriteLine("ОШИБКА: git push завершился с кодом $LASTEXITCODE")
    exit $LASTEXITCODE
}

exit 0

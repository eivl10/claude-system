<#
.SYNOPSIS
  Выгрузка системы Claude по белому списку (manifest.txt) в папку system/ с заменой личных путей на метки.
.PARAMETER Manifest
  Файл списка. По умолчанию manifest.txt рядом со скриптом.
.PARAMETER Out
  Папка вывода. По умолчанию system рядом со скриптом. Её СОДЕРЖИМОЕ удаляется перед выгрузкой.
.PARAMETER DryRun
  Ничего не писать, только показать список файлов назначения и замены.
.NOTES
  Windows PowerShell 5.1. Файл сохранён в UTF-8 с BOM.
#>
param(
    [string]$Manifest = (Join-Path $PSScriptRoot 'manifest.txt'),
    [string]$Out = (Join-Path $PSScriptRoot 'system'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Fail([string]$msg) {
    [Console]::Error.WriteLine('ОШИБКА: ' + $msg)
    exit 1
}

function Resolve-Full([string]$p) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($p).TrimEnd('\')
}

$ManifestFull = Resolve-Full $Manifest
$OutFull = Resolve-Full $Out
$ScriptDir = (Resolve-Full $PSScriptRoot)
$RedactPath = Join-Path $ScriptDir 'redact.txt'

$TextExt = @('.md', '.txt', '.js', '.mjs', '.cjs', '.ts', '.json', '.ps1', '.psm1', '.sh', '.cmd', '.bat', '.py', '.yml', '.yaml', '.toml', '.ini')

$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$utf8Plain = New-Object System.Text.UTF8Encoding($false)
$ci = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---------- проверка папки вывода ----------
$outBound = $PSBoundParameters.ContainsKey('Out')
if (-not $outBound -and -not $OutFull.EndsWith('\system', [StringComparison]::OrdinalIgnoreCase)) {
    Fail "путь вывода '$OutFull' не кончается на \system и не передан явно через -Out"
}
if ($OutFull -match '^[A-Za-z]:$' -or $OutFull -eq '' -or $OutFull.StartsWith('\\')) {
    Fail "недопустимая папка вывода: '$OutFull'"
}
if (($ScriptDir + '\').StartsWith($OutFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
    Fail "папка вывода '$OutFull' содержит сам скрипт, отказ"
}
if (Test-Path -LiteralPath $OutFull -PathType Leaf) {
    Fail "'$OutFull' это файл, нужна папка"
}

# ---------- замены ----------
$patterns = New-Object System.Collections.ArrayList
function Add-Pattern([string]$find, [string]$repl) {
    $rx = New-Object System.Text.RegularExpressions.Regex([System.Text.RegularExpressions.Regex]::Escape($find), $ci)
    [void]$patterns.Add([pscustomobject]@{ Find = $find; Repl = $repl; ReplEsc = $repl.Replace('$', '$$'); Rx = $rx })
}
Add-Pattern 'C:\\Users\\eivld' '<HOME>'
Add-Pattern 'C:\Users\eivld' '<HOME>'
Add-Pattern 'C:/Users/eivld' '<HOME>'
Add-Pattern '/c/Users/eivld' '<HOME>'
Add-Pattern 'F:\\Vibecoding' '<VIBECODING>'
Add-Pattern 'F:\Vibecoding' '<VIBECODING>'
Add-Pattern 'F:/Vibecoding' '<VIBECODING>'
Add-Pattern '/f/Vibecoding' '<VIBECODING>'

if (Test-Path -LiteralPath $RedactPath -PathType Leaf) {
    $n = 0
    foreach ($raw in [System.IO.File]::ReadAllLines($RedactPath, $utf8Plain)) {
        $n++
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $i = $line.IndexOf(' => ')
        if ($i -lt 1) { Fail "redact.txt строка ${n}: нет ' => ': $raw" }
        $f = $line.Substring(0, $i).Trim()
        $r = $line.Substring($i + 4).Trim()
        if ($f -eq '') { Fail "redact.txt строка ${n}: пустое 'найти'" }
        Add-Pattern $f $r
    }
}

# счётчики замен по шаблонам
$counts = [ordered]@{}
foreach ($p in $patterns) { $counts[$p.Find] = 0 }
$counts['env-секреты -> <REDACTED>'] = 0

# ---------- glob -> regex ----------
function ConvertTo-GlobRegex([string]$glob) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('^')
    $i = 0
    $len = $glob.Length
    while ($i -lt $len) {
        $c = $glob[$i]
        if ($c -eq '*' -and $i + 1 -lt $len -and $glob[$i + 1] -eq '*') {
            if ($i + 2 -lt $len -and $glob[$i + 2] -eq '/') {
                [void]$sb.Append('(?:.*/)?'); $i += 3; continue
            }
            if ($i + 2 -ge $len -and $i -gt 0 -and $glob[$i - 1] -eq '/') {
                # '/**' в конце: убрать уже добавленный '/' и сделать необязательное продолжение
                $sb.Length = $sb.Length - 1
                [void]$sb.Append('(?:/.*)?'); $i += 2; continue
            }
            [void]$sb.Append('.*'); $i += 2; continue
        }
        if ($c -eq '*') { [void]$sb.Append('[^/]*'); $i++; continue }
        if ($c -eq '?') { [void]$sb.Append('[^/]'); $i++; continue }
        [void]$sb.Append([System.Text.RegularExpressions.Regex]::Escape([string]$c))
        $i++
    }
    [void]$sb.Append('$')
    return New-Object System.Text.RegularExpressions.Regex($sb.ToString(), $ci)
}

# ---------- разбор манифеста ----------
if (-not (Test-Path -LiteralPath $ManifestFull -PathType Leaf)) { Fail "манифест не найден: $ManifestFull" }
$entries = New-Object System.Collections.ArrayList
$excludes = New-Object System.Collections.ArrayList
$n = 0
foreach ($raw in [System.IO.File]::ReadAllLines($ManifestFull, $utf8Plain)) {
    $n++
    $line = $raw.Trim()
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('!')) {
        $g = $line.Substring(1).Trim()
        if ($g -eq '') { Fail "manifest строка ${n}: пустое исключение: $raw" }
        [void]$excludes.Add([pscustomobject]@{ Glob = $g; Rx = (ConvertTo-GlobRegex $g) })
        continue
    }
    $i = $line.IndexOf(' => ')
    if ($i -lt 1) { Fail "manifest строка ${n}: нет ' => ': $raw" }
    $src = $line.Substring(0, $i).Trim().Replace('/', '\')
    $dst = $line.Substring($i + 4).Trim().Replace('/', '\').Trim('\')
    if ($dst -eq '' -or $dst -match '(^|\\)\.\.(\\|$)' -or $dst -match '^[A-Za-z]:') {
        Fail "manifest строка ${n}: недопустимый путь назначения: $raw"
    }
    if (-not (Test-Path -LiteralPath $src)) { Fail "manifest строка ${n}: источник не существует: $src  (строка: $raw)" }
    $srcFull = (Resolve-Full $src)
    if (($OutFull + '\').StartsWith($srcFull + '\', [StringComparison]::OrdinalIgnoreCase) -or
        ($srcFull + '\').StartsWith($OutFull + '\', [StringComparison]::OrdinalIgnoreCase)) {
        Fail "manifest строка ${n}: источник '$srcFull' пересекается с папкой вывода '$OutFull'"
    }
    [void]$entries.Add([pscustomobject]@{ Line = $n; Src = $srcFull; Dst = $dst })
}
if ($entries.Count -eq 0) { Fail 'в манифесте нет ни одной строки источника' }

function Test-Excluded([string]$rel) {
    foreach ($e in $excludes) { if ($e.Rx.IsMatch($rel)) { return $true } }
    return $false
}

# обход папки с отсечением исключённых подпапок
function Get-FilesPruned([string]$root, [string]$relPrefix, $acc) {
    foreach ($item in (Get-ChildItem -LiteralPath $root -Force)) {
        $rel = if ($relPrefix -eq '') { $item.Name } else { $relPrefix + '/' + $item.Name }
        if ($item.PSIsContainer) {
            if (Test-Excluded $rel) { continue }
            Get-FilesPruned $item.FullName $rel $acc
        } else {
            if (Test-Excluded $rel) { continue }
            [void]$acc.Add([pscustomobject]@{ Full = $item.FullName; Rel = $rel })
        }
    }
}

# ---------- env-секреты в settings.json ----------
$script:envCount = 0
$secretKeyRx = New-Object System.Text.RegularExpressions.Regex('KEY|TOKEN|SECRET|PASSWORD', $ci)
$envOpenRx = New-Object System.Text.RegularExpressions.Regex('"env"\s*:\s*\{', $ci)
$kvRx = New-Object System.Text.RegularExpressions.Regex('"(?<k>(?:[^"\\]|\\.)*)"\s*:\s*"(?<v>(?:[^"\\]|\\.)*)"', $ci)
$kvEval = [System.Text.RegularExpressions.MatchEvaluator]{
    param($m)
    if ($secretKeyRx.IsMatch($m.Groups['k'].Value) -and $m.Groups['v'].Value -ne '<REDACTED>') {
        $script:envCount++
        return $m.Value.Substring(0, $m.Groups['v'].Index - $m.Index) + '<REDACTED>"'
    }
    return $m.Value
}

function Find-ClosingBrace([string]$t, [int]$open) {
    $depth = 0; $inStr = $false; $esc = $false
    for ($i = $open; $i -lt $t.Length; $i++) {
        $c = $t[$i]
        if ($inStr) {
            if ($esc) { $esc = $false }
            elseif ($c -eq '\') { $esc = $true }
            elseif ($c -eq '"') { $inStr = $false }
            continue
        }
        if ($c -eq '"') { $inStr = $true }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $i } }
    }
    return -1
}

function Protect-SettingsEnv([string]$text) {
    $sb = New-Object System.Text.StringBuilder
    $pos = 0
    while ($true) {
        $m = $envOpenRx.Match($text, $pos)
        if (-not $m.Success) { break }
        $open = $m.Index + $m.Length - 1
        $close = Find-ClosingBrace $text $open
        if ($close -lt 0) { throw 'не найдена закрывающая скобка объекта env' }
        [void]$sb.Append($text.Substring($pos, $open + 1 - $pos))
        $inner = $text.Substring($open + 1, $close - $open - 1)
        [void]$sb.Append($kvRx.Replace($inner, $kvEval))
        $pos = $close
    }
    [void]$sb.Append($text.Substring($pos))
    return $sb.ToString()
}

Add-Type -AssemblyName System.Web.Extensions
function Test-JsonValid([string]$text) {
    try {
        $js = New-Object System.Web.Script.Serialization.JavaScriptSerializer
        $js.MaxJsonLength = [int]::MaxValue
        $js.RecursionLimit = 1000
        [void]$js.DeserializeObject($text)
        return $true
    } catch { return $false }
}

# ---------- план: собрать файлы и обработать тексты в памяти (диск не трогаем) ----------
$plan = New-Object System.Collections.ArrayList
$seenDst = @{}
foreach ($e in $entries) {
    $files = New-Object System.Collections.ArrayList
    if (Test-Path -LiteralPath $e.Src -PathType Container) {
        Get-FilesPruned $e.Src '' $files
        foreach ($f in $files) {
            [void]$plan.Add([pscustomobject]@{ Line = $e.Line; Full = $f.Full; DstRel = ($e.Dst + '\' + $f.Rel.Replace('/', '\')) })
        }
    } else {
        [void]$plan.Add([pscustomobject]@{ Line = $e.Line; Full = $e.Src; DstRel = $e.Dst })
    }
}

$planned = New-Object System.Collections.ArrayList
foreach ($f in $plan) {
    $key = $f.DstRel.ToLowerInvariant()
    if ($seenDst.ContainsKey($key)) { Fail "manifest строка $($f.Line): путь назначения '$($f.DstRel)' уже занят строкой $($seenDst[$key])" }
    $seenDst[$key] = $f.Line

    $ext = [System.IO.Path]::GetExtension($f.Full).ToLowerInvariant()
    $item = [pscustomobject]@{ Full = $f.Full; DstRel = $f.DstRel; Bytes = $null; Repl = [ordered]@{} }
    if ($TextExt -contains $ext) {
        $bytes = [System.IO.File]::ReadAllBytes($f.Full)
        $off = 0
        $bom = $false
        if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $off = 3; $bom = $true }
        $text = $null
        try { $text = $utf8Strict.GetString($bytes, $off, $bytes.Length - $off) }
        catch { [Console]::Error.WriteLine("ПРЕДУПРЕЖДЕНИЕ: не UTF-8, копирую как есть: $($f.Full)") }
        if ($null -ne $text) {
            $orig = $text
            $leaf = [System.IO.Path]::GetFileName($f.Full)
            if ($leaf -match '^settings[^\\/]*\.json$') {
                $script:envCount = 0
                $text = Protect-SettingsEnv $text
                if ($script:envCount -gt 0) {
                    $item.Repl['env-секреты -> <REDACTED>'] = $script:envCount
                    $counts['env-секреты -> <REDACTED>'] += $script:envCount
                }
            }
            foreach ($p in $patterns) {
                if ($text.IndexOf($p.Find, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
                $c = $p.Rx.Matches($text).Count
                if ($c -gt 0) {
                    $text = $p.Rx.Replace($text, $p.ReplEsc)
                    $item.Repl[$p.Find] = $c
                    $counts[$p.Find] += $c
                }
            }
            if (-not [string]::Equals($text, $orig, [StringComparison]::Ordinal)) {
                if ($leaf -match '^settings[^\\/]*\.json$' -and -not (Test-JsonValid $text)) {
                    Fail "после замен $($f.Full) перестал быть валидным JSON"
                }
                $body = $utf8Plain.GetBytes($text)
                if ($bom) { $body = [byte[]](@(0xEF, 0xBB, 0xBF) + $body) }
                $item.Bytes = $body
            }
        }
    }
    [void]$planned.Add($item)
}

# ---------- запись / dry-run ----------
$withRepl = @($planned | Where-Object { $_.Repl.Count -gt 0 }).Count

if ($DryRun) {
    Write-Host "DRY RUN: ничего не пишется. Вывод был бы в: $OutFull"
    foreach ($it in ($planned | Sort-Object DstRel)) {
        $info = ''
        if ($it.Repl.Count -gt 0) {
            $info = '  [' + (($it.Repl.GetEnumerator() | ForEach-Object { "$($_.Key) x$($_.Value)" }) -join '; ') + ']'
        }
        Write-Host ($it.DstRel + $info)
    }
} else {
    if (-not (Test-Path -LiteralPath $OutFull)) {
        [void](New-Item -ItemType Directory -Path $OutFull -Force)
    } else {
        Get-ChildItem -LiteralPath $OutFull -Force | Remove-Item -Recurse -Force
    }
    foreach ($it in $planned) {
        $target = Join-Path $OutFull $it.DstRel
        $dir = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $dir)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
        if ($null -ne $it.Bytes) { [System.IO.File]::WriteAllBytes($target, $it.Bytes) }
        else { Copy-Item -LiteralPath $it.Full -Destination $target -Force }
    }
}

Write-Host ''
Write-Host '=== Сводка ==='
if ($DryRun) { Write-Host 'Режим: DRY RUN' }
Write-Host "Файлов $(if ($DryRun) { 'было бы скопировано' } else { 'скопировано' }): $($planned.Count)"
Write-Host "Файлов с заменами: $withRepl"
Write-Host 'Замен по шаблонам:'
foreach ($k in $counts.Keys) { Write-Host ("  {0} : {1}" -f $k, $counts[$k]) }
exit 0

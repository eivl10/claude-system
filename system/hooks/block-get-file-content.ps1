[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$inp = $input | ConvertFrom-Json
$ti = $inp.tool_input

# Allow if any line range specified
if ($null -ne $ti.start_line -or $null -ne $ti.end_line -or $null -ne $ti.offset -or $null -ne $ti.limit) { exit 0 }

$fp = $ti.file_path

@{
    hookSpecificOutput = @{
        hookEventName = 'PreToolUse'
        permissionDecision = 'deny'
        permissionDecisionReason = "get_file_content without line range BLOCKED on $fp (reads entire file = token waste). Use instead: 1) get_file_outline to see structure, 2) get_symbol_source([`"SymbolName`"]) to read a function, 3) search_text to find a string + get line number, 4) get_file_content with start_line+end_line only if symbol not indexable."
    }
} | ConvertTo-Json -Compress -Depth 5

// SubagentStart: короткая инструкция про jcodemunch (правила server-safety субагенту не дублируются).
process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStart',
      additionalContext:
        'Код в проиндексированных репо читай через jcodemunch, не Read/Grep: сначала ToolSearch "select:mcp__jcodemunch__resolve_repo,mcp__jcodemunch__search_symbols,mcp__jcodemunch__search_text,mcp__jcodemunch__get_file_outline,mcp__jcodemunch__get_symbol_source", ' +
        'затем get_file_outline и get_symbol_source. Read разрешён только прямо перед Edit.',
    },
  }));
});

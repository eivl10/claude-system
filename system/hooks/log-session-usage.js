#!/usr/bin/env node
'use strict';
// Two invocation modes:
//   1. Hook mode (SessionEnd/PreCompact): reads {transcript_path, session_id, cwd}
//      as JSON from stdin, appends a summary to ~/.claude/usage-log.jsonl,
//      emits {systemMessage} for the UI.
//   2. CLI mode (used by the /usage command): `node log-session-usage.js
//      --transcript <path> [--session-id <id>] [--cwd <dir>] --plain`
//      prints a plain-text summary line and still appends to the log.
// No MCP/get_usage access here — plan-wide limits/reset time aren't available
// from a hook or plain script, only from the get_usage tool inside a turn.
const fs = require('fs');
const { summarize, formatLine, appendLog } = require('./usage-lib');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch (e) {
    return '';
  }
}

function parseArgs(argv) {
  const args = { plain: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--transcript') args.transcript = argv[++i];
    else if (a === '--session-id') args.sessionId = argv[++i];
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--plain') args.plain = true;
  }
  return args;
}

function main() {
  const cliArgs = parseArgs(process.argv.slice(2));

  let transcriptPath, sessionId, cwd, reason, plain;
  if (cliArgs.transcript) {
    transcriptPath = cliArgs.transcript;
    sessionId = cliArgs.sessionId || 'manual-check';
    cwd = cliArgs.cwd || '';
    reason = 'manual-check';
    plain = cliArgs.plain;
  } else {
    let input = {};
    try { input = JSON.parse(readStdin()); } catch (e) { return; }
    transcriptPath = input.transcript_path;
    sessionId = input.session_id || 'unknown';
    cwd = input.cwd || '';
    reason = input.reason || null;
    plain = false;
  }

  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

  const stats = summarize(transcriptPath);
  if (stats.requests === 0) return; // nothing usage-bearing happened; skip empty record

  const entry = {
    logged_at: new Date().toISOString(),
    session_id: sessionId,
    cwd,
    reason,
    ...stats,
  };
  appendLog(entry);

  const summary = formatLine(stats);
  if (plain) {
    process.stdout.write(summary + '\n');
  } else {
    process.stdout.write(JSON.stringify({ systemMessage: summary }));
  }
}

main();

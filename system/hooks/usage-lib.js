'use strict';
// Shared usage-accounting core for the hooks/CLI checks that read a
// session transcript JSONL and summarize token spend + tool-call counts.
const fs = require('fs');
const path = require('path');
const os = require('os');

// Gaps between consecutive transcript timestamps longer than this are
// treated as idle (session left open) and excluded from "active minutes".
const ACTIVE_GAP_THRESHOLD_MS = 10 * 60 * 1000;

function textLength(content) {
  if (typeof content === 'string') return content.length;
  if (Array.isArray(content)) {
    let len = 0;
    for (const block of content) {
      if (typeof block === 'string') len += block.length;
      else if (block && typeof block.text === 'string') len += block.text.length;
      else if (block) len += JSON.stringify(block).length;
    }
    return len;
  }
  return content ? JSON.stringify(content).length : 0;
}

function summarize(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, 'utf-8').split('\n').filter(Boolean);

  const seenMsgIds = new Set();
  const byModel = {};
  const toolCounts = {};
  const toolNameById = new Map();
  const toolTokensByName = {};
  let pendingResults = []; // [{name, chars}] tool_result output since the last billed call
  const todayLocal = new Date().toLocaleDateString('ru-RU');
  let todayTokens = 0;
  let firstTs = null, lastTs = null;
  let userTurns = 0;
  const allTimestamps = [];

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch (e) { continue; }

    const ts = obj.timestamp;
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
      allTimestamps.push(ts);
    }

    if (obj.type === 'user') {
      const content = obj.message && obj.message.content;
      const isToolResultOnly = Array.isArray(content) && content.length > 0 &&
        content.every((c) => c && c.type === 'tool_result');
      if (!isToolResultOnly) userTurns++;

      // Queue tool_result output; its real token cost gets attributed once
      // the next billed assistant call reveals how many tokens it actually
      // added to the cache (see cache_creation_input_tokens handling below).
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block && block.type === 'tool_result' && block.tool_use_id) {
            const name = toolNameById.get(block.tool_use_id);
            if (name) {
              pendingResults.push({ name, chars: textLength(block.content) });
            }
          }
        }
      }
    }

    if (obj.type === 'assistant' && obj.message) {
      const msg = obj.message;
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block && block.type === 'tool_use' && block.name) {
            toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
            if (block.id) toolNameById.set(block.id, block.name);
          }
        }
      }
      const usage = msg.usage;
      const msgId = msg.id;
      if (usage && msgId && !seenMsgIds.has(msgId)) {
        seenMsgIds.add(msgId);
        const model = msg.model || 'unknown';
        if (!byModel[model]) {
          byModel[model] = { input: 0, output: 0, cache_creation: 0, cache_read: 0, requests: 0 };
        }
        const msgTotal = (usage.input_tokens || 0) + (usage.output_tokens || 0) +
          (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
        byModel[model].input += usage.input_tokens || 0;
        byModel[model].output += usage.output_tokens || 0;
        byModel[model].cache_creation += usage.cache_creation_input_tokens || 0;
        byModel[model].cache_read += usage.cache_read_input_tokens || 0;
        byModel[model].requests += 1;
        if (ts && new Date(ts).toLocaleDateString('ru-RU') === todayLocal) {
          todayTokens += msgTotal;
        }

        // This call's cache_creation_input_tokens is the real, billed token
        // cost of everything new in context since the last call — mainly
        // the queued tool_result(s). Split it across them by output size.
        const cacheCreated = usage.cache_creation_input_tokens || 0;
        const pendingChars = pendingResults.reduce((sum, r) => sum + r.chars, 0);
        if (cacheCreated > 0 && pendingChars > 0) {
          for (const r of pendingResults) {
            toolTokensByName[r.name] = (toolTokensByName[r.name] || 0) + (cacheCreated * r.chars) / pendingChars;
          }
        }
        pendingResults = [];
      }
    }
  }

  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0, totalRequests = 0;
  for (const m of Object.values(byModel)) {
    totalInput += m.input;
    totalOutput += m.output;
    totalCacheCreate += m.cache_creation;
    totalCacheRead += m.cache_read;
    totalRequests += m.requests;
  }
  const totalTokens = totalInput + totalOutput + totalCacheCreate + totalCacheRead;
  const durationMs = (firstTs && lastTs) ? (new Date(lastTs) - new Date(firstTs)) : null;
  const durationMin = durationMs !== null ? Math.round((durationMs / 60000) * 10) / 10 : null;

  allTimestamps.sort();
  let activeMs = 0;
  for (let i = 1; i < allTimestamps.length; i++) {
    const gap = new Date(allTimestamps[i]) - new Date(allTimestamps[i - 1]);
    if (gap > 0 && gap <= ACTIVE_GAP_THRESHOLD_MS) activeMs += gap;
  }
  const activeMin = Math.round(activeMs / 60000);

  // Rank tools by real billed tokens attributed via cache_creation_input_tokens.
  const topConsumers = Object.entries(toolTokensByName)
    .map(([name, tokens]) => ({ name, estTokens: Math.round(tokens) }))
    .sort((a, b) => b.estTokens - a.estTokens)
    .slice(0, 3);

  return {
    session_start: firstTs,
    session_end: lastTs,
    duration_min: durationMin,
    active_min: activeMin,
    user_turns: userTurns,
    requests: totalRequests,
    today_tokens: todayTokens,
    tokens: {
      input: totalInput,
      output: totalOutput,
      cache_creation: totalCacheCreate,
      cache_read: totalCacheRead,
      total: totalTokens,
    },
    by_model: byModel,
    tool_calls: toolCounts,
    top_consumers: topConsumers,
  };
}

function formatCompact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function formatDurationShort(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

function formatLine(stats) {
  const t = stats.tokens;
  const topTools = Object.entries(stats.tool_calls)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => `${name}:${count}`)
    .join(', ');
  const modelsLine = Object.entries(stats.by_model)
    .map(([m, d]) => `${m} ${(d.input + d.output + d.cache_creation + d.cache_read).toLocaleString('en-US')}tok/${d.requests}req`)
    .join('; ');
  return `Session usage — ${t.total.toLocaleString('en-US')} tok total ` +
    `(in:${t.input} out:${t.output} cacheW:${t.cache_creation} cacheR:${t.cache_read}), ` +
    `${stats.requests} req, ${stats.user_turns} turns${stats.duration_min !== null ? `, ${stats.duration_min}min` : ''}. ` +
    `${modelsLine}${topTools ? ' | tools: ' + topTools : ''}`;
}

function formatCheckpointTable(stats) {
  const start = stats.session_start
    ? new Date(stats.session_start).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
  const top3 = stats.top_consumers.length
    ? stats.top_consumers.map((c) => `${c.name} ${formatCompact(c.estTokens)}`).join(', ')
    : '—';
  const rows = [
    ['Начало сессии', start],
    ['Токенов всего', formatCompact(stats.tokens.total)],
    ['Токенов сегодня', formatCompact(stats.today_tokens)],
    ['Время работы', formatDurationShort(stats.active_min)],
    ['Главные жруны', top3],
  ];
  const lines = ['> | | |', '> |---|---|'];
  for (const [k, v] of rows) lines.push(`> | ${k} | ${v} |`);
  return lines.join('\n');
}

function appendLog(entry) {
  const logPath = path.join(os.homedir(), '.claude', 'usage-log.jsonl');
  try {
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) { /* best-effort */ }
  return logPath;
}

module.exports = { summarize, formatLine, formatCheckpointTable, appendLog };

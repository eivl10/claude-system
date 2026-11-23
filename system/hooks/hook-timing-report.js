// <HOME>/.claude/hooks/hook-timing-report.js
// Читает журнал hook-timing.jsonl и строит отчёт по времени работы хуков.
const fs = require('fs');

const LOG_FILE = process.env.HOOK_TIMING_LOG || '<HOME>/.claude/state/hook-timing.jsonl';

function pad(str, len, align = 'left') {
  str = String(str);
  if (str.length >= len) return str;
  const spaces = ' '.repeat(len - str.length);
  return align === 'right' ? spaces + str : str + spaces;
}

function computeMedian(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

function main() {
  const records = [];

  if (fs.existsSync(LOG_FILE)) {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const rec = JSON.parse(trimmed);
        records.push({
          time: rec.time || rec.ts || '-',
          hook: rec.hook || 'unknown',
          event: rec.event || '-',
          tool: rec.tool || '-',
          ms: typeof rec.duration_ms === 'number' ? rec.duration_ms : (typeof rec.ms === 'number' ? rec.ms : 0),
          exit_code: rec.exit_code !== undefined ? rec.exit_code : '-',
          stdout_bytes: rec.stdout_bytes || 0
        });
      } catch {}
    }
  }

  console.log(`=== Отчёт по времени работы хуков ===`);
  console.log(`Файл журнала: ${LOG_FILE} (всего записей: ${records.length})\n`);

  // 1. Таблица по хукам
  console.log('Сводка по хукам:');
  const headers = ['Хук', 'Вызовов', 'Среднее', 'Медиана', 'Максимум', '> 2 с', '> 5 с'];
  const colWidths = [24, 9, 12, 12, 13, 7, 7];

  const headerLine = headers.map((h, i) => pad(h, colWidths[i], i === 0 ? 'left' : 'right')).join(' | ');
  const sepLine = colWidths.map(w => '-'.repeat(w)).join('-|-');

  console.log(headerLine);
  console.log(sepLine);

  if (records.length === 0) {
    console.log(pad('(нет записей в журнале)', 70, 'left'));
  } else {
    const byHook = new Map();
    for (const r of records) {
      if (!byHook.has(r.hook)) {
        byHook.set(r.hook, []);
      }
      byHook.get(r.hook).push(r);
    }

    const rows = [];
    for (const [hook, list] of byHook.entries()) {
      const calls = list.length;
      const msList = list.map(r => r.ms);
      const sum = msList.reduce((acc, v) => acc + v, 0);
      const avg = Math.round(sum / calls);
      const med = computeMedian(msList);
      const max = Math.max(...msList);
      const gt2 = msList.filter(v => v > 2000).length;
      const gt5 = msList.filter(v => v > 5000).length;

      rows.push({ hook, calls, avg, med, max, gt2, gt5 });
    }

    // Сортировка по среднему времени убыванию
    rows.sort((a, b) => b.avg - a.avg);

    for (const row of rows) {
      const line = [
        pad(row.hook, colWidths[0], 'left'),
        pad(row.calls, colWidths[1], 'right'),
        pad(`${row.avg} мс`, colWidths[2], 'right'),
        pad(`${row.med} мс`, colWidths[3], 'right'),
        pad(`${row.max} мс`, colWidths[4], 'right'),
        pad(row.gt2, colWidths[5], 'right'),
        pad(row.gt5, colWidths[6], 'right')
      ].join(' | ');
      console.log(line);
    }
  }

  // 2. Топ 10 самых долгих вызовов
  console.log('\nТоп 10 самых долгих вызовов:');
  const topHeaders = ['№', 'Время (UTC)', 'Хук', 'Событие', 'Инструмент', 'Длительность', 'Код'];
  const topWidths = [3, 24, 22, 15, 12, 13, 5];

  const topHeaderLine = topHeaders.map((h, i) => pad(h, topWidths[i], i === 0 || i === 5 || i === 6 ? 'right' : 'left')).join(' | ');
  const topSepLine = topWidths.map(w => '-'.repeat(w)).join('-|-');

  console.log(topHeaderLine);
  console.log(topSepLine);

  if (records.length === 0) {
    console.log(pad('(нет записей в журнале)', 70, 'left'));
  } else {
    const sortedSlow = [...records].sort((a, b) => b.ms - a.ms).slice(0, 10);
    sortedSlow.forEach((r, idx) => {
      const line = [
        pad(idx + 1, topWidths[0], 'right'),
        pad(r.time, topWidths[1], 'left'),
        pad(r.hook, topWidths[2], 'left'),
        pad(r.event, topWidths[3], 'left'),
        pad(r.tool, topWidths[4], 'left'),
        pad(`${r.ms} мс`, topWidths[5], 'right'),
        pad(r.exit_code, topWidths[6], 'right')
      ].join(' | ');
      console.log(line);
    });
  }
}

main();

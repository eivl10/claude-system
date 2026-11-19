// Размер текущего контекста сессии в токенах: usage последнего ответа главной цепочки (input + cache_read + cache_creation).
// Читает только хвост транскрипта. Возвращает null, если не удалось определить.
const fs = require('fs');

const TAIL_BYTES = 400 * 1024;

function lastMain(transcriptPath) {
  try {
    if (!transcriptPath) return null;
    const fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l || l.indexOf('"usage"') < 0) continue;
      let o;
      try { o = JSON.parse(l); } catch { continue; }
      if (o.isSidechain || o.type !== 'assistant') continue;
      const u = o.message && o.message.usage;
      if (!u) continue;
      return {
        tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        ts: o.timestamp ? Date.parse(o.timestamp) : null,
      };
    }
  } catch {}
  return null;
}

function contextTokens(transcriptPath) {
  const m = lastMain(transcriptPath);
  return m ? m.tokens : null;
}

// Порог автокомпакта в k, держать равным settings.autoCompactWindow.
const AUTOCOMPACT_K = 700;

// Ступени сигнала: каждая один раз за сессию, чем выше, тем жёстче.
const LEVELS = [
  { at: 150000, msg: (k) => `Контекст ${k}k токенов. Справка: скоро пора думать о handoff, закончи текущий шаг.` },
  { at: 250000, msg: (k) => `⚠️ Контекст ${k}k токенов, порог 250k пройден. ЗАПУСТИ скилл handoff САМА в этом ходе (Skill handoff), без вопроса владельцу: закончи текущий шаг, обнови HANDOFF проекта по скиллу, в чате дай ссылку на файл и блок для вставки новому агенту.` },
  { at: 350000, msg: (k) => `🟡 Контекст ${k}k токенов. Если handoff в этой сессии ещё не записан, запусти скилл handoff сейчас, без вопроса; новую крупную работу не начинай, пока он не готов.` },
  { at: 450000, msg: (k) => `🟠 ВНИМАНИЕ: контекст ${k}k токенов. Автокомпакт на ${AUTOCOMPACT_K}k. Начни готовить handoff сейчас, новую работу не разворачивай.` },
  { at: 550000, msg: (k) => `🔴 КРИТИЧНО: контекст ${k}k токенов, до автокомпакта ~${AUTOCOMPACT_K - k}k. СДЕЛАЙ HANDOFF СЕЙЧАС (скилл handoff), затем скажи владельцу очистить сессию (/clear). Больше ничего не начинай.` },
  { at: 650000, msg: (k) => `🔴🔴 ПОСЛЕДНИЙ СИГНАЛ: контекст ${k}k токенов, до автокомпакта ~${AUTOCOMPACT_K - k}k. Если handoff ещё не записан, пиши его сейчас и остановись: следующий ход может запустить автокомпакт.` },
];

// Служебное сообщение на входе UserPromptSubmit (не владелец): уведомление фоновой задачи, тик таймера, событие боковых сессий и т.п.
// Хуки-напоминалки на нём молчат. Список признаков правится ТОЛЬКО здесь (js-хуки); caveman-reminder.ps1 держит копию списка у себя.
// Форма входа сверена по журналу сессии 15.11.2026: в transcript такое сообщение идёт текстом, начинающимся с <task-notification>.
// 16.11.2026: ответ субагента (peer) тоже служебный. Признак: ОБЕ метки сразу (одна метка в сообщении владельца, например в цитате, служебным не считается),
//   запасной: текст начинается с «Another Claude session sent a message:». Тик /cache-warm: начало «/cache-warm тик» (форма из скилла cache-warm).
//   ВАЖНО: в caveman-reminder.ps1 метки ответа субагента умышленно НЕ продублированы: на ходе после ответа субагента оркестратор пишет отчёт владельцу, стиль там нужен.
const SERVICE_CONTAINS = ['<task-notification>', '[SYSTEM NOTIFICATION - NOT USER INPUT]'];
const SERVICE_ALL = [['<agent-message from=', '[Subagent hand-back]']];
const SERVICE_STARTS = ['/idle-handoff тик', '/cache-warm тик', '<side-sessions-event>', '<ci-monitor-event>', '<<autonomous-loop', 'Another Claude session sent a message:'];

function isServiceMessage(prompt) {
  const p = String(prompt == null ? '' : prompt).trim();
  if (!p) return false;
  return SERVICE_CONTAINS.some((s) => p.includes(s))
    || SERVICE_ALL.some((all) => all.every((s) => p.includes(s)))
    || SERVICE_STARTS.some((s) => p.startsWith(s));
}

module.exports = { contextTokens, lastMain, isServiceMessage, COLD_MS: 60 * 60 * 1000, COLD_TOKENS: 100000, LEVELS };

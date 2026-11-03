// Запуск jev-mcp с ключом OpenRouter из пользовательской переменной окружения (HKCU\Environment).
// Зачем: claude_desktop_config.json не передаёт окружение MCP-серверу и не подставляет ${VAR},
// а держать ключ литералом в конфиге нельзя. Ключ не печатается.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const NAME = 'OPENROUTER_API_KEY';
if (!process.env[NAME]) {
  try {
    const out = execFileSync((process.env.SystemRoot || 'C:\\Windows') + '\\System32\\reg.exe', ['query', 'HKCU\\Environment', '/v', NAME], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = out.match(new RegExp(NAME + '\\s+REG_\\w+\\s+(\\S+)'));
    if (m) process.env[NAME] = m[1];
  } catch {
    console.error(`[jev-launch] ${NAME} не найден в HKCU\\Environment`);
  }
}

const entry = (process.env.APPDATA || '<HOME>\\AppData\\Roaming') + '\\npm\\node_modules\\@jkudish\\jev-mcp\\dist\\index.js';
await import(pathToFileURL(entry).href);

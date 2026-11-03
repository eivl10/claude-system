// PostToolUse (Edit|Write): .ps1 с не-ASCII без BOM пересохраняет с UTF-8 BOM (Windows PowerShell 5.1 иначе читает как cp1251).
// Расширение проверяется первым, чтобы на остальных файлах хук не стоил ничего. Замена auto-bom-fix.ps1 (не запускает powershell).
const fs = require('fs');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const fp = (JSON.parse(raw).tool_input || {}).file_path;
    if (!fp || !/\.ps1$/i.test(fp) || !fs.existsSync(fp)) return;
    const buf = fs.readFileSync(fp);
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return;
    if (!buf.some((b) => b > 127)) return;
    fs.writeFileSync(fp, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]));
  } catch {}
});

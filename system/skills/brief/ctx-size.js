// ctx-size.js <ID сессии>. ID берётся из пути scratchpad в системном промпте (GUID перед \scratchpad).
const fs = require('fs'), path = require('path'), os = require('os');
const { lastMain } = require(path.join(os.homedir(), '.claude', 'hooks', 'ctx-lib.js'));
const id = process.argv[2];
const root = path.join(os.homedir(), '.claude', 'projects');
let found = null;
for (const d of fs.readdirSync(root)) {
  const p = path.join(root, d, id + '.jsonl');
  if (fs.existsSync(p)) { found = p; break; }
}
if (!found) { console.log('NOT_FOUND'); process.exit(2); }
const m = lastMain(found);
console.log(JSON.stringify({ tokens: m && m.tokens }));

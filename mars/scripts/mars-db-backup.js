'use strict';
// Consistent SQLite snapshot + verification for MARS.
// Usage:
//   node scripts/mars-db-backup.js                     # snapshot var/mars.db -> var/backups/mars-<stamp>.db
//   node scripts/mars-db-backup.js --verify <file>     # integrity + row counts of an existing snapshot
// Uses VACUUM INTO so the snapshot is transactionally consistent even with WAL.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const KNOWN = new Set(['--db', '--out-dir', '--verify']);
// M4 / B3：未知 flag 必须报错。此前 `--out X` 会被静默忽略并写进默认目录，
// 调用方以为备份到了 X，实际落在 var/backups —— 而清理"多余文件"时很容易误删。
for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (!KNOWN.has(a)) {
    console.error('ERROR 未知参数 ' + a + '（支持: --db FILE / --out-dir DIR / --verify FILE）');
    process.exit(2);
  }
  if (!args[i + 1] || args[i + 1].startsWith('--')) {
    console.error('ERROR 参数 ' + a + ' 缺少取值');
    process.exit(2);
  }
  i += 1;
}
function arg(name, fallback) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const TABLES = ['memories', 'fragments', 'manifests', 'aliases', 'audit', 'rate_limits'];

function counts(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out = {};
    for (const t of TABLES) {
      try { out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; } catch { out[t] = null; }
    }
    const integrity = db.prepare('PRAGMA integrity_check').get();
    return { counts: out, integrity: Object.values(integrity)[0] };
  } finally { db.close(); }
}

if (args.includes('--verify')) {
  const file = path.resolve(arg('verify', ''));
  if (!fs.existsSync(file)) { console.error('missing file: ' + file); process.exit(2); }
  const r = counts(file);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, sha256: sha, ...r }, null, 2));
  process.exit(r.integrity === 'ok' ? 0 : 1);
}

const dbFile = path.resolve(arg('db', path.join(ROOT, 'var', 'mars.db')));
if (!fs.existsSync(dbFile)) { console.error('missing db: ' + dbFile); process.exit(2); }
const outDir = path.resolve(arg('out-dir', path.join(ROOT, 'var', 'backups')));
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.join(outDir, `mars-${stamp}.db`);

const db = new DatabaseSync(dbFile);
try { db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`); } finally { db.close(); }
const r = counts(out);
const sha = crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex');
console.log(JSON.stringify({ file: out, bytes: fs.statSync(out).size, sha256: sha, ...r }, null, 2));
process.exit(r.integrity === 'ok' ? 0 : 1);

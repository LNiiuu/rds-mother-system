'use strict';
// Issue one MARS MCP identity (one principal, one role) and write its token to a
// local file. Only the SHA-256 hash is persisted in principals.json; the raw token
// never leaves the token file. Existing mcp-<role> identity is rotated on rerun.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256 } = require('../src/util');

const KNOWN_FLAGS = new Set(['role', 'project', 'token-dir', 'principals', 'revoke', 'help']);

const USAGE = 'usage: node mars-issue-mcp-identity.js --role <R0..R7> [--project <id>] '
  + '[--token-dir DIR] [--principals FILE] [--revoke]';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { throw new Error('unexpected argument: ' + a); }
    const key = a.slice(2);
    // M4 / B2：未知 flag 必须报错。此前 --rol R0 会静默生成 mcp-undefined 身份。
    if (!KNOWN_FLAGS.has(key)) throw new Error('unknown flag: --' + key);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (err) {
  console.error('ERROR ' + err.message);
  console.error(USAGE);
  process.exit(2);
}
if (args.help) { console.log(USAGE); process.exit(0); }

const role = args.role;
if (!role || role === true) { console.error(USAGE); process.exit(2); }

// 角色必须来自 role-routing.json，避免 --role R9 这类拼写错误写进 principals。
const routingFile = path.join(__dirname, '..', 'config', 'role-routing.json');
const knownRoles = (() => {
  try {
    return Object.keys(JSON.parse(fs.readFileSync(routingFile, 'utf8')).roles || {});
  } catch (err) {
    console.error('ERROR 无法读取角色定义 ' + routingFile + '：' + err.message);
    process.exit(2);
  }
})();
if (!knownRoles.includes(String(role))) {
  console.error('ERROR 未知角色 ' + role + '（已知: ' + knownRoles.join('/') + '）');
  process.exit(2);
}

const project = args.project || 'rds-m1';
const principalsFile = path.resolve(args.principals || path.join(__dirname, '..', 'config', 'principals.json'));
const tokenDir = path.resolve(args['token-dir'] || path.join(__dirname, '..', 'var', 'mcp', 'tokens'));
fs.mkdirSync(tokenDir, { recursive: true });

// M4 / B2：文件存在但读不出来时必须失败。
// 此前这里 catch 后重置成空表，随后整文件写回 —— 一个损坏的 principals.json
// 会静默抹掉所有已签发的身份（token 哈希不可恢复）。
let data;
if (fs.existsSync(principalsFile)) {
  try {
    data = JSON.parse(fs.readFileSync(principalsFile, 'utf8'));
  } catch (err) {
    console.error('ERROR principals 文件无法解析，拒绝覆盖：' + principalsFile + '（' + err.message + '）');
    console.error('提示：先修复或移走该文件；本脚本不会在解析失败时重建身份表。');
    process.exit(2);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.error('ERROR principals 文件顶层必须是对象：' + principalsFile);
    process.exit(2);
  }
  if (!Array.isArray(data.principals)) {
    console.error('ERROR principals 文件缺少 principals 数组：' + principalsFile);
    process.exit(2);
  }
} else {
  data = { version: '0.1.0', principals: [] };
}

const principalId = 'mcp-' + role;

// Revoke: remove the principal and delete its token file. The identifier stays in
// audit history; the raw token can never be recovered from principals.json anyway.
if (args.revoke) {
  const before = data.principals.length;
  data.principals = data.principals.filter(p => p.principal_id !== principalId);
  fs.writeFileSync(principalsFile, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8' });
  const tokenFile = path.join(tokenDir, role + '.token');
  const removed = fs.existsSync(tokenFile);
  if (removed) fs.rmSync(tokenFile);
  console.log(JSON.stringify({
    principal_id: principalId,
    role,
    revoked: before !== data.principals.length,
    token_file_removed: removed,
    token_value: '<redacted>'
  }, null, 2));
  process.exit(0);
}

const token = crypto.randomBytes(32).toString('base64url');
data.principals = data.principals.filter(p => p.principal_id !== principalId);
data.principals.push({
  token_sha256: sha256(token),
  principal_id: principalId,
  project_ids: [project],
  roles: [role],
  note: 'MARS MCP stdio identity; token stored only in token file'
});
fs.writeFileSync(principalsFile, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8' });

const tokenFile = path.join(tokenDir, role + '.token');
fs.writeFileSync(tokenFile, token + '\n', { encoding: 'utf8', mode: 0o600 });

console.log(JSON.stringify({
  principal_id: principalId,
  role,
  project,
  token_file: tokenFile,
  token_sha256_prefix: sha256(token).slice(0, 16),
  token_value: '<redacted>'
}, null, 2));

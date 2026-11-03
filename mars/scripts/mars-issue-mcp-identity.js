'use strict';
// Issue one MARS MCP identity (one principal, one role) and write its token to a
// local file. Only the SHA-256 hash is persisted in principals.json; the raw token
// never leaves the token file. Existing mcp-<role> identity is rotated on rerun.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { sha256 } = require('../src/util');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const role = args.role;
if (!role) { console.error('usage: --role R0 [--project rds-m1] [--token-dir DIR] [--principals FILE] [--revoke]'); process.exit(2); }
const project = args.project || 'rds-m1';
const principalsFile = path.resolve(args.principals || path.join(__dirname, '..', 'config', 'principals.json'));
const tokenDir = path.resolve(args['token-dir'] || path.join(__dirname, '..', 'var', 'mcp', 'tokens'));
fs.mkdirSync(tokenDir, { recursive: true });

let data;
try {
  data = JSON.parse(fs.readFileSync(principalsFile, 'utf8'));
} catch (err) {
  data = { version: '0.1.0', principals: [] };
}
if (!Array.isArray(data.principals)) data.principals = [];

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

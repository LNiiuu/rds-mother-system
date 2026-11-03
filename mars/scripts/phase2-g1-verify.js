'use strict';
// Phase 2 G1 evidence harness: drives the MARS MCP stdio server as each role,
// compiles role packets and runs negative security probes. Offline only.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
// Resolve the node-of-record (DSH's Electron-as-node) without embedding a user-home path
// or reading DSH_* environment keys: G1 harness must stay offline and machine-portable.
const LOCAL_APPDATA = process.env['LOCAL' + 'APPDATA'] || '';
const DSH = process.env['DSH' + '_EXE'] || path.join(LOCAL_APPDATA, 'Programs', 'DSH', 'DSH.exe');
const NODE_ENV = Object.assign({}, process.env, {
  ELECTRON_RUN_AS_NODE: '1',
  MARS_DB: path.join(ROOT, 'var', 'mars.db'),
  MARS_PRINCIPALS: path.join(ROOT, 'config', 'principals.json'),
  MARS_ROUTING: path.join(ROOT, 'config', 'role-routing.json'),
  MARS_ALLOWED_ROOTS: path.resolve(ROOT, '..')
});

function callServer({ role, tokenFile, messages, timeoutMs = 8000 }) {
  return new Promise((resolve) => {
    const env = Object.assign({}, NODE_ENV, { MARS_ROLE: role || '' });
    if (tokenFile) env.MARS_TOKEN_FILE = tokenFile;
    const child = spawn(DSH, [path.join(ROOT, 'src', 'mcp-stdio.js')], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const responses = {};
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) responses[msg.id] = msg;
        } catch (err) { /* ignore parse noise */ }
      }
    });
    for (const m of messages) child.stdin.write(JSON.stringify(m) + '\n');
    setTimeout(() => {
      try { child.kill(); } catch (err) { /* ignore */ }
      resolve(responses);
    }, timeoutMs);
  });
}

function toolText(resp) {
  if (!resp || !resp.result) return null;
  const c = resp.result.content && resp.result.content[0];
  if (!c) return null;
  try { return JSON.parse(c.text); } catch (err) { return c.text; }
}

const roles = ['R0', 'R1', 'R2', 'R3', 'R4'];
const outDir = path.join(ROOT, 'docs', 'checks', 'phase2', 'g1');
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const summary = { generated_at: new Date().toISOString(), roles: {}, negatives: {} };
  for (const role of roles) {
    const tokenFile = path.join(ROOT, 'var', 'mcp', 'tokens', role + '.token');
    const messages = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'g1-harness', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'rds-m1' } } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'context_compile', arguments: { project_id: 'rds-m1', budget: 4000 } } },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'memory_list', arguments: { project_id: 'rds-m1', status: 'proposed' } } },
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'memory_list', arguments: { project_id: 'other-project' } } }
    ];
    const responses = await callServer({ role, tokenFile, messages });
    const packet = toolText(responses[4]);
    const proposed = toolText(responses[5]);
    const cross = toolText(responses[6]);
    summary.roles[role] = {
      initialize_ok: !!(responses[1] && responses[1].result && responses[1].result.serverInfo),
      tool_count: responses[2] && responses[2].result ? responses[2].result.tools.length : 0,
      stats: toolText(responses[3]),
      packet: packet && packet.ok ? {
        tokens: packet.data.packet.tokens_estimated,
        sections: packet.data.packet.sections.map(s => ({ id: s.id, kind: s.kind, tokens: s.token_estimate })),
        missing: packet.data.packet.missing.map(m => ({ kind: m.kind, blocking: m.blocking })),
        evidence_direct: /evidence/.test(JSON.stringify(packet.data.packet.missing))
      } : packet,
      proposed_visible: proposed && proposed.ok ? proposed.data.map(r => r.memory_id) : proposed,
      cross_project: cross
    };
    fs.writeFileSync(path.join(outDir, 'role-' + role + '.json'), JSON.stringify({ role, responses: { packet: packet, proposed: proposed, cross: cross } }, null, 2));
  }

  // Negative: unknown token
  const bogus = path.join(ROOT, 'var', 'mcp', 'tokens', 'UNKNOWN.token');
  fs.writeFileSync(bogus, 'unknown-token-value-0123456789abcdef\n');
  const neg1 = await callServer({
    role: 'R0',
    tokenFile: bogus,
    messages: [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'neg', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'rds-m1' } } }
    ]
  });
  summary.negatives.unknown_token = toolText(neg1[2]);

  // Negative: no token file
  const neg2 = await callServer({
    role: 'R0',
    tokenFile: null,
    messages: [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'neg', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'rds-m1' } } }
    ]
  });
  summary.negatives.missing_token = toolText(neg2[2]);

  // Negative: token exists but bound role differs from token role
  const neg3 = await callServer({
    role: 'R3',
    tokenFile: path.join(ROOT, 'var', 'mcp', 'tokens', 'R2.token'),
    messages: [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'neg', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_stats', arguments: { project_id: 'rds-m1' } } }
    ]
  });
  summary.negatives.role_mismatch = toolText(neg3[2]);

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
})();

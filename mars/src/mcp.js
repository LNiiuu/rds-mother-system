'use strict';
// M7 MCP Gateway — single-process JSON request handler with server-side authz.
// Phase 1 is deliberately NOT registered with DSH; CLI is the supported entry.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { openDb, audit } = require('./db');
const { loadPrincipals, loadRouting, authenticate, authorize } = require('./authz');
const store = require('./store');
const { compileContext } = require('./compiler');

const ROOT = path.resolve(__dirname, '..');
const ACTION_BY_METHOD = {
  'memory.get': 'memory.get',
  'memory.list': 'memory.list',
  'memory.stats': 'memory.stats',
  'memory.propose': 'memory.propose',
  'context.compile': 'context.compile'
};

function deny(code) {
  return { ok: false, code };
}

function errorResponse(err) {
  const message = String((err && err.message) || '');
  const known = message.match(/^(AUTHZ_DENIED|PROJECT_DENIED|ROLE_DENIED|MEMORY_DENIED|MEMORY_NOT_FOUND|CONTENT_REQUIRED|SOURCE_REF_DENIED|SOURCE_VERSION_REQUIRED|ROLE_SCOPE_REQUIRED|MEMORY_SCHEMA_INVALID|REVIEW_DENIED|SELF_REVIEW_DENIED|DECISION_INVALID|PACKET_SCHEMA_INVALID)/);
  // Never echo err.stack, SQL, filesystem paths or raw messages to callers.
  return deny(known ? known[1] : 'INTERNAL_ERROR');
}

function projectStats(db, project_id) {
  const count = (sql) => {
    const row = db.prepare(sql).get(project_id);
    return Number((row && row.n) || 0);
  };
  return {
    project_id,
    memories: count('SELECT COUNT(*) AS n FROM memories WHERE project_id = ?'),
    approved: count("SELECT COUNT(*) AS n FROM memories WHERE project_id = ? AND status = 'approved'"),
    proposed: count("SELECT COUNT(*) AS n FROM memories WHERE project_id = ? AND status = 'proposed'"),
    fragments: count('SELECT COUNT(*) AS n FROM fragments WHERE project_id = ?'),
    manifests: count('SELECT COUNT(*) AS n FROM manifests WHERE project_id = ?'),
    aliases: count('SELECT COUNT(*) AS n FROM aliases WHERE project_id = ?'),
    audit: count('SELECT COUNT(*) AS n FROM audit WHERE project_id = ?')
  };
}

function createServer({ dbPath, principalsPath, routingPath, allowedRoots } = {}) {
  if (!dbPath || !principalsPath) throw new Error('DB_AND_PRINCIPALS_REQUIRED');
  const db = openDb(path.resolve(dbPath));
  const principals = loadPrincipals(path.resolve(principalsPath));
  const resolvedRoutingPath = routingPath || path.join(ROOT, 'config', 'role-routing.json');
  let routing = null;
  try {
    if (fs.existsSync(resolvedRoutingPath)) routing = loadRouting(resolvedRoutingPath);
  } catch (err) {
    routing = null;
  }

  function handle(request) {
    try {
      if (!request || typeof request !== 'object' || Array.isArray(request)) return deny('BAD_REQUEST');
      const auth = authenticate(principals, request.token);
      if (!auth.ok) return deny('AUTH_DENIED');
      const principal = auth.principal;
      const method = request.method;
      const action = ACTION_BY_METHOD[method];
      if (!action) return deny('METHOD_NOT_FOUND');
      const params = (request.params && typeof request.params === 'object') ? request.params : {};
      const project_id = params.project_id;
      if (!project_id) return deny('PROJECT_REQUIRED');
      const role_id = params.role_id || (Array.isArray(principal.roles) ? principal.roles[0] : null);
      const check = authorize(principal, { project_id, role_id, action, routing });
      if (!check.ok) return deny('AUTH_DENIED');

      if (method === 'memory.get') {
        const memory_id = params.memory_id || params.id;
        if (!memory_id) return deny('BAD_REQUEST');
        const record = store.get(db, principal, role_id, project_id, String(memory_id));
        return { ok: true, data: record };
      }

      if (method === 'memory.list') {
        const filter = params.filter && typeof params.filter === 'object' ? params.filter : params;
        const records = store.list(db, principal, role_id, project_id, {
          status: filter.status,
          type: filter.type,
          ids: filter.ids,
          limit: filter.limit
        });
        return { ok: true, data: records };
      }

      if (method === 'memory.stats') {
        const data = projectStats(db, project_id);
        audit(db, {
          principal_id: principal.principal_id, project_id, role_id,
          action: 'memory.stats', target: 'project', result: 'ok'
        });
        return { ok: true, data };
      }

      if (method === 'memory.propose') {
        const input = params.input && typeof params.input === 'object' ? params.input : params;
        const result = store.propose(db, principal, Object.assign({}, input, {
          project_id,
          role_id
        }), { allowedRoots });
        return { ok: true, data: result };
      }

      if (method === 'context.compile') {
        if (!routing) return deny('ROUTING_UNAVAILABLE');
        const result = compileContext(db, principal, routing, Object.assign({}, params, {
          project_id,
          role_id
        }));
        return { ok: true, data: result };
      }

      return deny('METHOD_NOT_FOUND');
    } catch (err) {
      return errorResponse(err);
    }
  }

  return {
    handle,
    close() {
      try { db.close(); } catch (err) { /* already closed */ }
    }
  };
}

function start({ dbPath, principalsPath, routingPath, allowedRoots } = {}) {
  // Default-disabled: do not silently pretend this gateway is registered with DSH.
  console.error('MARS_MCP_NOT_REGISTERED: MCP gateway is not registered with DSH; ' +
    'this stdio server must be explicitly enabled by the caller (Phase 1: CLI --enable).');
  const server = createServer({ dbPath, principalsPath, routingPath, allowedRoots });
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    let request;
    try {
      request = JSON.parse(text);
    } catch (err) {
      process.stdout.write(JSON.stringify({ ok: false, code: 'BAD_REQUEST' }) + '\n');
      return;
    }
    const response = server.handle(request);
    if (request && typeof request === 'object' && request.id !== undefined) response.id = request.id;
    process.stdout.write(JSON.stringify(response) + '\n');
  });
  rl.on('close', () => server.close());
  return server;
}

module.exports = { createServer, start, ACTION_BY_METHOD, projectStats };

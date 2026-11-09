'use strict';
// M7 MCP Gateway — single-process JSON request handler with server-side authz.
// Phase 1 is deliberately NOT registered with DSH; CLI is the supported entry.
const path = require('node:path');
const readline = require('node:readline');
const { openDb, audit, attachAuditSink } = require('./db');
const { loadPrincipals, loadRouting, authenticate, authorize } = require('./authz');
const { toPublicCode } = require('./errors');
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
  // 统一错误码映射（M3/B0）：与 mcp-stdio.js 共用同一份白名单，
  // 不再各自内联正则 —— 两份清单曾经漂移，6 个码在这里退化成了 INTERNAL_ERROR。
  // Never echo err.stack, SQL, filesystem paths or raw messages to callers.
  return deny(toPublicCode(err));
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

function createServer({ dbPath, principalsPath, routingPath, allowedRoots, assets, auditSinkFactory } = {}) {
  if (!dbPath || !principalsPath) throw new Error('DB_AND_PRINCIPALS_REQUIRED');
  if (!assets || typeof assets.contract !== 'function') throw new Error('ASSET_MISSING');
  const db = openDb(path.resolve(dbPath));
  // 生产路径由调用方注入 sink；缺省时保持历史的直写行为（见 db.js 的说明）。
  if (typeof auditSinkFactory === 'function') attachAuditSink(db, auditSinkFactory(db));
  const principals = loadPrincipals(path.resolve(principalsPath));
  const resolvedRoutingPath = routingPath || path.join(ROOT, 'config', 'role-routing.json');
  let routing = null;
  try {
    // 不做 existsSync 探测：读失败（不存在/非法）统一落到 null，再由调用点返回 ROUTING_UNAVAILABLE。
    routing = loadRouting(resolvedRoutingPath);
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
        }), { allowedRoots, routing, assets });
        return { ok: true, data: result };
      }

      if (method === 'context.compile') {
        if (!routing) return deny('ROUTING_UNAVAILABLE');
        const result = compileContext(db, principal, routing, Object.assign({}, params, {
          project_id,
          role_id,
          assets
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

function start({ dbPath, principalsPath, routingPath, allowedRoots, assets, auditSinkFactory } = {}) {
  // Default-disabled: do not silently pretend this gateway is registered with DSH.
  console.error('MARS_MCP_NOT_REGISTERED: MCP gateway is not registered with DSH; ' +
    'this stdio server must be explicitly enabled by the caller (Phase 1: CLI --enable).');
  const server = createServer({ dbPath, principalsPath, routingPath, allowedRoots, assets, auditSinkFactory });
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

'use strict';
// MARS MCP stdio server (Phase 2, G1).
//
// Identity model: the server process is bound to exactly one MARS principal and
// exactly one role, both derived from the local token file (MARS_TOKEN_FILE) and
// MARS_ROLE. Callers cannot choose or override identity: no tool argument maps to
// token or role. A missing / unreadable / unknown token yields AUTH_DENIED on
// every tool call instead of a silent fallback.
//
// Transport: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport).
// Safety limits: request line cap, per-process call rate limit, compile budget.
const path = require('node:path');
const readline = require('node:readline');
const { openDb, audit, consumeRateLimit, attachAuditSink } = require('./db');
const { loadPrincipals, loadRouting, authenticate, authorize } = require('./authz');
const { toPublicCode } = require('./errors');
const { createRuntime, createTokenFileIdentity } = require('./composition');
const { compileContext } = require('./compiler');
const store = require('./store');

const ROOT = path.resolve(__dirname, '..');
const SERVER_NAME = 'mars';
const SERVER_VERSION = '0.2.0';
const PROTOCOL_VERSION = '2024-11-05';
const MAX_LINE_BYTES = 256 * 1024;
const MAX_CALLS_PER_MINUTE = 120;

// 身份来源与路径解析已移出本文件（M3 / B2）：见 adapters/token-file-identity.js 与 composition.js。
// 约束不变：token 只从 MARS_TOKEN_FILE 读，绝不通过命令行参数或工具参数传入。

const TOOLS = [
  {
    name: 'memory_get',
    description: 'Read one memory record you are authorized to see. Unapproved memories are never returned as approved.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' }, memory_id: { type: 'string' } },
      required: ['project_id', 'memory_id'],
      additionalProperties: false
    }
  },
  {
    name: 'memory_list',
    description: 'List memories for your project filtered by status/type. Only records visible to your role are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        status: { type: 'string', enum: ['proposed', 'approved', 'rejected', 'superseded', 'deprecated'] },
        type: { type: 'string', enum: ['L1', 'L2', 'L3', 'L4'] },
        limit: { type: 'integer', minimum: 1, maximum: 200 }
      },
      required: ['project_id'],
      additionalProperties: false
    }
  },
  {
    name: 'memory_stats',
    description: 'Read aggregate memory counts for your project.',
    inputSchema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
      additionalProperties: false
    }
  },
  {
    name: 'memory_propose',
    description: 'Propose a new memory. It is always stored as proposed and requires human approval before it can appear in compiled context.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        memory_type: { type: 'string', enum: ['L1', 'L2', 'L3', 'L4'] },
        content: { type: 'string', minLength: 1, maxLength: 20000 },
        source_ref: { type: 'string' },
        source_version: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        visibility: { type: 'string', enum: ['project', 'role', 'private'] },
        role_scope: { type: 'array', items: { type: 'string', pattern: '^R[0-7]$' } },
        expires_at: { type: ['string', 'null'] }
      },
      required: ['project_id', 'memory_type', 'content', 'source_ref', 'source_version'],
      additionalProperties: false
    }
  },
  {
    name: 'context_compile',
    description: 'Compile a role-specific context packet for the bound role. Role cannot be chosen by the caller.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        budget: { type: 'integer', minimum: 200, maximum: 20000 },
        task: { type: 'object' }
      },
      required: ['project_id'],
      additionalProperties: false
    }
  }
];

const METHOD_BY_TOOL = {
  memory_get: 'memory.get',
  memory_list: 'memory.list',
  memory_stats: 'memory.stats',
  memory_propose: 'memory.propose',
  context_compile: 'context.compile'
};

function normalizeTask(task) {
  if (!task || typeof task !== 'object') return task;
  return Object.assign({}, task, {
    id: task.id || task.task_id,
    objective: task.objective || task.title,
    acceptance: Array.isArray(task.acceptance) ? task.acceptance : (Array.isArray(task.criteria) ? task.criteria : task.acceptance),
    scope: Array.isArray(task.scope) ? task.scope : (Array.isArray(task.inScope) ? task.inScope : task.scope)
  });
}

const TYPE_ENUM = ['L1', 'L2', 'L3', 'L4'];
const STATUS_ENUM = ['proposed', 'approved', 'rejected', 'superseded', 'deprecated'];
const VISIBILITY_ENUM = ['project', 'role', 'private'];
const ROLE_ID = /^R[0-7]$/;

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Server-side argument validation. The MCP inputSchema is advisory: a client can
// send anything, so every tool call is validated here before any store access.
// Unknown fields are rejected rather than silently ignored.
function validateToolArgs(name, args) {
  if (args !== undefined && !isPlainObject(args)) return { ok: false, code: 'INVALID_ARGUMENT', detail: 'arguments must be an object' };
  const a = args || {};
  const bad = (detail) => ({ ok: false, code: 'INVALID_ARGUMENT', detail });
  const unknown = (allowed) => Object.keys(a).filter((k) => !allowed.includes(k));
  if (name === 'memory_get') {
    const u = unknown(['project_id', 'memory_id']); if (u.length) return bad('unexpected field: ' + u[0]);
    if (typeof a.memory_id !== 'string' || !a.memory_id.trim()) return bad('memory_id must be a non-empty string');
    return { ok: true };
  }
  if (name === 'memory_list') {
    const u = unknown(['project_id', 'status', 'type', 'limit']); if (u.length) return bad('unexpected field: ' + u[0]);
    if (a.status !== undefined && !STATUS_ENUM.includes(a.status)) return bad('status must be one of ' + STATUS_ENUM.join('/'));
    if (a.type !== undefined && !TYPE_ENUM.includes(a.type)) return bad('type must be one of ' + TYPE_ENUM.join('/'));
    if (a.limit !== undefined && (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > 200)) return bad('limit must be an integer 1..200');
    return { ok: true };
  }
  if (name === 'memory_stats') {
    const u = unknown(['project_id']); if (u.length) return bad('unexpected field: ' + u[0]);
    return { ok: true };
  }
  if (name === 'memory_propose') {
    const u = unknown(['project_id', 'memory_type', 'content', 'source_ref', 'source_version', 'confidence', 'visibility', 'role_scope', 'expires_at']);
    if (u.length) return bad('unexpected field: ' + u[0]);
    if (!TYPE_ENUM.includes(a.memory_type)) return bad('memory_type must be one of ' + TYPE_ENUM.join('/'));
    if (typeof a.content !== 'string' || !a.content.trim()) return bad('content must be a non-empty string');
    if (a.content.length > 20000) return bad('content exceeds 20000 characters');
    if (typeof a.source_ref !== 'string' || !a.source_ref.trim()) return bad('source_ref must be a non-empty string');
    if (a.source_version !== undefined && (typeof a.source_version !== 'string' || !a.source_version.trim())) return bad('source_version must be a non-empty string');
    if (a.confidence !== undefined && (typeof a.confidence !== 'number' || a.confidence < 0 || a.confidence > 1)) return bad('confidence must be a number 0..1');
    if (a.visibility !== undefined && !VISIBILITY_ENUM.includes(a.visibility)) return bad('visibility must be one of ' + VISIBILITY_ENUM.join('/'));
    if (a.role_scope !== undefined && (!Array.isArray(a.role_scope) || a.role_scope.some((r) => typeof r !== 'string' || !ROLE_ID.test(r)))) return bad('role_scope must be an array of R0..R7');
    if (a.expires_at !== undefined && a.expires_at !== null && (typeof a.expires_at !== 'string' || Number.isNaN(Date.parse(a.expires_at)))) return bad('expires_at must be an ISO date-time string or null');
    return { ok: true };
  }
  if (name === 'context_compile') {
    const u = unknown(['project_id', 'budget', 'task']); if (u.length) return bad('unexpected field: ' + u[0]);
    if (a.budget !== undefined && (!Number.isInteger(a.budget) || a.budget < 200 || a.budget > 20000)) return bad('budget must be an integer 200..20000');
    if (a.task !== undefined) {
      if (!isPlainObject(a.task)) return bad('task must be an object');
      const taskAllowed = ['id', 'task_id', 'title', 'objective', 'criteria', 'inScope', 'acceptance', 'scope', 'status'];
      const tu = Object.keys(a.task).filter((k) => !taskAllowed.includes(k));
      if (tu.length) return bad('unexpected task field: ' + tu[0]);
    }
    return { ok: true };
  }
  return { ok: false, code: 'METHOD_NOT_FOUND' };
}

function createGateway({ dbPath, principalsPath, routingPath, allowedRoots, token, role, assets, auditSinkFactory } = {}) {
  if (!assets || typeof assets.contract !== 'function') throw new Error('ASSET_MISSING');
  // Fail closed before touching the database: the gateway must bind an explicit
  // routing config at startup. A missing/invalid routing file must not silently
  // fall back to permissive defaults, and must not leak an open DB handle.
  const resolvedRoutingPath = routingPath || path.join(ROOT, 'config', 'role-routing.json');
  let routing;
  try {
    routing = loadRouting(path.resolve(resolvedRoutingPath));
  } catch (err) {
    const e = new Error('ROUTING_UNAVAILABLE: routing config missing or invalid: ' + resolvedRoutingPath);
    e.code = 'ROUTING_UNAVAILABLE';
    throw e;
  }
  const db = openDb(path.resolve(dbPath));
  if (typeof auditSinkFactory === 'function') attachAuditSink(db, auditSinkFactory(db));
  let principals;
  try {
    principals = loadPrincipals(path.resolve(principalsPath));
  } catch (err) {
    try { db.close(); } catch (closeErr) { /* ignore */ }
    throw err;
  }

  function boundIdentity() {
    if (!token) return { ok: false, code: 'AUTH_DENIED' };
    const auth = authenticate(principals, token);
    if (!auth.ok) return { ok: false, code: 'AUTH_DENIED' };
    const principal = auth.principal;
    if (!role) return { ok: false, code: 'ROLE_REQUIRED' };
    if (!Array.isArray(principal.roles) || !principal.roles.includes(role)) {
      return { ok: false, code: 'AUTH_DENIED' };
    }
    return { ok: true, principal };
  }

  function callTool(name, args) {
    const fail = (code, extra) => {
      // Boundary rejections must leave an auditable trace (N-01): record the
      // caller identity when known and a stable result code, never argument values.
      const principal = (extra && extra.principal) || null;
      try {
        audit(db, {
          principal_id: principal ? principal.principal_id : 'unauthenticated',
          project_id: (extra && extra.project_id) || null,
          role_id: role || null,
          action: METHOD_BY_TOOL[name] || String(name),
          target: 'boundary',
          result: String(code),
          reason: 'mcp:stdio'
        });
      } catch (err) { /* audit must never mask the call result */ }
      return { ok: false, code, message: extra && extra.message };
    };
    const id = boundIdentity();
    if (!id.ok) return fail(id.code);
    const principal = id.principal;
    // Persisted fixed-window quota (survives process restarts and reconnects).
    const quota = consumeRateLimit(db, principal.principal_id, MAX_CALLS_PER_MINUTE, 60000);
    if (!quota.allowed) return fail('RATE_LIMITED', { principal });
    const method = METHOD_BY_TOOL[name];
    if (!method) return fail('METHOD_NOT_FOUND', { principal });
    const params = (args && typeof args === 'object') ? args : {};
    const argCheck = validateToolArgs(name, params);
    if (!argCheck.ok) return fail(argCheck.code, { principal, project_id: params.project_id, message: argCheck.detail });
    const project_id = params.project_id;
    if (!project_id) return fail('PROJECT_REQUIRED', { principal });
    if (!Array.isArray(principal.project_ids) || !principal.project_ids.includes(project_id)) {
      return fail('PROJECT_DENIED', { principal, project_id });
    }
    const check = authorize(principal, { project_id, role_id: role, action: METHOD_BY_TOOL[name], routing });
    if (!check.ok) return fail('AUTH_DENIED', { principal, project_id });
    const result = (() => {
      try {
        if (name === 'memory_get') {
          return { ok: true, data: store.get(db, principal, role, project_id, String(params.memory_id)) };
        }
        if (name === 'memory_list') {
          return {
            ok: true,
            data: store.list(db, principal, role, project_id, {
              status: params.status, type: params.type, limit: params.limit
            })
          };
        }
        if (name === 'memory_stats') {
          // F-09/N-08: count only what this caller can read, without store.list's
          // pagination clamp (limit 200). Uses the same canRead predicate as list.
          const rows = db.prepare('SELECT * FROM memories WHERE project_id = ?').all(project_id)
            .map((row) => store.toRecord(row))
            .filter((record) => store.canRead(record, principal, role));
          const by = (status) => rows.filter((r) => r.status === status).length;
          const nowMs = Date.now();
          const aliases = Number((db.prepare('SELECT COUNT(*) AS n FROM aliases WHERE project_id = ?').get(project_id) || {}).n || 0);
          return {
            ok: true,
            data: {
              project_id,
              memories: rows.length,
              approved: by('approved'),
              proposed: by('proposed'),
              rejected: by('rejected'),
              deprecated: by('deprecated'),
              superseded: by('superseded'),
              expired: rows.filter((r) => r.expires_at && Date.parse(r.expires_at) <= nowMs).length,
              aliases,
              scope: 'visible_to_caller',
              note: 'counts are caller-visible records by status; expired rows remain auditable but are excluded from compiled context'
            }
          };
        }
        if (name === 'memory_propose') {
          const input = Object.assign({}, params, { project_id });
          delete input.token;
          delete input.role_id;
          return { ok: true, data: store.propose(db, principal, input, { allowedRoots, routing, assets }) };
        }
        if (name === 'context_compile') {
          if (!routing) return { ok: false, code: 'ROUTING_UNAVAILABLE' };
          const params2 = Object.assign({}, params, { project_id, role_id: role });
          // MCP 调用方常用的 task 结构是 {task_id,title,...}，而 compiler 读 task.id/objective。
          // 在边界层做一次显式规范化，避免 packet 里出现 UNKNOWN 任务。
          if (params.task && typeof params.task === 'object') params2.task = normalizeTask(params.task);
          params2.assets = assets;
          return { ok: true, data: compileContext(db, principal, routing, params2) };
        }
        return { ok: false, code: 'METHOD_NOT_FOUND' };
      } catch (err) {
        // 统一错误码映射（M3/B0）：唯一真相在 errors.js，两个网关共用。
        return { ok: false, code: toPublicCode(err) };
      }
    })();

    // N-02: successful store-backed calls are already audited inside store/compiler;
    // writing a second boundary row would double-count. Keep one boundary row for
    // memory_stats (not audited by store) and for execution errors that were not
    // already recorded by fail().
    try {
      if ((result.ok && name === 'memory_stats') || !result.ok) {
        audit(db, {
          principal_id: principal.principal_id,
          project_id,
          role_id: role,
          action: METHOD_BY_TOOL[name],
          target: name === 'memory_get' ? String(params.memory_id) : 'project',
          result: result.ok ? 'ok' : String(result.code || 'error'),
          reason: 'mcp:stdio'
        });
      }
    } catch (err) { /* audit must never mask the call result */ }
    return result;
  }

  function mcpResponse(id, result) {
    return { jsonrpc: '2.0', id, result };
  }

  function mcpError(id, code, message) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  function handleMessage(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
    }
    const { id, method, params } = msg;
    if (method === 'initialize') {
      return mcpResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
    }
    if (method === 'notifications/initialized') return null;
    if (method === 'ping') return mcpResponse(id, {});
    if (method === 'tools/list') return mcpResponse(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (!METHOD_BY_TOOL[name]) return mcpResponse(id, { content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'METHOD_NOT_FOUND' }) }], isError: true });
      const result = callTool(name, args);
      return mcpResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !result.ok
      });
    }
    return mcpError(id, -32601, 'Method not found');
  }

  return { handleMessage, close() { try { db.close(); } catch (err) { /* ignore */ } } };
}

function serve(options) {
  const gateway = createGateway(options);
  const calls = [];
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    if (Buffer.byteLength(text, 'utf8') > MAX_LINE_BYTES) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'REQUEST_TOO_LARGE' } }) + '\n');
      return;
    }
    let msg;
    try { msg = JSON.parse(text); } catch (err) {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
      return;
    }
    if (msg && msg.method === 'tools/call') {
      const now = Date.now();
      while (calls.length && now - calls[0] > 60000) calls.shift();
      if (calls.length >= MAX_CALLS_PER_MINUTE) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'RATE_LIMITED' }) }], isError: true } }) + '\n');
        return;
      }
      calls.push(now);
    }
    const response = gateway.handleMessage(msg);
    if (response) process.stdout.write(JSON.stringify(response) + '\n');
  });
  rl.on('close', () => gateway.close());
  return gateway;
}

function main() {
  try {
    // 组合根负责路径、配置快照与契约解析；身份来源显式选择「token 文件」适配器。
    const runtime = createRuntime({ identity: createTokenFileIdentity() });
    const paths = runtime.paths;
    const credential = runtime.identity.resolve();
    // token 缺失/不可读**不阻止启动**：每次工具调用返回 AUTH_DENIED。
    // 这是 docs/install.md §9 的对外承诺，重构不得改成启动失败。
    serve({
      dbPath: paths.db,
      principalsPath: paths.principals,
      routingPath: paths.routing,
      allowedRoots: paths.allowedRootsFromEnv || undefined,
      token: credential.ok ? credential.token : null,
      role: credential.role || '',
      assets: runtime.assets,
      auditSinkFactory: runtime.auditSinkFactory
    });
  } catch (err) {
    process.stderr.write('[mars] ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { serve, createGateway, normalizeTask, validateToolArgs, TOOLS, METHOD_BY_TOOL, MAX_LINE_BYTES, MAX_CALLS_PER_MINUTE };

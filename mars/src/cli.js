#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { audit, dbStats } = require('./db');
const { loadPrincipals, authenticate, authorize } = require('./authz');
const store = require('./store');
const { retrieve } = require('./retrieval');
const { compileContext } = require('./compiler');
const { restoreFragment } = require('./manifest');
const sharing = require('./sharing');
const { sha256, writeJsonAtomic } = require('./util');
const { createRuntime } = require('./composition');
const { validate } = require('./validate');


function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

/**
 * 把异常描述成一行可读文本。
 *
 * 规则：
 *   - AppError 自带码，格式为 `CODE 说明`（码在前，便于 grep 与分支）；
 *   - 普通 Error 只出 message，不出栈；
 *   - 加 --debug 时附上栈，供维护者排查（默认不输出，避免把安装路径甩给用户）。
 */
function describeError(err, debug = false) {
  const message = String((err && err.message) || err || 'unknown error');
  const code = err && err.code && /^[A-Z][A-Z0-9_]+$/.test(String(err.code)) ? err.code : null;
  const head = code && !message.startsWith(code) ? `${code} ${message}` : message;
  // 栈只给维护者：rds <命令> --debug。默认不输出，避免把安装路径甩给普通用户。
  // （刻意不读环境变量：入口是分层规则 L4-env 的边界对象，多一个 env 读取就要多一条豁免。）
  if (debug && err && err.stack) return head + '\n' + err.stack;
  return head;
}

/** 运行期错误统一 exit 4（2=用法错误 3=认证失败 4=运行期失败 5=策略拒绝）。 */
function exitCodeFor(err) {
  const n = err && Number(err.exitCode);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

function die(message, code = 2) {
  console.error('ERROR ' + message);
  process.exit(code);
}

// 路径解析、配置快照与身份来源统一由组合根负责（M3 / B2）。
// 本文件不再直接读 process.env，也不再自行拼默认路径。
function loadAuth(runtime) {
  const p = runtime.paths;
  if (!fs.existsSync(p.principals)) die('principals 文件不存在：' + p.principals + '（先运行 init-dev 或复制 config/principals.example.json）');

  const credential = runtime.identity.resolve();
  if (!credential.ok) die('认证失败：' + credential.code, 3);

  const principals = loadPrincipals(p.principals);
  const auth = authenticate(principals, credential.token);
  if (!auth.ok) die('认证失败：' + auth.reason, 3);

  // 角色优先级：命令行 / 身份来源给出的角色 > 该 principal 的第一个角色
  const role = credential.role || auth.principal.roles[0];
  return { ...p, principals, principal: auth.principal, role, routing: runtime.routing };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help') {
    console.log('用法: rds <init|init-dev|put|get|list|search|review|alias|compile|fragment|stats|audit|ledger|mcp|project|share> [选项]');
    console.log('（rds 为统一入口；也可直接运行 node mars/src/cli.js）');
    process.exit(0);
  }
  // M4 / B5：顶层异常出口覆盖**所有**子命令。
  // 此前 try 从第 176 行才开始，init / init-dev / ledger 等路径上的异常
  // 会以「Node 栈 + 安装绝对路径」的形式直接甩给用户。
  try {
    return run(args);
  } catch (err) {
    die(describeError(err, args.debug === true || args.debug === '1'), exitCodeFor(err));
  }
}

// 与 dispatch 分支保持一致；新增子命令时必须同步这里（有测试守着）。
const KNOWN_COMMANDS = new Set([
  'init', 'init-dev', 'put', 'get', 'list', 'search', 'review', 'alias',
  'compile', 'fragment', 'stats', 'audit', 'ledger', 'mcp', 'project',
  'share', 'orchestrate', 'help'
]);

function run(args) {
  const cmd = args._[0];
  // 组合根：路径、契约、配置快照与身份来源的唯一出处。
  // fail-fast —— 发行包缺 contracts 或路由配置非法时，在这里就失败，而不是等某次 put。
  // M4 / B5：先认命令，再谈身份。
  // 此前未知命令会先走 loadAuth，于是 `rds typo` 报的是「认证失败：TOKEN_MISSING」——
  // 一个拼写错误被诊断成凭证问题，是最容易误导人的一类错误。
  if (!KNOWN_COMMANDS.has(cmd)) {
    die('未知命令: ' + cmd + '（rds --help 查看命令）', 2);
  }

  const runtime = createRuntime({ argv: args });
  const p = runtime.paths;
  const assets = runtime.assets;
  const allowedRoots = runtime.allowedRoots;

  if (cmd === 'init') {
    const db = runtime.openDb(p.db);
    console.log(JSON.stringify({ db: p.db, stats: dbStats(db) }, null, 2));
    return;
  }

  if (cmd === 'init-dev') {
    const token = crypto.randomBytes(24).toString('hex');
    const out = path.resolve(args.out || p.principals);
    const value = {
      version: '0.1.0',
      principals: [{
        token_sha256: sha256(token),
        principal_id: args.principal || 'dev-r0',
        project_ids: (args.projects || 'demo').split(','),
        roles: (args.roles || 'R0').split(','),
        note: 'dev 本地身份；token 仅在创建时显示一次'
      }]
    };
    writeJsonAtomic(out, value);
    console.log('已创建 ' + out);
    console.log('DEV_TOKEN=' + token);
    console.log('提示：token 仅在本机命令中使用，不写入仓库；如泄漏删除该文件并重建。');
    return;
  }

  if (cmd === 'stats') {
    const auth = loadAuth(runtime);
    const project_id = args.project;
    if (!project_id) die('stats 需要 --project（并提供 --token，服务端鉴权）', 2);
    const role_id = args.role || auth.principal.roles[0];
    const a = authorize(auth.principal, { project_id, role_id, action: 'memory.stats', routing: auth.routing });
    if (!a.ok) die('无权访问该项目统计：' + a.reason, 3);
    const db = runtime.openDb(auth.db);
    audit(db, { principal_id: auth.principal.principal_id, project_id, role_id, action: 'memory.stats', target: 'cli', result: 'ok' });
    console.log(JSON.stringify(dbStats(db, project_id), null, 2));
    return;
  }

  if (cmd === 'ledger') {
    const ledger = require('./ledger');
    if (args.help) {
      console.log('用法: rds ledger --session <文件> [--source <kind>] [--out <目录>] [--project <id>]');
      console.log('');
      console.log('  --session  会话文件（.jsonl 或 .jsonl.zstd）');
      console.log('  --source   数据源 kind；省略时按内容嗅探。已注册来源见 rds ledger 报错信息');
      console.log('  --out      写出 ledger.json / ledger.csv 到该目录；省略则打印到 stdout');
      console.log('');
      console.log('只读：不会创建数据库；库已存在时写一条 audit（principal 记为 local）。');
      return;
    }
    if (!args.session) die('ledger 需要 --session <文件>（--help 查看用法）', 2);
    const sessionFile = path.resolve(String(args.session));
    // 先检查文件，再做任何有副作用的事（B3 之前是先建库、后报「文件不存在」）。
    if (!fs.existsSync(sessionFile)) die('会话文件不存在: ' + sessionFile + '（相对路径按当前目录解析）');

    let parsed;
    try {
      const bytes = fs.readFileSync(sessionFile);
      const sourceKind = typeof args.source === 'string' ? args.source : undefined;
      const source = runtime.sessions.resolve({ kind: sourceKind, bytes });
      parsed = source.parse({ bytes, ref: sessionFile });
    } catch (err) {
      die(err.message, 4);
    }

    // M4 / B1：契约要有执行点。单文件模式输出的是 sessions[] 的单项，
    // 因此按 ledger.schema.json 里 sessions.items 的定义校验；
    // 聚合输出（buildLedger）由契约测试单独校验。
    const ledgerContract = assets.contract('ledger');
    const ledgerSchema = ledgerContract && ledgerContract.value;
    const sessionSchema = ledgerSchema && ledgerSchema.properties &&
      ledgerSchema.properties.sessions && ledgerSchema.properties.sessions.items;
    if (sessionSchema) {
      const check = validate(parsed, sessionSchema);
      if (!check.valid) {
        const head = check.errors.slice(0, 3).map(e => `${e.path}: ${e.message}`).join('; ');
        die('LEDGER_CONTRACT_INVALID ' + head, 4);
      }
    }

    if (args.out) {
      const outDir = path.resolve(args.out);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'ledger.json'), JSON.stringify(parsed, null, 2));
      if (typeof ledger.toCsv === 'function') fs.writeFileSync(path.join(outDir, 'ledger.csv'), ledger.toCsv(parsed));
      console.log('已写出 ' + outDir);
    } else console.log(JSON.stringify(parsed, null, 2));

    // 只读动作不创建数据库：库不存在就跳过审计，而不是顺手建一个空的（M3 / B3）。
    // M3 / B2：本地未认证调用不得伪装成已认证主体 —— 'local' 是哨兵，不是 principal。
    if (fs.existsSync(p.db)) {
      const db = runtime.openDb(p.db);
      try {
        audit(db, { principal_id: 'local', project_id: args.project || '-', role_id: args.role || null, action: 'ledger.parse', target: path.basename(sessionFile), result: 'ok' });
      } finally {
        db.close();
      }
    }
    return;
  }

  if (cmd === 'mcp') {
    let mcp;
    try { mcp = require('./mcp'); } catch (err) { die('mcp 模块不可用（R2 实现）：' + err.message); }
    if (!args.enable) {
      die('MCP 网关默认禁用（Phase 1 安全要求）。确认身份链路可用后加 --enable 显式启动；本仓库未注册 DSH MCP。', 5);
    }
    mcp.start({ dbPath: p.db, principalsPath: p.principals, allowedRoots, assets });
    return;
  }

  const auth = loadAuth(runtime);
  const db = runtime.openDb(p.db);
  const role = auth.role;

  {
    if (cmd === 'put') {
      const r = store.propose(db, auth.principal, {
        project_id: args.project, memory_type: args.type || 'L2', content: args.content,
        source_ref: args.source, source_version: args.version, role_id: role,
        confidence: args.confidence !== undefined ? Number(args.confidence) : undefined,
        visibility: args.visibility || 'project',
        tags: args.tags ? String(args.tags).split(',') : [],
        evidence_refs: args.evidence ? String(args.evidence).split(',') : []
      }, { allowedRoots, routing: auth.routing, assets });
      console.log(JSON.stringify(r));
      return;
    }
    if (cmd === 'get') {
      const r = store.get(db, auth.principal, role, args.project, args.memory);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (cmd === 'list') {
      const r = store.list(db, auth.principal, role, args.project, { status: args.status, type: args.type, limit: args.limit });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (cmd === 'search') {
      const r = retrieve(db, auth.principal, role, auth.routing, { project_id: args.project, query: args.query, type: args.type, alias: args.alias, limit: args.limit, shared: args.shared !== 'false' });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (cmd === 'review') {
      const r = store.review(db, auth.principal, role, args.project, args.memory, args.decision, args.note);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (cmd === 'alias') {
      store.addAlias(db, auth.principal, role, args.project, args.term, args.alias, args.memory);
      console.log('OK');
      return;
    }
    if (cmd === 'fragment') {
      const r = restoreFragment(db, auth.principal, role, args.project, args.fragment, auth.routing);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    if (cmd === 'compile') {
      const task = args.task ? (fs.existsSync(args.task) && args.task.endsWith('.json')
        ? JSON.parse(fs.readFileSync(path.resolve(args.task), 'utf8').replace(/^\uFEFF/, ''))
        : { id: args.task, objective: args.objective || '', acceptance: args.acceptance ? String(args.acceptance).split('|') : [] }) : { id: 'T-UNKNOWN' };
      const evidence = args.evidence ? String(args.evidence).split(',').map(ref => ({ ref, kind: 'file' })) : [];
      const result = compileContext(db, auth.principal, auth.routing, {
        project_id: args.project, task_id: task.id, role_id: role,
        budget: args.budget ? Number(args.budget) : undefined,
        query: args.query, state: args.state, task, evidence,
        assets
      });
      if (args.out) {
        const out = path.resolve(args.out);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, JSON.stringify({ packet: result.packet, manifest: result.manifest, budget: result.budget }, null, 2));
        console.log('已写出 ' + out + ' tokens=' + result.packet.tokens_estimated + '/' + result.packet.token_budget);
      } else {
        console.log(JSON.stringify(result.packet, null, 2));
      }
      return;
    }
    if (cmd === 'project') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const role = auth.role;
      if (!auth.principal.roles.includes(role)) die('角色未授权：' + role, 3);
      const sub = args._[1];
      if (sub === 'register') {
        const r = sharing.registerProject(db, auth.principal, role, { project_id: args.project, display_name: args.name, share_policy: args.policy });
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      if (sub === 'list') {
        console.log(JSON.stringify(sharing.listProjects(db), null, 2));
        return;
      }
      die('未知 project 子命令: ' + sub);
    }
    if (cmd === 'share') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const role = auth.role;
      if (!auth.principal.roles.includes(role)) die('角色未授权：' + role, 3);
      const sub = args._[1];
      if (sub === 'create') {
        const r = sharing.createShare(db, auth.principal, role, {
          source_project: args.project, target_project: args.target,
          memory_ids: args.memory ? String(args.memory).split(',').filter(Boolean) : [],
          memory_types: args.types ? String(args.types).split(',').filter(Boolean) : [],
          roles: args.roles ? String(args.roles).split(',').filter(Boolean) : [],
          expires_at: args.expires || null, note: args.note
        });
        console.log(JSON.stringify(r, null, 2));
        return;
      }
      if (sub === 'approve') {
        console.log(JSON.stringify(sharing.approveShare(db, auth.principal, role, args.share), null, 2));
        return;
      }
      if (sub === 'revoke') {
        console.log(JSON.stringify(sharing.revokeShare(db, auth.principal, role, args.share, args.note), null, 2));
        return;
      }
      if (sub === 'list') {
        console.log(JSON.stringify(sharing.listShares(db, args.project), null, 2));
        return;
      }
      die('未知 share 子命令: ' + sub);
    }
    if (cmd === 'orchestrate') {
      const orch = require('./orchestrator');
      const db = runtime.openDb(p.db);
      const allowed = db.prepare('SELECT project_id FROM projects ORDER BY project_id').all().map((r) => r.project_id);
      const sub = args._[1];
      if (sub === 'plan') {
        const plan = orch.plan({
          project_id: args.project, task_id: args.task, objective: args.objective,
          description: args.description,
          budget: args.tokens ? { task_tokens: Number(args.tokens) } : undefined
        }, { allowed_projects: allowed });
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      if (sub === 'start') {
        const plan = orch.plan({
          project_id: args.project, task_id: args.task, objective: args.objective,
          description: args.description
        }, { allowed_projects: allowed });
        const run = orch.startRun(db, plan, { principal_id: args.by || 'cli' });
        console.log(JSON.stringify(run, null, 2));
        return;
      }
      if (sub === 'approve') {
        console.log(JSON.stringify(orch.approveRun(db, args.run, { approver: args.by || 'cli', reason: args.reason }), null, 2));
        return;
      }
      if (sub === 'feedback') {
        console.log(JSON.stringify(orch.recordFeedback(db, args.run, {
          tokens_total: Number(args.tokens) || 0,
          quality_score: args.quality != null ? Number(args.quality) : undefined,
          rework_count: args.rework != null ? Number(args.rework) : undefined
        }), null, 2));
        return;
      }
      if (sub === 'status') {
        console.log(JSON.stringify(orch.budgetStatus(db, args.run), null, 2));
        return;
      }
      if (sub === 'suggest') {
        console.log(JSON.stringify(orch.suggest(db, { project_id: args.project }), null, 2));
        return;
      }
      die('未知 orchestrate 子命令: ' + sub);
    }
    if (cmd === 'audit') {
      const rows = db.prepare('SELECT * FROM audit ORDER BY audit_id DESC LIMIT ?').all(Math.min(500, Number(args.limit) || 50));
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    die('未知命令: ' + cmd);
  }
}

if (require.main === module) main();
module.exports = { parseArgs };

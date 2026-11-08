#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb, audit, dbStats } = require('./db');
const { loadPrincipals, loadRouting, authenticate, authorize } = require('./authz');
const store = require('./store');
const { retrieve } = require('./retrieval');
const { compileContext } = require('./compiler');
const { restoreFragment } = require('./manifest');
const sharing = require('./sharing');
const { sha256, writeJsonAtomic } = require('./util');

const ROOT = path.resolve(__dirname, '..');

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

function die(message, code = 2) {
  console.error('ERROR ' + message);
  process.exit(code);
}

function paths(args) {
  // 优先级：命令行参数 > 环境变量 > 仓库内默认值。
  // 环境变量名与 mcp-stdio.js 保持一致，避免"CLI 一套、服务端另一套"。
  return {
    db: path.resolve(args.db || process.env.MARS_DB || path.join(ROOT, 'var', 'mars.db')),
    principals: path.resolve(args.principals || process.env.MARS_PRINCIPALS || path.join(ROOT, 'config', 'principals.json')),
    routing: path.resolve(args.routing || process.env.MARS_ROUTING || path.join(ROOT, 'config', 'role-routing.json'))
  };
}

function allowedRoots() {
  const env = process.env.MARS_ALLOWED_ROOTS;
  if (env) return env.split(';').filter(Boolean);
  return [path.resolve(ROOT, '..')];
}

function loadAuth(args) {
  const p = paths(args);
  if (!fs.existsSync(p.principals)) die('principals 文件不存在：' + p.principals + '（先运行 init-dev 或复制 config/principals.example.json）');
  const principals = loadPrincipals(p.principals);
  const auth = authenticate(principals, args.token || process.env.MARS_TOKEN);
  if (!auth.ok) die('认证失败：' + auth.reason, 3);
  const routing = loadRouting(p.routing);
  return { ...p, principals, principal: auth.principal, routing };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help') {
    console.log('用法: rds <init|init-dev|put|get|list|search|review|alias|compile|fragment|stats|audit|ledger|mcp|project|share> [选项]');
    console.log('（rds 为统一入口；也可直接运行 node mars/src/cli.js）');
    process.exit(0);
  }
  const p = paths(args);

  if (cmd === 'init') {
    const db = openDb(p.db);
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
    const auth = loadAuth(args);
    const project_id = args.project;
    if (!project_id) die('stats 需要 --project（并提供 --token，服务端鉴权）', 2);
    const role_id = args.role || auth.principal.roles[0];
    const a = authorize(auth.principal, { project_id, role_id, action: 'memory.stats', routing: auth.routing });
    if (!a.ok) die('无权访问该项目统计：' + a.reason, 3);
    const db = openDb(auth.db);
    audit(db, { principal_id: auth.principal.principal_id, project_id, role_id, action: 'memory.stats', target: 'cli', result: 'ok' });
    console.log(JSON.stringify(dbStats(db, project_id), null, 2));
    return;
  }

  if (cmd === 'ledger') {
    let ledger;
    try { ledger = require('./ledger'); } catch (err) { die('ledger 模块不可用（R2 实现）：' + err.message); }
    const db = openDb(p.db);
    if (!fs.existsSync(args.session)) die('会话文件不存在: ' + args.session);
    const parsed = ledger.parseSession(args.session);
    if (args.out) {
      const outDir = path.resolve(args.out);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'ledger.json'), JSON.stringify(parsed, null, 2));
      if (typeof ledger.toCsv === 'function') fs.writeFileSync(path.join(outDir, 'ledger.csv'), ledger.toCsv(parsed));
      console.log('已写出 ' + outDir);
    } else console.log(JSON.stringify(parsed, null, 2));
    audit(db, { principal_id: 'cli', project_id: args.project || '-', role_id: args.role || null, action: 'ledger.read', target: path.basename(args.session), result: 'ok' });
    return;
  }

  if (cmd === 'mcp') {
    let mcp;
    try { mcp = require('./mcp'); } catch (err) { die('mcp 模块不可用（R2 实现）：' + err.message); }
    if (!args.enable) {
      die('MCP 网关默认禁用（Phase 1 安全要求）。确认身份链路可用后加 --enable 显式启动；本仓库未注册 DSH MCP。', 5);
    }
    mcp.start({ dbPath: p.db, principalsPath: p.principals, allowedRoots: allowedRoots() });
    return;
  }

  const auth = loadAuth(args);
  const db = openDb(p.db);
  const role = args.role || auth.principal.roles[0];

  try {
    if (cmd === 'put') {
      const r = store.propose(db, auth.principal, {
        project_id: args.project, memory_type: args.type || 'L2', content: args.content,
        source_ref: args.source, source_version: args.version, role_id: role,
        confidence: args.confidence !== undefined ? Number(args.confidence) : undefined,
        visibility: args.visibility || 'project',
        tags: args.tags ? String(args.tags).split(',') : [],
        evidence_refs: args.evidence ? String(args.evidence).split(',') : []
      }, { allowedRoots: allowedRoots(), routing: auth.routing });
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
        query: args.query, state: args.state, task, evidence
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
      const auth = loadAuth(args);
      const db = openDb(auth.db);
      const role = args.role || auth.principal.roles[0];
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
      const auth = loadAuth(args);
      const db = openDb(auth.db);
      const role = args.role || auth.principal.roles[0];
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
      const db = openDb(path.resolve(process.env.MARS_DB || path.join(__dirname, '..', 'var', 'mars.db')));
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
  } catch (err) {
    die(err.message, 4);
  }
}

if (require.main === module) main();
module.exports = { parseArgs };

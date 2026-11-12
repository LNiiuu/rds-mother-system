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
const { renderPacketMarkdown } = require('./render-md');
const projects = require('./projects');
const contextOps = require('./context-ops');
const contextBudget = require('./context-budget');
const collab = require('./collab');
const { restoreFragment } = require('./manifest');
const sharing = require('./sharing');
const { sha256, writeJsonAtomic } = require('./util');
const { createRuntime } = require('./composition');
const { validate } = require('./validate');
const { USAGE, render: renderHelp } = require('./cli-help');


function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // M5 / B3：-h 与 --help 等价。此前只有 --help 被识别，-h 会掉进位置参数。
    if (a === '-h') { out.help = true; continue; }
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
  'share', 'orchestrate', 'help',
  'budget', 'context', 'role', 'task', 'handoff', 'cost',
  // M12 执行层
  'agent', 'run', 'trace', 'usage',
  // M13 治理
  'lock', 'policy',
  // M14 REA
  'rea'
]);

function run(args) {
  const cmd = args._[0];

  // M5 / B3：帮助必须先于一切副作用与身份检查，否则同一个 flag 在不同命令上
  // 会变成三件不同的事。修复前的实测行为：
  //   rds init --help       → 创建数据库并输出 stats
  //   rds init-dev --help   → 生成身份并**整个覆盖** principals.json
  //   rds put --help        → ERROR 认证失败：TOKEN_MISSING（exit 3）
  //   rds mcp --help        → ERROR MCP 网关默认禁用（exit 5）
  // 现在统一：打印用法、退出码 0、不碰任何文件。
  if (!cmd) { console.log(USAGE); return; }
  if (cmd === 'help') {
    // rds help --help 应当是「help 命令自己的说明」；rds help 才是顶层用法。
    if (args.help) { console.log(renderHelp('help')); return; }
    const topic = args._[1];
    if (!topic) { console.log(USAGE); return; }
    const text = renderHelp(String(topic));
    if (text) { console.log(text); return; }
    die('未知命令: ' + topic + '（rds --help 查看命令）', 2);
  }
  if (args.help) {
    const text = renderHelp(cmd);
    if (text) { console.log(text); return; }
    die('未知命令: ' + cmd + '（rds --help 查看命令）', 2);
  }

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
    const out = path.resolve(args.out || p.principals);
    const add = args.add === true || args.add === '1';
    const replace = args.replace === true || args.replace === '1';

    // M8 / B1 数据安全：此前这里无条件 writeJsonAtomic，重复执行会把整个身份文件
    // 换成「只有新 principal」的一份，既有 token 立即失效（M7-0 实测 6 → 1）。
    // 现在的规则：
    //   目标不存在 / principals 为空  → 创建（没有可丢的数据）
    //   已有身份                      → 默认拒绝；--add 追加；--replace 显式重建
    //   已存在但不是合法身份文档      → 默认拒绝；--replace 显式重建（不静默吞掉坏文件）
    let document = { version: '0.1.0', principals: [] };
    let existed = 0;
    if (fs.existsSync(out)) {
      let raw = null;
      let readable = true;
      try {
        raw = JSON.parse(fs.readFileSync(out, 'utf8').replace(/^\uFEFF/, ''));
      } catch (err) {
        readable = false;
      }
      if (!readable || !raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.principals)) {
        if (!replace) {
          die(`拒绝覆盖身份文件（IDENTITY_EXISTS）：${out} 不是合法的 principals 文档。确认重建请加 --replace`, 1);
        }
      } else {
        existed = raw.principals.length;
        if (existed > 0 && !add && !replace) {
          die(`拒绝覆盖身份文件（IDENTITY_EXISTS）：${out} 已有 ${existed} 个身份。追加请加 --add，重建请加 --replace`, 1);
        }
        if (!replace) document = { ...raw, principals: raw.principals.slice() };
      }
    }

    const principal_id = args.principal || 'dev-r0';
    if (!/^[A-Za-z0-9._-]+$/.test(principal_id)) {
      die('principal_id 只允许字母、数字与 . _ -', 2);
    }
    if (document.principals.some((item) => item && item.principal_id === principal_id)) {
      die(`身份已存在（IDENTITY_EXISTS）：${principal_id}。换一个 --principal，或先手动删除该条`, 1);
    }

    const token = crypto.randomBytes(24).toString('hex');
    document.version = document.version || '0.1.0';
    document.principals.push({
      token_sha256: sha256(token),
      principal_id,
      project_ids: (args.projects || 'demo').split(','),
      roles: (args.roles || 'R0').split(','),
      note: 'dev 本地身份；token 仅在创建时显示一次'
    });
    writeJsonAtomic(out, document);
    console.log(`已${existed > 0 ? '追加到' : '写入'} ${out}（共 ${document.principals.length} 个身份）`);
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
    // --help 已在 run() 开头统一处理（M5 / B3），此处不再重复一份文本。
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

  // ---------- M12 执行层：agent / run / trace / usage ----------
  // 文件型参数（--mock-file / --packet / --task-file / --workspace）在这里读成内存对象，
  // 因为 cli.js 是入口、允许碰 fs；cli-agent.js 是域逻辑，不碰。
  if (cmd === 'agent' || cmd === 'run' || cmd === 'trace' || cmd === 'usage'
    || cmd === 'lock' || cmd === 'policy' || cmd === 'rea') {
    const cliAgent = require('./cli-agent');
    const sub = args._[1];
    const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(String(file)), 'utf8').replace(/^\uFEFF/, ''));
    if (args['mock-file']) args.mockScript = readJson(args['mock-file']);
    if (args.packet) args.packet = readJson(args.packet);
    if (args['task-file']) args.taskText = fs.readFileSync(path.resolve(String(args['task-file'])), 'utf8');
    if (args.workspace) args.workspaceRoot = path.resolve(String(args.workspace));

    const compilePacket = (input) => compileContext(db, auth.principal, auth.routing, {
      project_id: input.project_id,
      task_id: input.task_id || 'T-UNKNOWN',
      role_id: input.role_id,
      budget: input.budget,
      task: input.task,
      objective: input.objective,
      assets
    }).packet;

    const ctx = { db, args, runtime, auth, compilePacket };

    if (cmd === 'agent') {
      if (sub === 'create') { cliAgent.agentCreate(ctx); return; }
      if (sub === 'list') { cliAgent.agentList(ctx); return; }
      if (sub === 'show') { cliAgent.agentShow(ctx); return; }
      if (sub === 'stop') { cliAgent.agentStop(ctx); return; }
      if (sub === 'start') { return cliAgent.agentStart(ctx).catch((e) => die(describeError(e, args.debug === true), exitCodeFor(e))); }
      if (sub === 'status') { cliAgent.agentStatus(ctx); return; }
      if (sub === 'cancel') { cliAgent.agentCancel(ctx); return; }
      if (sub === 'chain') { return cliAgent.agentChain(ctx).catch((e) => die(describeError(e, args.debug === true), exitCodeFor(e))); }
      if (sub === 'reap') { cliAgent.agentReap(ctx); return; }
      if (sub === 'providers') { cliAgent.agentProviders(ctx); return; }
      die('agent 子命令: create | list | show | start | status | cancel | stop（--help 查看）', 2);
    }
    if (cmd === 'run') {
      if (sub === 'list') { cliAgent.runList(ctx); return; }
      if (sub === 'inspect') { cliAgent.runInspect(ctx); return; }
      die('run 子命令: list | inspect', 2);
    }
    if (cmd === 'trace') {
      if (sub === 'inspect') { cliAgent.traceInspect(ctx); return; }
      die('trace 子命令: inspect', 2);
    }
    if (cmd === 'usage') {
      if (sub === 'show' || sub === undefined) { cliAgent.usageShow(ctx); return; }
      die('usage 子命令: show', 2);
    }
    if (cmd === 'lock') {
      if (sub === 'list') { cliAgent.lockList(ctx); return; }
      die('lock 子命令: list', 2);
    }
    if (cmd === 'rea') {
      const cliRea = require('./cli-rea');
      const reaCtx = { db, args, runtime, auth, reaEvidenceBase: path.join(path.dirname(p.db), 'rea') };
      if (sub === 'list') { return cliRea.reaList(reaCtx); }
      if (sub === 'status') { return cliRea.reaStatus(reaCtx); }
      if (sub === 'preflight') { return cliRea.reaPreflight(reaCtx).catch((e) => die(describeError(e, args.debug === true), exitCodeFor(e))); }
      if (sub === 'run') { return cliRea.reaRun(reaCtx).catch((e) => die(describeError(e, args.debug === true), exitCodeFor(e))); }
      if (sub === 'inspect') { cliRea.reaInspect(reaCtx); return; }
      if (sub === 'runs') { cliRea.reaRuns(reaCtx); return; }
      die('rea 子命令: list | status | preflight | run | inspect | runs', 2);
    }
    if (cmd === 'policy') {
      if (sub === 'list') { cliAgent.policyList(); return; }
      if (sub === 'check') { cliAgent.policyCheck(ctx); return; }
      die('policy 子命令: list | check', 2);
    }
  }

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
      // M8 / B2：--task-file 把任务正文带进包里；--task 仍兼容（ID 或 JSON 文件）。
      let task;
      const taskFile = args['task-file'] ? path.resolve(String(args['task-file'])) : null;
      if (taskFile) {
        if (!fs.existsSync(taskFile)) die('任务文件不存在: ' + taskFile + '（--task-file 指向 md/txt）', 2);
        task = {
          id: args.task || 'T-UNKNOWN',
          objective: args.objective || '',
          text: fs.readFileSync(taskFile, 'utf8'),
          acceptance: args.acceptance ? String(args.acceptance).split('|') : []
        };
      } else if (args.task) {
        task = fs.existsSync(args.task) && args.task.endsWith('.json')
          ? JSON.parse(fs.readFileSync(path.resolve(args.task), 'utf8').replace(/^\uFEFF/, ''))
          : { id: args.task, objective: args.objective || '', acceptance: args.acceptance ? String(args.acceptance).split('|') : [] };
      } else {
        task = { id: 'T-UNKNOWN' };
      }
      const format = args.format || 'json';
      if (format !== 'json' && format !== 'md') die('--format 只支持 json 或 md', 2);
      const evidence = args.evidence ? String(args.evidence).split(',').map(ref => ({ ref, kind: 'file' })) : [];
      const result = compileContext(db, auth.principal, auth.routing, {
        project_id: args.project, task_id: task.id, role_id: role,
        budget: args.budget ? Number(args.budget) : undefined,
        query: args.query, state: args.state, task, evidence,
        model: args.model, agent_id: args.agent,
        autoCompress: args['auto-compress'] === true,
        assets
      });
      if (result.compression) {
        const c = result.compression;
        if (c.validation_status === 'VALID') {
          process.stderr.write(`WARN 已自动压缩：${c.before_tokens} -> ${c.after_tokens} tokens（${c.compression_id}）\n`);
        } else {
          process.stderr.write(`WARN 压缩未生效：${c.validation_status}（保持原文 ${c.before_tokens} tokens）\n`);
        }
      }
      // M8 / B2：budget 只留摘要。此前这里把 budget.sections（与 packet.sections 同内容）
      // 再序列化一遍，是文件体积翻倍的主因之一。需要分节内容请看 packet.sections。
      const budgetSummary = {
        tokens: result.budget.tokens,
        truncated: result.budget.truncated,
        protected_kept: result.budget.protected_kept,
        over_budget: result.budget.over_budget
      };
      if (format === 'md') {
        const body = renderPacketMarkdown(result.packet);
        if (args.out) {
          const out = path.resolve(args.out);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, body);
          console.log('已写出 ' + out + ' format=md tokens=' + result.packet.tokens_estimated + '/' + result.packet.token_budget + ' bytes=' + Buffer.byteLength(body));
        } else {
          process.stdout.write(body.endsWith('\n') ? body : body + '\n');
        }
        return;
      }
      if (args.out) {
        const out = path.resolve(args.out);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const bundle = args['no-manifest'] === true
          ? { packet: result.packet, budget: budgetSummary }
          : { packet: result.packet, manifest: result.manifest, budget: budgetSummary };
        fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
        console.log('已写出 ' + out + ' format=json tokens=' + result.packet.tokens_estimated + '/' + result.packet.token_budget);
      } else {
        console.log(JSON.stringify(result.packet, null, 2));
      }
      return;
    }
    if (cmd === 'project') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const role = auth.role;
      const sub = args._[1];
      try {
        // 兼容：老的 register 不带 --root，仍走 sharing（只有名字与共享策略）
        const projectRoot = args['project-root'];
        if (sub === 'register' && !projectRoot) {
          const r = sharing.registerProject(db, auth.principal, role, { project_id: args.project, display_name: args.name, share_policy: args.policy });
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'create' || sub === 'register') {
          collab.assertPermission(role, 'project.create');
          const config = args.config ? JSON.parse(String(args.config)) : {};
          const r = projects.create(db, auth.principal, {
            project_id: args.project, name: args.name, root: projectRoot,
            policy: args.policy || 'deny', config
          }, { resolveRoot: runtime.projectRoots.resolveRoot });
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'list') {
          const rows = projects.list(db, { includeRemoved: args.all === true });
          if (rows.length) { console.log(JSON.stringify(rows, null, 2)); return; }
          console.log(JSON.stringify(sharing.listProjects(db), null, 2));
          return;
        }
        if (sub === 'show') {
          const row = projects.show(db, args.project);
          if (!row) die('项目不存在：' + args.project, 2);
          console.log(JSON.stringify(row, null, 2));
          return;
        }
        if (sub === 'use') {
          const row = projects.show(db, args.project);
          if (!row) die('项目不存在：' + args.project, 2);
          if (row.status === 'removed') die('项目已移除：' + args.project, 2);
          const pointer = runtime.projectRoots.writeCurrent(auth.db, args.project);
          console.log(JSON.stringify({ project_id: args.project, pointer }, null, 2));
          return;
        }
        if (sub === 'current') {
          console.log(JSON.stringify({ project_id: runtime.projectRoots.readCurrent(auth.db) }, null, 2));
          return;
        }
        if (sub === 'remove') {
          collab.assertPermission(role, 'project.remove');
          console.log(JSON.stringify(projects.remove(db, args.project, args.confirm), null, 2));
          return;
        }
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
      die('未知 project 子命令: ' + sub);
    }
    if (cmd === 'budget') {
      const sub = args._[1] || 'show';
      try {
        if (sub === 'models') {
          console.log(JSON.stringify(contextBudget.listModels(), null, 2));
          return;
        }
        const override = args['context-window'] ? { context_window: Number(args['context-window']) } : undefined;
        const r = contextBudget.compute({
          model: args.model,
          estimatedInputTokens: args.tokens ? Number(args.tokens) : 0,
          override,
        });
        console.log(JSON.stringify(r, null, 2));
        return;
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
    }
    if (cmd === 'context') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const sub = args._[1] || 'list';
      try {
        if (sub === 'list') {
          console.log(JSON.stringify(contextOps.listRuns(db, { project_id: args.project, limit: args.limit ? Number(args.limit) : 20 }), null, 2));
          return;
        }
        if (sub === 'show') {
          if (!args.run) die('context show 需要 --run <id>', 2);
          console.log(JSON.stringify(contextOps.getRun(db, args.run), null, 2));
          return;
        }
        if (sub === 'restore') {
          if (!args.compression) die('context restore 需要 --compression <id>', 2);
          console.log(JSON.stringify(contextOps.restore(db, args.compression), null, 2));
          return;
        }
        if (sub === 'analyze' || sub === 'compress') {
          if (!args.file) die(`context ${sub} 需要 --file <packet.json>`, 2);
          const doc = JSON.parse(fs.readFileSync(path.resolve(String(args.file)), 'utf8'));
          const packet = doc.packet || doc;
          if (sub === 'analyze') {
            console.log(JSON.stringify(contextOps.analyze(packet.sections || []), null, 2));
            return;
          }
          const result = contextOps.compress(packet.sections || [], { archive: args.archive === true });
          if (args.out) {
            const next = { ...packet, sections: contextOps.apply(result).map(({ archived, ...rest }) => rest), tokens_estimated: result.validationStatus === 'VALID' ? result.afterTokens : result.beforeTokens };
            const out = path.resolve(String(args.out));
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, JSON.stringify(next, null, 2));
          }
          console.log(JSON.stringify({
            compression_id: result.compressionId,
            validation_status: result.validationStatus,
            l0_preserved: result.l0Preserved,
            before_tokens: result.beforeTokens,
            after_tokens: result.afterTokens,
            actions: result.actions,
          }, null, 2));
          return;
        }
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
      die('未知 context 子命令: ' + sub);
    }
    if (cmd === 'role') {
      const sub = args._[1] || 'list';
      try {
        if (sub === 'list') {
          console.log(JSON.stringify(collab.listRoles(), null, 2));
          return;
        }
        if (sub === 'show') {
          if (!args.role) die('role show 需要 --role <R0-R7>', 2);
          console.log(JSON.stringify(collab.role(String(args.role)), null, 2));
          return;
        }
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
      die('未知 role 子命令: ' + sub);
    }
    if (cmd === 'task') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const role = auth.role;
      const actor = auth.principal.principal_id;
      const sub = args._[1];
      try {
        if (sub === 'plan') {
          collab.assertPermission(role, 'task.plan');
          const objective = args.objective || args._[2];
          if (!objective) die('task plan 需要 --objective <文本>', 2);
          // M15：给了 --type 就走类型规则（可预测），没给才用关键词拆分（启发式）
          if (args.type) {
            const taskTypes = require('./runtime/task-types');
            console.log(JSON.stringify(taskTypes.planByType(db, {
              project_id: args.project, task_type: String(args.type), objective, actor
            }), null, 2));
            return;
          }
          const r = collab.planTasks(db, { project_id: args.project, objective, role: args['to-role'], actor });
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'types') {
          console.log(JSON.stringify({ task_types: require('./runtime/task-types').list() }, null, 2));
          return;
        }
        if (sub === 'create') {
          collab.assertPermission(role, 'task.create');
          if (!args.title) die('task create 需要 --title', 2);
          const r = collab.createTask(db, {
            project_id: args.project, title: args.title, description: args.description,
            acceptance_criteria: args.acceptance, assigned_role: args['to-role'] ? String(args['to-role']) : null,
            actor,
          });
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'list') {
          console.log(JSON.stringify(collab.listTasks(db, { project_id: args.project, status: args.status, limit: args.limit ? Number(args.limit) : 50 }), null, 2));
          return;
        }
        if (sub === 'show' || sub === 'events') {
          if (!args.task) die(`task ${sub} 需要 --task <id>`, 2);
          const task = collab.getTask(db, String(args.task));
          if (!task) die('任务不存在：' + args.task, 2);
          if (sub === 'show') console.log(JSON.stringify({ ...task, events: collab.events(db, task.task_id) }, null, 2));
          else console.log(JSON.stringify(collab.events(db, task.task_id), null, 2));
          return;
        }
        if (!args.task) die(`task ${sub} 需要 --task <id>`, 2);
        const taskId = String(args.task);
        if (sub === 'assign') {
          collab.assertPermission(role, 'task.assign');
          if (!args['to-role']) die('task assign 需要 --to-role <R0-R7>（--role 是当前执行角色）', 2);
          console.log(JSON.stringify(collab.assign(db, taskId, { role: String(args['to-role']), agent: args.agent, actor }), null, 2));
          return;
        }
        if (sub === 'start') { console.log(JSON.stringify(collab.transition(db, taskId, 'RUNNING', actor, args.note), null, 2)); return; }
        if (sub === 'block') { console.log(JSON.stringify(collab.transition(db, taskId, 'BLOCKED', actor, args.reason || args.note), null, 2)); return; }
        if (sub === 'submit') { console.log(JSON.stringify(collab.transition(db, taskId, 'REVIEW_PENDING', actor, args.note), null, 2)); return; }
        if (sub === 'verify') { console.log(JSON.stringify(collab.transition(db, taskId, 'VERIFICATION_PENDING', actor, args.note), null, 2)); return; }
        if (sub === 'complete') {
          const evidence = args.evidence ? String(args.evidence).split(',').map((x) => x.trim()).filter(Boolean) : [];
          console.log(JSON.stringify(collab.complete(db, taskId, { evidence, actor }), null, 2));
          return;
        }
        if (sub === 'fail') { console.log(JSON.stringify(collab.fail(db, taskId, args.reason, actor), null, 2)); return; }
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
      die('未知 task 子命令: ' + sub);
    }
    if (cmd === 'handoff') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const role = auth.role;
      const sub = args._[1];
      try {
        if (sub === 'create') {
          if (!args.task || !args['to-role']) die('handoff create 需要 --task 与 --to-role', 2);
          const task = collab.getTask(db, String(args.task));
          if (!task) die('任务不存在：' + args.task, 2);
          const toRole = String(args['to-role']);
          collab.role(toRole);
          const summary = collab.buildHandoffSummary(db, task);
          const text = [
            `任务: ${task.title}`,
            task.description ? `目标: ${task.description}` : null,
            task.acceptance_criteria ? `验收标准: ${task.acceptance_criteria}` : null,
            `当前状态: ${task.status}`,
            `已完成: ${summary.completed_work.join(' | ') || '（无记录）'}`,
            `未完成/风险: ${summary.open_items.join(' | ') || '（无记录）'}`,
            `证据: ${summary.evidence_refs.join(', ') || '（无）'}`,
          ].filter(Boolean).join('\n');
          const result = compileContext(db, auth.principal, auth.routing, {
            project_id: task.project_id, task_id: task.task_id, role_id: toRole,
            budget: args.budget ? Number(args.budget) : undefined,
            task: { id: task.task_id, objective: task.title, text },
            state: JSON.stringify(summary),
            assets,
          });
          const saved = collab.saveHandoff(db, {
            task, toRole, fromRole: args['from-role'] || role,
            packetId: result.packet.packet_id, summary,
          });
          console.log(JSON.stringify({ ...saved, tokens: result.packet.tokens_estimated, context_run: result.run_id }, null, 2));
          return;
        }
        if (sub === 'list') {
          if (!args.task) die('handoff list 需要 --task <id>', 2);
          console.log(JSON.stringify(collab.listHandoffs(db, String(args.task)), null, 2));
          return;
        }
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
      die('未知 handoff 子命令: ' + sub);
    }
    if (cmd === 'cost') {
      const auth = loadAuth(runtime);
      const db = runtime.openDb(auth.db);
      const role = auth.role;
      const sub = args._[1];
      try {
        if (sub === 'record') {
          collab.assertPermission(role, 'cost.record');
          const r = collab.recordCost(db, {
            project_id: args.project, task_id: args.task, agent_id: args.agent,
            model: args.model, provider: args.provider,
            input_tokens: Number(args.input || 0), output_tokens: Number(args.output || 0),
            cached_tokens: Number(args.cached || 0), tool_calls: Number(args.tools || 0),
            estimated_cost: args['estimated-cost'] === undefined ? undefined : Number(args['estimated-cost']),
            actual_cost: args['actual-cost'] === undefined ? undefined : Number(args['actual-cost']),
            usage_source: args.source || 'estimated',
          });
          console.log(JSON.stringify(r, null, 2));
          return;
        }
        if (sub === 'report') {
          collab.assertPermission(role, 'cost.read');
          console.log(JSON.stringify(collab.costReport(db, { project_id: args.project }), null, 2));
          return;
        }
      } catch (err) {
        die(String((err && err.message) || err), 4);
      }
      die('未知 cost 子命令: ' + sub);
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
module.exports = { parseArgs, KNOWN_COMMANDS };

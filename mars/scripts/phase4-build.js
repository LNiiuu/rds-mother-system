'use strict';
// P4 / WP-2 experiment harness: build the synthetic corpus, seed a benchmark DB,
// and materialise both arms for every task:
//   base-<task>.txt  : "current flow" control — full project context dump
//   mars-<task>.txt  : MARS role-filtered Context Compiler packet
// It does not call any model; the runner dispatches the prompts separately.
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('../src/db');
const store = require('../src/store');
const { compileContext } = require('../src/compiler');
const { loadRouting } = require('../src/authz');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'experiments', 'p4');
const VAR = path.join(OUT, 'var');
const PROMPTS = path.join(OUT, 'prompts');
const ROUTING = loadRouting(path.join(ROOT, 'config', 'role-routing.json'));
const fixtures = JSON.parse(fs.readFileSync(path.join(OUT, 'fixtures.json'), 'utf8'));

fs.mkdirSync(VAR, { recursive: true });
fs.mkdirSync(PROMPTS, { recursive: true });
const dbPath = path.join(VAR, 'bench.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* ignore */ }
}
const db = openDb(dbPath);

function principal(id, roles, projects) {
  return { principal_id: id, roles, project_ids: projects };
}
const project = fixtures.project_id;
const approver = principal('p4-R0', ['R0'], [project]);
const proposers = {
  R1: principal('p4-R1', ['R1'], [project]),
  R2: principal('p4-R2', ['R2'], [project]),
  R3: principal('p4-R3', ['R3'], [project])
};

const noise = Array.from({ length: 20 }, (_, i) => ({
  id: 'X' + (i + 1),
  type: i % 2 === 0 ? 'L4' : 'L2',
  visibility: 'project',
  role_scope: [],
  status: 'approved',
  content: '历史归档 ' + (i + 1) + '：' + ['发布窗口与值班安排', '旧版接口字段说明', '环境变量命名约定', '历史缺陷复盘'][i % 4] + '（与本任务无关的噪声记录）。'
}));
const corpusAll = fixtures.corpus.concat(noise);
const ids = {};
for (const item of corpusAll) {
  const who = item.role_scope && item.role_scope.length ? principal('p4-R4', ['R4'], [project])
    : (item.type === 'L3' ? proposers.R1 : proposers.R2);
  const proposed = store.propose(db, who, {
    project_id: project,
    memory_type: item.type,
    content: item.content,
    source_ref: 'experiments/p4/fixtures.json',
    source_version: 'v1',
    visibility: item.visibility,
    role_scope: item.role_scope,
    confidence: 0.9
  }, { routing: ROUTING });
  if (item.status === 'approved') {
    store.review(db, approver, 'R0', project, proposed.memory_id, 'approved');
  }
  ids[item.id] = proposed.memory_id;
}

const index = [];
for (const task of fixtures.tasks) {
  const marker = 'P4-RUN:' + task.task_id + ':';
  const compiled = compileContext(db, principal('p4-' + task.role, [task.role], [project]), ROUTING, {
    project_id: project,
    role_id: task.role,
    budget: 800,
    query: task.query || task.title,
    task: {
      id: task.task_id,
      objective: task.title,
      acceptance: ['输出 JSON 且字段完整'],
      scope: ['order-service']
    },
    state: 'p4 benchmark'
  });
  const marsText = [
    'P4-RUN:' + task.task_id + ':mars',
    '任务：' + task.title,
    task.prompt,
    '',
    '上下文（MARS role=' + task.role + ' packet=' + compiled.packet.packet_id + '，仅角色授权记忆与禁止事项）：',
    ...compiled.packet.sections.map((s) => '## ' + s.title + ' [' + s.kind + ']\n' + s.content),
    '',
    '只输出 JSON，不要使用任何工具，不要解释。'
  ].join('\n');

  const corpusLines = corpusAll.map((m) => '- [' + m.id + ' ' + m.type + '/' + m.status + (m.visibility === 'role' ? ' role=' + m.role_scope.join(',') : '') + '] ' + m.content);
  const baseText = [
    'P4-RUN:' + task.task_id + ':base',
    '任务：' + task.title,
    task.prompt,
    '',
    '上下文（当前流程：把项目全部记忆与会议记录粘贴给 Agent，不做角色过滤）：',
    corpusLines.join('\n'),
    '',
    '只输出 JSON，不要使用任何工具，不要解释。'
  ].join('\n');

  const marsPath = path.join(PROMPTS, 'mars-' + task.task_id + '.txt');
  const basePath = path.join(PROMPTS, 'base-' + task.task_id + '.txt');
  fs.writeFileSync(marsPath, marsText, 'utf8');
  fs.writeFileSync(basePath, baseText, 'utf8');
  index.push({
    task_id: task.task_id,
    class: task.class,
    role: task.role,
    mars: { file: path.relative(ROOT, marsPath), bytes: Buffer.byteLength(marsText), tokens_estimated: compiled.packet.tokens_estimated, packet_id: compiled.packet.packet_id },
    base: { file: path.relative(ROOT, basePath), bytes: Buffer.byteLength(baseText), tokens_estimated: null },
    memory_ids: ids
  });
}

fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ project_id: project, tasks: index }, null, 2), 'utf8');
console.log(JSON.stringify({
  ok: true,
  project_id: project,
  memories: corpusAll.length,
  tasks: index.length,
  base_bytes_avg: Math.round(index.reduce((n, t) => n + t.base.bytes, 0) / index.length),
  mars_bytes_avg: Math.round(index.reduce((n, t) => n + t.mars.bytes, 0) / index.length),
  mars_tokens: index.map((t) => t.mars.tokens_estimated)
}, null, 2));

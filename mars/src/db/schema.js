'use strict';
// 数据库结构与增量迁移（M3 / B5 从 db.js 拆出）。
//
// 只增不改：既有行的含义不变，不删数据、不重写数据。每一步都幂等，可在每次 open 时安全执行。
const SCHEMA_VERSION = 4;

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      memory_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_version TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      confidence REAL NOT NULL DEFAULT 0.5,
      visibility TEXT NOT NULL DEFAULT 'project',
      role_scope TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      relations TEXT NOT NULL DEFAULT '[]',
      evidence_refs TEXT NOT NULL DEFAULT '[]',
      provenance TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      UNIQUE (project_id, content_hash, source_ref, source_version)
    );
    CREATE INDEX IF NOT EXISTS idx_memories_project_status ON memories (project_id, status);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (project_id, memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories (content_hash);
    CREATE TABLE IF NOT EXISTS aliases (
      project_id TEXT NOT NULL,
      term TEXT NOT NULL,
      alias TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      PRIMARY KEY (project_id, term, alias, memory_id)
    );
    CREATE TABLE IF NOT EXISTS manifests (
      manifest_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      run_id TEXT,
      session_id TEXT,
      created_at TEXT NOT NULL,
      token_budget INTEGER NOT NULL,
      tokens_estimated INTEGER NOT NULL,
      entries_json TEXT NOT NULL,
      fragments_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fragments (
      fragment_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      content_type TEXT NOT NULL,
      content_length INTEGER NOT NULL,
      original_ref TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      ref_count INTEGER NOT NULL DEFAULT 1,
      UNIQUE (project_id, content_hash, content_type)
    );
    CREATE TABLE IF NOT EXISTS audit (
      audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      principal_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      role_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      result TEXT NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_project_ts ON audit (project_id, ts);
    CREATE TABLE IF NOT EXISTS rate_limits (
      principal_id TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      owner_principal TEXT NOT NULL,
      share_policy TEXT NOT NULL DEFAULT 'deny',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shares (
      share_id TEXT PRIMARY KEY,
      source_project TEXT NOT NULL,
      target_project TEXT NOT NULL,
      memory_ids TEXT NOT NULL,
      memory_types TEXT NOT NULL,
      roles TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      expires_at TEXT,
      revoked_by TEXT,
      revoked_at TEXT,
      note TEXT,
      reference_chain TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_shares_target_status ON shares (target_project, status);
    CREATE INDEX IF NOT EXISTS idx_shares_source ON shares (source_project);
    CREATE TABLE IF NOT EXISTS orchestrator_runs (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      task_class TEXT NOT NULL,
      risk TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      agents_json TEXT NOT NULL,
      budget_json TEXT NOT NULL,
      status TEXT NOT NULL,
      feedback_json TEXT,
      approved_by TEXT,
      approved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orch_project_status ON orchestrator_runs (project_id, status);
  `);
  migrate(db);
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, content, tokenize='unicode61')");
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION));
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('contract_version', '0.1.0');
}

// Additive migrations only: existing rows keep their meaning; no data is deleted
// or rewritten. Each step is idempotent so it is safe to run on every open.
function migrate(db) {
  const cols = db.prepare("PRAGMA table_info('memories')").all().map((c) => c.name);
  if (!cols.includes('expires_at')) {
    db.exec('ALTER TABLE memories ADD COLUMN expires_at TEXT');
  }
}

module.exports = { SCHEMA_VERSION, initSchema, migrate };

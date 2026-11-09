'use strict';
// 统计查询（M3 / B5 从 db.js 拆出）。
function dbStats(db, project_id) {
  const scope = project_id ? ' WHERE project_id = ?' : '';
  const args = project_id ? [project_id] : [];
  const one = (sql, params = []) => db.prepare(sql).get(...params);
  const byStatus = (status) => one("SELECT COUNT(*) n FROM memories WHERE status = ?" + (project_id ? ' AND project_id = ?' : ''), [status, ...args]).n;
  return {
    memories: one('SELECT COUNT(*) n FROM memories' + scope, args).n,
    approved: byStatus('approved'),
    proposed: byStatus('proposed'),
    rejected: byStatus('rejected'),
    deprecated: byStatus('deprecated'),
    superseded: byStatus('superseded'),
    expired: one("SELECT COUNT(*) n FROM memories WHERE expires_at IS NOT NULL AND expires_at <= ?" + (project_id ? ' AND project_id = ?' : ''), [new Date().toISOString(), ...args]).n,
    fragments: one('SELECT COUNT(*) n FROM fragments' + scope, args).n,
    manifests: one('SELECT COUNT(*) n FROM manifests' + scope, args).n,
    aliases: one('SELECT COUNT(*) n FROM aliases' + scope, args).n,
    audit: one('SELECT COUNT(*) n FROM audit' + (project_id ? ' WHERE project_id = ?' : ''), args).n
  };
}

module.exports = { dbStats };

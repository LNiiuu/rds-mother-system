'use strict';
// 适配器：把「项目根目录」的文件系统操作隔离在域之外。
// 域模块 projects.js 只收一个已解析的真实路径，不直接碰 fs。

const fs = require('node:fs');
const path = require('node:path');

function resolveRoot(input) {
  if (!input) throw new Error('PROJECT_ROOT_REQUIRED 需要 --project-root <目录>');
  const absolute = path.resolve(String(input));
  let real;
  try {
    real = fs.realpathSync(absolute);
  } catch (err) {
    throw new Error('PROJECT_ROOT_NOT_FOUND ' + absolute);
  }
  if (!fs.statSync(real).isDirectory()) throw new Error('PROJECT_ROOT_NOT_DIR ' + real);
  return real;
}

function pointerPath(dbPath) {
  return path.join(path.dirname(dbPath), 'current-project');
}

function readCurrent(dbPath) {
  const file = pointerPath(dbPath);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8').trim() || null;
}

function writeCurrent(dbPath, projectId) {
  const file = pointerPath(dbPath);
  fs.writeFileSync(file, projectId + '\n');
  return file;
}

module.exports = { resolveRoot, pointerPath, readCurrent, writeCurrent };

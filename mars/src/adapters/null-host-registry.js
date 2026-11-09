'use strict';
// 适配器：无宿主时的注册表（M3 / B4）。
//
// 用途：在没有任何宿主产品的机器上保持命令可用、且行为可解释 ——
// 所有操作返回 HOST_REGISTRY_NOT_FOUND，而不是「文件不存在」这种无从处理的错误。
const { AppError } = require('../errors');
const { ERRORS } = require('../ports/host-registry');

function createNullHostRegistry({ reason } = {}) {
  const why = reason || '当前环境未指定宿主注册表';
  const fail = () => {
    throw new AppError(ERRORS.NOT_FOUND, why);
  };
  return {
    detect() {
      return { present: false, path: null, format: null, writable: false, reason: why };
    },
    list() {
      return [];
    },
    backup() {
      return fail();
    },
    removeByPrefix() {
      return fail();
    }
  };
}

module.exports = { createNullHostRegistry };

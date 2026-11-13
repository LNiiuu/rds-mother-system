'use strict';
// 组合根（M3 / B1 建立，B2/B3 扩展）。
//
// 唯一职责：把「宿主环境」翻译成域模块能用的几个能力对象，然后交出去。
// 这里是**唯一**允许读 process.env 的地方；路径规则在 paths.js，契约读取在 adapters/。
//
// 硬约束（tooling/layering-check.mjs 检查）：<= 120 行；不含业务分支；不 import 域业务模块。
const { createFsAssetResolver } = require('./adapters/fs-asset-resolver');
const projectRoots = require('./adapters/fs-project-roots');
const { createCliIdentity } = require('./adapters/cli-identity');
const { createTokenFileIdentity } = require('./adapters/token-file-identity');
const { createDshSessionSource } = require('./adapters/dsh-session-source');
const { createSessionRegistry } = require('./session-registry');
const { createDbAuditSink } = require('./adapters/db-audit-sink');
const { createMockProvider } = require('./adapters/provider-mock');
const { createOpenAiCompatProvider } = require('./adapters/provider-openai-compat');
const { createAnthropicProvider } = require('./adapters/provider-anthropic');
const { createFsToolExecutor } = require('./adapters/fs-tool-executor');
const rea = require('./adapters/rea/registry');
const reaTools = require('./adapters/rea/tool-registry');
const { createWorkspaceManager } = require('./adapters/fs-workspaces');
const { openDb, attachAuditSink } = require('./db');
const { KNOWN_CONTRACTS } = require('./ports/asset-resolver');
const { PACKAGE_ROOT, resolveRoot, resolvePaths, loadRoutingConfig } = require('./paths');

/**
 * 建立一次运行所需的运行时对象（配置快照 + 资产 + 身份 + 数据源）。
 *
 * @param {object} [options]
 * @param {string} [options.root]      安装根
 * @param {object} [options.env]       环境变量来源（默认 process.env）
 * @param {object} [options.argv]      命令行参数
 * @param {object} [options.paths]     显式路径（给了就不再自行解析）
 * @param {object} [options.identity]  显式身份来源（MCP 传 token-file 适配器）
 */
function createRuntime(options = {}) {
  const env = options.env || process.env;
  const argv = options.argv || {};
  // options.root 与 argv.root 等价：前者给嵌入方用，后者给 CLI 用。
  const paths = options.paths || resolvePaths({
    argv: Object.assign({}, argv, options.root ? { root: options.root } : {}),
    env
  });

  const assets = createFsAssetResolver({
    root: paths.root,
    configPaths: { 'role-routing': paths.routing, principals: paths.principals }
  });

  // fail-fast：启动即解析全部契约。缺一个就立刻抛 ASSET_MISSING，
  // 而不是等到某次 put 才发现（B1 之前是 require 期 ENOENT）。
  for (const name of KNOWN_CONTRACTS) assets.contract(name);

  // 配置快照：进程内只读这一份，运行期不再重新读盘（改配置需重启）。
  const routing = loadRoutingConfig(assets);
  const identity = options.identity || createCliIdentity({ argv, env });

  // 会话数据源：生产环境只注册 DSH 一个，注册动作是显式的（不做自动发现）。
  const sessions = createSessionRegistry().register(createDshSessionSource());

  // 审计出口：打开连接时绑定 DbAuditSink，保证生产路径全部经过端口。
  function openAuditedDb(file) {
    const handle = openDb(file);
    attachAuditSink(handle, createDbAuditSink(handle));
    return handle;
  }


  // M12：执行层装配。provider 与工具执行器都在这里注入，
  // 域模块只认端口，不认具体厂商，也不碰 fs/env。
  // mock 需要知道该 Agent 的脚本：脚本存在 agent.definition.mock 里，装配时注入。
  const providerFactories = {
    mock: (agent) => createMockProvider({
      scriptByAgent: agent && agent.definition && agent.definition.mock && Array.isArray(agent.definition.mock.turns)
        ? { [agent.agent_id]: agent.definition.mock.turns }
        : {}
    }),
    'openai-compat': () => createOpenAiCompatProvider({ env }),
    anthropic: () => createAnthropicProvider({ env })
  };

  return {
    root: paths.root,
    paths,
    assets,
    routing,
    identity,
    sessions,
    openDb: openAuditedDb,
    auditSinkFactory: createDbAuditSink,
    // 默认允许根是安装根；MCP 保持「未显式设置则不限制」的既有语义。
    projectRoots,
    // M14：REA 工作流注册表。与 provider 一样，域层只拿到接口，不 require 适配器。
    rea: Object.assign({}, rea, { tools: reaTools }),
    allowedRoots: paths.allowedRootsFromEnv || [paths.root],
    // M12：provider 名称是外部输入，只允许落在注册表内的名字。
    providerNames: Object.keys(providerFactories),
    providerFor(name, agent) {
      const make = providerFactories[name];
      if (!make) throw new Error('PROVIDER_UNKNOWN ' + name + '（可用：' + Object.keys(providerFactories).join(',') + '）');
      return make(agent);
    },
    toolExecutorFor(root, options = {}) {
      return createFsToolExecutor({ root, ...options });
    },
    workspaceManagerFor(baseDir) {
      return createWorkspaceManager({ baseDir });
    }
  };
}

module.exports = {
  createRuntime,
  resolvePaths,
  resolveRoot,
  loadRoutingConfig,
  createTokenFileIdentity,
  PACKAGE_ROOT
};

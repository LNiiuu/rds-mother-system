'use strict';
// CLI 帮助文本的唯一真相（M5 / B3）。
//
// 为什么单独成文件：
//   1. 此前顶层用法写在 bin/rds.mjs，子命令用法写在 cli.js，两处已经分叉
//      （简版漏了 orchestrate）。单一真相是唯一解法。
//   2. 帮助是**纯数据**，不含业务。放在这里可以让入口与实现都只做渲染。
//   3. --help 必须在任何副作用之前返回。集中之后，cli.js 只需在 run() 开头判断一次。
//
// 硬约束：本文件零 require，不读取任何环境变量或文件，只导出常量与渲染函数。

const PUBLIC_OPTIONS = [
  ['--token <t>', '凭证。也可用环境变量 MARS_TOKEN'],
  ['--principals <p>', '身份文件路径。也可用 MARS_PRINCIPALS'],
  ['--db <path>', '数据库路径。也可用 MARS_DB'],
  ['--routing <p>', '角色路由配置。也可用 MARS_ROUTING'],
  ['--root <dir>', '安装根。也可用 RDS_HOME'],
  ['--debug', '出错时输出调用栈（默认只输出一行错误码 + 说明）']
];

const TOPICS = {
  version: {
    usage: 'rds version',
    summary: '打印 VERSION 文件里的产品版本。等价于 rds --version。',
    args: [],
    examples: ['rds version']
  },

  doctor: {
    usage: 'rds doctor [--json]',
    summary: '环境与安装体检。逐项检查 Node 版本、node:sqlite+FTS5、zlib zstd、Git、目录可写、版本一致性、代码路径卫生、历史文档路径、活跃文档路径、身份文件存在性、数据库可读性。有 fail 时退出码 1，仅 warn 时退出码 0。',
    args: [['--json', '输出机器可读 JSON']],
    examples: ['rds doctor', 'rds doctor --json']
  },

  validate: {
    usage: 'rds validate [--file <project.yaml>]',
    summary: '校验 project.yaml 的顶层契约：必填项、schema 必须为 rds/project/v1、stack 必须有对应的 stacks/<stack>/stack.yaml、未知顶层键报错、root 不允许残留占位符。不做嵌套结构的语义校验。',
    args: [['--file <p>', '要校验的文件，默认当前目录下的 project.yaml']],
    examples: ['rds validate', 'rds validate --file D:/Projects/my-app/project.yaml']
  },

  test: {
    usage: 'rds test [--raw]',
    summary: '运行 Required 测试门禁。判据是 tests>0 && fail=0 && skipped=0，不是 node --test 的退出码。发行包不含测试，只能在源码仓库运行。',
    args: [['--raw', '直接输出 node --test 的原始结果，不走门禁汇总']],
    examples: ['rds test', 'rds test --raw']
  },

  init: {
    usage: 'rds init [--db <path>]',
    summary: '初始化数据库：建表、建 FTS5 索引、写入 schema 版本。库已存在时做增量迁移，不重复建表。输出库路径与各表计数（全为 0 表示新建）。',
    args: [['--db <path>', '数据库路径，默认 <安装根>/mars/var/mars.db']],
    examples: ['rds init', 'rds init --db ./mars-data/mars.db']
  },

  'init-dev': {
    usage: 'rds init-dev [--principal <id>] [--projects <a,b>] [--roles <R0,R4>] [--out <path>]',
    summary:
      '生成一个开发身份，token 只显示一次。文件里只写 token 的 SHA-256，不写明文。' +
      '注意：本命令会**整个覆盖**目标身份文件；已有其他身份时不要直接重复执行。',
    args: [
      ['--principal <id>', 'principal_id，默认 dev-r0'],
      ['--projects <a,b>', '可访问的项目 ID，逗号分隔，默认 demo'],
      ['--roles <R0,R4>', '角色，逗号分隔，默认 R0。审批需要 R4 或 R0'],
      ['--out <path>', '写出路径，默认 <安装根>/mars/config/principals.json']
    ],
    examples: ['rds init-dev --principal dev-r0 --projects demo --roles R0,R4']
  },

  put: {
    usage: 'rds put --project <id> --type <L1|L2|L3|L4> --content <文本> --source <ref> --version <ver> [选项]',
    summary:
      '写入一条记忆，状态为 proposed。proposed 不会进入检索结果与上下文包，' +
      '必须由另一个身份 review 成 approved 才生效。相同内容重复写入会返回 duplicate=false/true 与已有 memory_id。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--type <L1-L4>', 'L1 事实 / L2 约定 / L3 决策 / L4 经验，默认 L2'],
      ['--content <文本>', '记忆内容（必填）'],
      ['--source <ref>', '来源引用，如 docs/decision.md（必填）'],
      ['--version <ver>', '来源版本，如 v1（必填）'],
      ['--role <R0-R7>', '以哪个角色写入，默认取身份的第一个角色'],
      ['--confidence <0-1>', '置信度，默认 0.5'],
      ['--visibility <v>', 'project 或 shared，默认 project'],
      ['--tags <a,b>', '标签，逗号分隔'],
      ['--evidence <a,b>', '证据引用，逗号分隔']
    ],
    examples: [
      'rds put --project demo --type L3 --content "用 Node 内置 sqlite" --source docs/d.md --version v1'
    ]
  },

  get: {
    usage: 'rds get --project <id> --memory <memory_id>',
    summary: '按 memory_id 读取一条记忆的完整记录，不受状态限制（proposed 也能读，只要有权限）。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--memory <id>', 'memory_id，形如 mem_xxxxxxxxxxxx（必填）']
    ],
    examples: ['rds get --project demo --memory mem_0a49a3ab62d8']
  },

  list: {
    usage: 'rds list --project <id> [--status <s>] [--type <L1-L4>] [--limit <n>]',
    summary: '列出项目内的记忆。不带 --status 时列出全部状态，含 proposed。这是查看待审队列的方式。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--status <s>', 'proposed / approved / rejected / deprecated / superseded / expired'],
      ['--type <L1-L4>', '按记忆类型过滤'],
      ['--limit <n>', '最多返回条数']
    ],
    examples: ['rds list --project demo --status proposed']
  },

  search: {
    usage: 'rds search --project <id> --query <文本> [--type <L1-L4>] [--alias <词>] [--limit <n>]',
    summary:
      '检索记忆。**只返回 approved**——proposed 不进入正式上下文，这是设计行为，不是缺陷。' +
      '支持 ID 精确匹配、结构化过滤、FTS5 全文与别名展开；中文在 FTS5 分词不足时回退到分段 LIKE。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--query <文本>', '检索词'],
      ['--type <L1-L4>', '按类型过滤'],
      ['--alias <词>', '按已建立的别名检索'],
      ['--limit <n>', '最多返回条数'],
      ['--shared <true|false>', '是否包含共享进来的记忆，默认 true']
    ],
    examples: ['rds search --project demo --query "sqlite"']
  },

  review: {
    usage: 'rds review --project <id> --memory <id> --decision <状态名> [--note <说明>]',
    summary:
      '审批一条记忆。写入者与审批者必须是不同身份，同一 principal 自审返回 SELF_REVIEW_DENIED。' +
      '需要 R0 或 R4 角色。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--memory <id>', 'memory_id（必填）'],
      ['--decision <s>', 'approved / rejected / deprecated / superseded。传动词（approve）会得到 DECISION_INVALID'],
      ['--note <说明>', '审批备注'],
      ['--role <R0|R4>', '审批角色，默认取身份的第一个角色']
    ],
    examples: [
      'rds review --project demo --memory mem_0a49a3ab62d8 --decision approved'
    ]
  },

  alias: {
    usage: 'rds alias --project <id> --term <词> --alias <别名> --memory <id>',
    summary: '为一个记忆建立检索别名，让 --query 命中同义词。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--term <词>', '原词（必填）'],
      ['--alias <别名>', '别名（必填）'],
      ['--memory <id>', '关联的 memory_id（必填）']
    ],
    examples: ['rds alias --project demo --term sqlite --alias 数据库 --memory mem_xxx']
  },

  compile: {
    usage: 'rds compile --project <id> --task <id|文件> [--role <R0-R7>] [--budget <n>] [--out <文件>]',
    summary:
      '按角色与预算编译上下文包。产物含 packet（分节内容）、manifest（片段来源与哈希）、budget（裁剪记录）。' +
      '受保护小节在预算不足时不会被裁掉，只会标记 over_budget。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--task <id|文件>', '任务 ID；传 .json 文件路径时读取任务卡'],
      ['--objective <文本>', '任务目标（--task 传 ID 时可用）'],
      ['--acceptance <a|b>', '验收标准，竖线分隔'],
      ['--evidence <a,b>', '证据引用，逗号分隔'],
      ['--budget <n>', 'Token 预算上限'],
      ['--query <文本>', '附加检索词'],
      ['--state <s>', '任务状态'],
      ['--out <文件>', '写出 JSON；省略则打印到 stdout'],
      ['--role <R0-R7>', '以哪个角色编译']
    ],
    examples: [
      'rds compile --project demo --task T-001 --role R0 --budget 4000 --out ./packet.json'
    ]
  },

  fragment: {
    usage: 'rds fragment --project <id> --fragment <id>',
    summary: '按 manifest 里记录的片段 ID 恢复原文，用于核对上下文包引用的内容是否被改动。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--fragment <id>', '片段 ID（必填）']
    ],
    examples: ['rds fragment --project demo --fragment frag_xxx']
  },

  stats: {
    usage: 'rds stats --project <id>',
    summary: '项目级统计：各状态记忆数、片段数、清单数、审计条数。',
    args: [
      ['--project <id>', '项目 ID（必填）'],
      ['--role <R0-R7>', '以哪个角色查询']
    ],
    examples: ['rds stats --project demo']
  },

  audit: {
    usage: 'rds audit [--limit <n>]',
    summary: '查看审计记录（倒序）。每条记录谁在什么时候、以什么角色、对什么对象做了什么。',
    args: [['--limit <n>', '最多返回条数，默认 50，上限 500']],
    examples: ['rds audit', 'rds audit --limit 100']
  },

  ledger: {
    usage: 'rds ledger --session <文件> [--source <kind>] [--out <目录>] [--project <id>]',
    summary:
      '解析会话文件（.jsonl 或 .jsonl.zstd）的 usage，生成 Token 账本。' +
      '只读动作：不会创建数据库；库已存在时才写一条审计（principal 记为哨兵 local）。' +
      '输出按 mars/contracts/ledger.schema.json 校验，不符合时返回 LEDGER_CONTRACT_INVALID。',
    args: [
      ['--session <文件>', '会话文件（必填）'],
      ['--source <kind>', '数据源类型；省略时按内容嗅探。已注册来源见报错信息'],
      ['--out <目录>', '写出 ledger.json / ledger.csv 到该目录；省略则打印到 stdout'],
      ['--project <id>', '审计记录里的项目 ID，默认 -']
    ],
    examples: [
      'rds ledger --session session.v4.jsonl.zstd',
      'rds ledger --session s.jsonl --out ./ledger'
    ]
  },

  mcp: {
    usage: 'rds mcp --enable',
    summary:
      '启动旧版 MCP 网关（同进程 JSON-RPC，默认禁用）。新接入请用 mars/src/mcp-stdio.js，' +
      '它按进程环境绑定身份，调用方无法在工具参数里指定 principal。',
    args: [['--enable', '显式启用。不加此参数会以退出码 5 拒绝启动']],
    examples: ['rds mcp --enable']
  },

  project: {
    usage: 'rds project <register|list> [选项]',
    summary: '项目注册与查询。注册后才能被共享与编排引用。',
    subcommands: [
      ['register', 'rds project register --project <id> --name <显示名> --policy <策略>'],
      ['list', 'rds project list']
    ],
    args: [
      ['--project <id>', 'register 必填'],
      ['--name <显示名>', 'register 必填'],
      ['--policy <策略>', 'register 必填：共享策略名']
    ],
    examples: ['rds project register --project demo --name "Demo 项目" --policy default']
  },

  share: {
    usage: 'rds share <create|approve|revoke|list> [选项]',
    summary:
      '跨项目共享记忆。默认拒绝：创建后需目标项目审批才生效，可撤销、可设过期。' +
      '每次状态变化都写审计。',
    subcommands: [
      ['create', 'rds share create --project <源> --target <目标> [--memory a,b] [--types L1,L3] [--roles R0] [--expires <ISO>]'],
      ['approve', 'rds share approve --share <id>'],
      ['revoke', 'rds share revoke --share <id> --note <说明>'],
      ['list', 'rds share list --project <id>']
    ],
    args: [
      ['--project <id>', '源项目（create）或查询项目（list）'],
      ['--target <id>', '目标项目（create 必填）'],
      ['--memory <a,b>', '要共享的 memory_id，逗号分隔'],
      ['--types <L1,L3>', '按类型共享'],
      ['--roles <R0,R4>', '允许哪些角色读取'],
      ['--expires <ISO>', '过期时间'],
      ['--note <说明>', '备注'],
      ['--share <id>', '共享单 ID（approve / revoke 必填）']
    ],
    examples: ['rds share create --project demo --target other --memory mem_xxx']
  },

  orchestrate: {
    usage: 'rds orchestrate <plan|start|approve|feedback|status|suggest> [选项]',
    summary:
      '编排器：按任务分类给出最小 Agent 集、风险门与预算，记录运行与反馈。' +
      '规则引擎 rule/1.0.0，离线、可解释，不自动执行任何动作；高风险任务必须人工 approve。',
    subcommands: [
      ['plan', 'rds orchestrate plan --project <id> --task <id> --objective <文本> [--tokens <n>]'],
      ['start', 'rds orchestrate start --project <id> --task <id> --objective <文本> [--by <id>]'],
      ['approve', 'rds orchestrate approve --run <id> [--by <id>] [--reason <说明>]'],
      ['feedback', 'rds orchestrate feedback --run <id> --tokens <n> [--quality <0-1>] [--rework <n>]'],
      ['status', 'rds orchestrate status --run <id>'],
      ['suggest', 'rds orchestrate suggest --project <id>']
    ],
    args: [
      ['--project <id>', '项目 ID'],
      ['--task <id>', '任务 ID'],
      ['--objective <文本>', '任务目标'],
      ['--description <文本>', '任务描述（用于分类）'],
      ['--tokens <n>', '预算或反馈的 token 数'],
      ['--run <id>', '运行 ID（approve / feedback / status 必填）'],
      ['--by <id>', '执行者标识'],
      ['--reason <说明>', '审批理由'],
      ['--quality <0-1>', '质量评分'],
      ['--rework <n>', '返工次数']
    ],
    examples: ['rds orchestrate plan --project demo --task T-001 --objective "实现登录"']
  },

  help: {
    usage: 'rds help [命令]',
    summary: '不带参数打印顶层用法；带命令名打印该命令的详细说明。等价于 rds <命令> --help。',
    args: [['<命令>', '要查看的命令名，如 put、ledger、share']],
    examples: ['rds help', 'rds help put']
  }
};

const USAGE = `RDS —— 研发流程资产 + 本地记忆引擎（MARS）

用法: rds <命令> [选项]
      rds help <命令>          查看某个命令的详细说明
      rds <命令> --help        同上

内建命令
  version                 打印 VERSION
  doctor  [--json]        环境诊断（逐项体检，明细见 rds help doctor）
  validate [--file <p>]   校验 project.yaml 的顶层契约
  test    [--raw]         运行 Required 测试门禁（仅源码仓库）

MARS 记忆引擎
  init                    初始化数据库
  init-dev                生成开发身份（token 只显示一次）
  put                     写入一条记忆（proposed，需审批才生效）
  get                     按 memory_id 读取
  list                    列出记忆（可按状态 / 类型过滤）
  search                  检索（只返回 approved）
  review                  审批（需 R0/R4，不能自审）
  alias                   为检索词建立别名
  compile                 编译上下文包（packet + manifest + budget）
  fragment                按 manifest 恢复原文片段
  stats                   项目统计
  audit                   查看审计记录

集成与运维
  ledger                  解析会话 usage，生成 Token 账本
  mcp                     MCP 网关（默认禁用，需 --enable）
  project                 register | list
  share                   create | approve | revoke | list
  orchestrate             plan | start | approve | feedback | status | suggest

公共选项
  --token <t>             凭证（也可用 MARS_TOKEN）
  --principals <p>        身份文件（也可用 MARS_PRINCIPALS）
  --db <path>             数据库（也可用 MARS_DB）
  --routing <p>           角色路由配置（也可用 MARS_ROUTING）
  --root <dir>            安装根（也可用 RDS_HOME）
  --debug                 出错时输出栈

示例
  rds init --db ./mars-data/mars.db
  rds doctor
  rds help ledger
  rds search --project demo --query "SQLite"

文档
  安装与最小闭环: docs/install.md、docs/quickstart.md（源码仓库内）
`;

/**
 * 字符串的终端显示宽度。CJK 字符占两列，`String.length` 会把它们算成一列，
 * 于是含中文的参数名与纯 ASCII 的参数名对不齐。
 */
function displayWidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const wide =
      c >= 0x1100 && (
        c <= 0x115f ||
        (c >= 0x2e80 && c <= 0x303e) ||
        (c >= 0x3041 && c <= 0x33ff) ||
        (c >= 0x3400 && c <= 0x4dbf) ||
        (c >= 0x4e00 && c <= 0x9fff) ||
        (c >= 0xa000 && c <= 0xa4cf) ||
        (c >= 0xac00 && c <= 0xd7a3) ||
        (c >= 0xf900 && c <= 0xfaff) ||
        (c >= 0xfe30 && c <= 0xfe6f) ||
        (c >= 0xff00 && c <= 0xff60) ||
        (c >= 0xffe0 && c <= 0xffe6)
      );
    w += wide ? 2 : 1;
  }
  return w;
}

/** 把参数表渲染成对齐的两列（按显示宽度而非字符数对齐）。 */
function renderArgs(pairs) {
  const target = Math.max(...pairs.map((p) => displayWidth(p[0]))) + 2;
  return pairs
    .map((p) => '  ' + p[0] + ' '.repeat(Math.max(2, target - displayWidth(p[0]))) + p[1])
    .join('\n');
}

/**
 * 渲染某个命令的帮助。未知命令返回 null，由调用方决定如何报错。
 * @param {string} cmd
 * @returns {string|null}
 */
function render(cmd) {
  const t = TOPICS[cmd];
  if (!t) return null;
  const out = [];
  out.push('用法: ' + t.usage);
  out.push('');
  out.push(t.summary);
  out.push('');
  if (t.subcommands) {
    out.push('子命令');
    out.push(renderArgs(t.subcommands));
    out.push('');
  }
  if (t.args && t.args.length) {
    out.push('选项');
    out.push(renderArgs(t.args));
    out.push('');
  }
  out.push('公共选项');
  out.push(renderArgs(PUBLIC_OPTIONS));
  if (t.examples && t.examples.length) {
    out.push('');
    out.push('示例');
    for (const e of t.examples) out.push('  ' + e);
  }
  return out.join('\n');
}

module.exports = {
  USAGE,
  TOPICS,
  PUBLIC_OPTIONS,
  render,
  /** 由 bin/rds.mjs 直接实现、不经 mars/src/cli.js 的命令。 */
  BUILTINS: ['version', 'doctor', 'validate', 'test'],
  /** 有详细帮助的命令名（供测试枚举） */
  TOPIC_NAMES: Object.keys(TOPICS)
};

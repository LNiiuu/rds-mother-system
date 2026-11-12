'use strict';
// W-06 Frida 运行时分析（M14-6）。
//
// 本环境不可达，原因有三层，缺一不可：
//   1. 没有 frida / frida-ps 可执行文件
//   2. 没有可连接的设备或模拟器（adb 也没有）
//   3. 没有明确授权的目标进程
//
// 因此本工作流**不实现 execute**，只实现 preflight。这是刻意的：
// 一个不能验证的「动态插桩」比没有更危险——它会让人以为做过。
//
// 安全边界（写进代码）：只允许对用户拥有或明确授权的应用与测试环境使用；
// 不做隐蔽监控，不绕过第三方安全防护。

const { probe } = require('./tools');

const workflow = {
  workflow_id: 'W-06',
  title: 'Frida 运行时分析',
  engine: 'frida（缺失）',
  requires: ['frida', 'adb'],
  completeness: 'full',

  input_schema: {
    type: 'object',
    properties: {
      target: { type: 'string', description: '目标进程名或 PID' },
      purpose: { type: 'string', description: '分析目的（必填，用于授权核对）' },
      authorization: { type: 'string', description: '授权说明：own-device | lab | written-consent' }
    },
    required: ['target', 'purpose', 'authorization']
  },

  result_schema: {
    type: 'object',
    properties: {
      status: { type: 'string' },
      missing_capability: { type: 'object' }
    }
  },

  async preflight(input) {
    const checks = [];
    const tools = await probe(['frida', 'frida-ps', 'adb']);
    for (const t of tools) {
      checks.push({ check: `工具 ${t.name} 可用`, ok: t.present, detail: t.present ? `${t.path} (${t.version})` : '未在 PATH 中找到' });
    }

    const auth = input && input.authorization;
    const authOk = ['own-device', 'lab', 'written-consent'].includes(String(auth));
    checks.push({
      check: '授权声明有效', ok: authOk,
      detail: authOk ? auth : '必须是 own-device / lab / written-consent 之一'
    });
    checks.push({
      check: '目标已声明', ok: Boolean(input && input.target),
      detail: (input && input.target) || '(未提供)'
    });

    const frida = tools.find((t) => t.name === 'frida');
    const adb = tools.find((t) => t.name === 'adb');
    const ready = Boolean(frida && frida.present && adb && adb.present && authOk);

    return {
      ok: ready,
      checks,
      blocked_reason: !authOk ? 'AUTHORIZATION_REQUIRED'
        : (!frida || !frida.present ? 'TOOL_MISSING:frida'
          : (!adb || !adb.present ? 'TOOL_MISSING:adb' : null)),
      tools
    };
  },

  // 刻意不提供 execute：没有工具与授权目标时，任何"执行"都只能是伪造。
  async execute() {
    const err = new Error('W06_NOT_EXECUTABLE 本环境缺 frida/adb，且无授权目标；不提供模拟执行');
    err.code = 'W06_NOT_EXECUTABLE';
    throw err;
  },

  render(result) {
    return [
      '# W-06 Frida 运行时分析（BLOCKED）',
      '',
      result && result.message ? result.message : '本环境不可达。',
      '',
      '## 阻塞原因',
      '- 无 `frida` / `frida-ps` 可执行文件',
      '- 无 `adb`，无可连接设备',
      '- 无明确授权的目标进程',
      '',
      '## 为什么不提供"演示模式"',
      '动态插桩的结论只能来自真实运行时。用模拟数据生成 hook 记录，',
      '会让后续所有人误以为这个能力验证过。宁可标 BLOCKED。',
      '',
      '## 安全边界',
      '- 仅限用户拥有或书面授权的应用与测试环境',
      '- 不用于隐蔽监控',
      '- 不用于绕过第三方安全防护'
    ].join('\n') + '\n';
  }
};

module.exports = workflow;

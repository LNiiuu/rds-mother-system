'use strict';
// M8 / B2：上下文包的 Markdown 渲染。
//
// 目的：M7 实测 JSON 包 10 105 B 只承载 240 tokens，且 packet/budget 重复内容。
// 这个渲染器只输出「读的人真正需要的东西」：元信息 + 各分节正文 + 缺失项。
// 它不改写、不截断任何 section.content —— 优化的是载体，不是内容。

function renderPacketMarkdown(packet) {
  const lines = [];
  const truncated = (packet.sections || []).filter((s) => s.truncated).map((s) => s.id);

  lines.push(`# 上下文包：${packet.task_id}`);
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('|---|---|');
  lines.push(`| packet_id | \`${packet.packet_id}\` |`);
  lines.push(`| manifest_id | \`${packet.manifest_id}\` |`);
  lines.push(`| project / role | \`${packet.project_id}\` / \`${packet.role_id}\`（${packet.role_profile || packet.role_id}） |`);
  lines.push(`| token | ${packet.tokens_estimated} / ${packet.token_budget}（${packet.estimate_label}） |`);
  lines.push(`| 生成时间 | ${packet.created_at} |`);
  lines.push(`| 编译器 | ${packet.compiler_version || 'n/a'} |`);
  if (truncated.length) lines.push(`| 已截断分节 | ${truncated.join(', ')} |`);
  lines.push('');

  for (const section of packet.sections || []) {
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(`<!-- kind=${section.kind} tokens=${section.token_estimate} refs=${(section.source_refs || []).join(' ')} -->`);
    lines.push('');
    lines.push(section.content && section.content.length ? section.content : '（空）');
    lines.push('');
  }

  if (Array.isArray(packet.missing) && packet.missing.length) {
    lines.push('## 缺失项');
    lines.push('');
    for (const item of packet.missing) {
      lines.push(`- ${item.blocking ? '**blocking** ' : ''}${item.kind}：${item.description}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

module.exports = { renderPacketMarkdown };

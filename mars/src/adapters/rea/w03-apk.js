'use strict';
// W-03 Android APK 静态分析（M14-3）。
//
// 本环境没有 jadx、没有 apktool、没有 java，因此**完整分析不可达**：
//   - 二进制 AndroidManifest.xml 需要 axmldec/jadx 才能解码
//   - classes*.dex 需要 jadx/dexdump 才能反编译
//   - resources.arsc 需要 aapt2/apktool
//
// 能做的：APK 本质是 ZIP，直接读中央目录可以确定「包里有什么」——
// 这一层是纯字节解析，不依赖任何外部工具，结果是事实。
//
// 因此本工作流的 status 是 BLOCKED（完整目标不可达），但 result.structure 是真实产出。
// 不把「列了几个文件名」包装成「APK 静态分析已完成」。

const fs = require('node:fs');
const path = require('node:path');
const { probe } = require('./tools');
const { sha256File } = require('./evidence');

/** 解析 ZIP 中央目录，列出条目。纯字节操作，不依赖 unzip。 */
function listZipEntries(buf) {
  // 从尾部找 EOCD（0x06054b50），最多回退 64 KB 注释
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return { ok: false, error: 'ZIP_EOCD_NOT_FOUND' };
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count && off + 46 <= buf.length; i += 1) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const uncompSize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    // 有的打包工具在 Windows 上写反斜杠；APK 规范是正斜杠，这里统一。
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    entries.push({ name, method, compressed_bytes: compSize, bytes: uncompSize });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return { ok: true, entries, declared_count: count };
}

const workflow = {
  workflow_id: 'W-03',
  title: 'Android APK 静态分析',
  engine: 'jadx（缺失）',
  requires: ['jadx', 'java'],
  completeness: 'full',

  input_schema: {
    type: 'object',
    properties: { sample: { type: 'string', description: 'APK 绝对路径' } },
    required: ['sample']
  },
  result_schema: {
    type: 'object',
    properties: {
      sample: { type: 'object' },
      structure: { type: 'object' },
      missing_capability: { type: 'object' }
    }
  },

  async preflight(input) {
    const checks = [];
    const tools = await probe(['jadx', 'java', 'apktool']);
    for (const t of tools) {
      checks.push({ check: `工具 ${t.name} 可用`, ok: t.present, detail: t.present ? `${t.path} (${t.version})` : '未在 PATH 中找到' });
    }
    const sample = input && input.sample ? path.resolve(String(input.sample)) : null;
    const exists = Boolean(sample) && fs.existsSync(sample);
    checks.push({ check: 'sample 存在', ok: exists, detail: sample || '(未提供)' });

    // APK 必须是 ZIP；先看一眼 magic，避免把"文件根本不合法"误诊成"缺工具"
    let zipMagic = false;
    if (exists) {
      const head = fs.readFileSync(sample).slice(0, 4);
      zipMagic = head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05);
    }
    checks.push({ check: 'sample 是 ZIP/APK', ok: zipMagic, detail: zipMagic ? 'PK 头匹配' : '不是 ZIP 容器' });

    const jadx = tools.find((t) => t.name === 'jadx');
    const java = tools.find((t) => t.name === 'java');
    // 完整目标要求 jadx + java；缺一即 BLOCKED。
    const ready = Boolean(jadx && jadx.present && java && java.present && exists && zipMagic);
    return {
      ok: ready,
      checks,
      blocked_reason: !exists ? 'SAMPLE_NOT_FOUND'
        : (!zipMagic ? 'SAMPLE_NOT_APK'
          : (!jadx || !jadx.present ? 'TOOL_MISSING:jadx'
            : (!java || !java.present ? 'TOOL_MISSING:java' : null))),
      tools
    };
  },

  async execute(input, ctx = {}) {
    const sample = path.resolve(String(input.sample));
    const hash = await sha256File(sample);
    const buf = fs.readFileSync(sample);
    const zip = listZipEntries(buf);

    const missing = {
      jadx: true,
      java: true,
      note: '本机无 jadx / java / apktool；WSL 被安全策略封禁，无法借用另一环境的工具链'
    };

    if (!zip.ok) {
      return {
        result: { sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes }, error: zip.error, note: '不是有效 ZIP/APK' },
        tool_versions: [], commands: [], limitations: ['样本不是有效 APK（ZIP 结构解析失败）'], sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes }
      };
    }

    const byClass = {
      dex: zip.entries.filter((e) => /^classes\d*\.dex$/.test(e.name)),
      manifest: zip.entries.filter((e) => e.name === 'AndroidManifest.xml'),
      resources: zip.entries.filter((e) => e.name === 'resources.arsc'),
      native: zip.entries.filter((e) => /^lib\/.+\.so$/.test(e.name)),
      assets: zip.entries.filter((e) => e.name.startsWith('assets/')),
      meta: zip.entries.filter((e) => e.name.startsWith('META-INF/'))
    };

    const result = {
      sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes, kind: 'authorized-local-file' },
      structure: {
        entries: zip.entries.length,
        dex_files: byClass.dex.map((e) => ({ name: e.name, bytes: e.bytes })),
        has_binary_manifest: byClass.manifest.length > 0,
        has_resources_arsc: byClass.resources.length > 0,
        native_libs: byClass.native.map((e) => e.name),
        assets_count: byClass.assets.length,
        signature_files: byClass.meta.map((e) => e.name).filter((n) => /\.(RSA|DSA|EC|SF)$/.test(n)),
        largest: [...zip.entries].sort((a, b) => b.bytes - a.bytes).slice(0, 10).map((e) => ({ name: e.name, bytes: e.bytes }))
      },
      missing_capability: {
        ...missing,
        not_done: ['AndroidManifest 解码（权限/组件/API level）', 'DEX 反编译（Java/Kotlin 源码）', 'resources.arsc 解析', '网络相关代码定位', '可疑调用链'],
        what_structure_gives: '包内有哪些文件、DEX 数量与大小、是否有 native 库与签名文件——这是事实层，不是分析结论'
      },
      inference_notes: [
        'structure 来自 ZIP 中央目录，是字节级事实',
        'has_binary_manifest 只说明文件存在，未解码内容',
        '未做任何代码语义分析'
      ]
    };

    return {
      result,
      tool_versions: [{ name: 'rea-zip-reader', version: '1.0.0', kind: 'builtin' }],
      commands: [],
      limitations: ['完整 APK 静态分析不可达：缺 jadx/java', '仅产出包结构事实'],
      sample: { path: sample, sha256: hash.sha256, bytes: hash.bytes, kind: 'authorized-local-file' }
    };
  },

  render(result) {
    const L = [];
    L.push('# W-03 Android APK 静态分析（BLOCKED）');
    L.push('');
    L.push(`样本：\`${result.sample.path}\``);
    L.push('');
    if (result.error) {
      L.push(`**无法解析**：${result.error} — ${result.note}`);
      return L.join('\n') + '\n';
    }
    L.push(`- SHA-256：\`${result.sample.sha256}\``);
    L.push(`- 大小：${result.sample.bytes} B`);
    L.push('');
    L.push('## 阻塞原因');
    L.push('');
    L.push(`缺工具：${Object.entries(result.missing_capability).filter(([k, v]) => v === true).map(([k]) => k).join(', ')}`);
    L.push('');
    L.push(result.missing_capability.note);
    L.push('');
    L.push('**未做**：' + result.missing_capability.not_done.join('、'));
    L.push('');
    L.push('## 仍能确定的事实（ZIP 结构）');
    L.push('');
    L.push(`- 条目数：${result.structure.entries}`);
    L.push(`- DEX：${result.structure.dex_files.map((d) => `${d.name}(${d.bytes} B)`).join(', ') || '无'}`);
    L.push(`- 二进制 Manifest：${result.structure.has_binary_manifest ? '存在（未解码）' : '不存在'}`);
    L.push(`- resources.arsc：${result.structure.has_resources_arsc ? '存在' : '不存在'}`);
    L.push(`- native 库：${result.structure.native_libs.join(', ') || '无'}`);
    L.push(`- 签名文件：${result.structure.signature_files.join(', ') || '无'}`);
    L.push('');
    L.push(`> ${result.missing_capability.what_structure_gives}`);
    return L.join('\n') + '\n';
  }
};

module.exports = workflow;
module.exports.listZipEntries = listZipEntries;

'use strict';
// M19：REA 统一工具适配层。
//
// 每个适配器至少声明：名称、可执行文件、版本参数、能力、命令构造、安全限制。
// 真实执行统一走 execFile（不经 shell），带超时、输出上限和结构化结果。
// 工具缺失时返回 TOOL_MISSING，不抛“看起来跑过”的假结果。

const fs = require('node:fs');
const path = require('node:path');
const { probe, run, DEFAULT_TIMEOUT } = require('./tools');

const MAX_OUTPUT = 24 * 1024 * 1024;

const DEFS = {
  objdump: {
    name: 'objdump',
    label: 'GNU binutils objdump',
    bins: ['objdump'],
    versionArgs: ['--version'],
    capabilities: ['pe/elf header', 'sections', 'imports', 'symbols', 'disassembly'],
    safety: 'read-only; sample is never executed'
  },
  ghidra: {
    name: 'ghidra',
    label: 'Ghidra Headless',
    bins: ['analyzeHeadless'],
    versionArgs: ['-version'],
    capabilities: ['import', 'auto-analysis', 'functions', 'xrefs', 'decompile'],
    safety: 'headless project in temp dir; sample read-only'
  },
  jadx: {
    name: 'jadx',
    label: 'JADX',
    bins: ['jadx'],
    versionArgs: ['--version'],
    capabilities: ['apk manifest', 'dex decompile', 'resources'],
    safety: 'read-only APK; output to temp dir'
  },
  java: {
    name: 'java',
    label: 'Java runtime',
    bins: ['java'],
    versionArgs: ['-version'],
    capabilities: ['jadx runtime'],
    safety: 'runtime only'
  },
  apktool: {
    name: 'apktool',
    label: 'apktool',
    bins: ['apktool'],
    versionArgs: ['--version'],
    capabilities: ['apk decode', 'manifest', 'resources'],
    safety: 'read-only APK; output to temp dir'
  },
  tshark: {
    name: 'tshark',
    label: 'Wireshark tshark',
    bins: ['tshark'],
    versionArgs: ['-v'],
    capabilities: ['pcap read', 'protocol hierarchy', 'conversations', 'dns/http fields'],
    safety: 'read-only capture; no live interface by default'
  },
  frida: {
    name: 'frida',
    label: 'Frida',
    bins: ['frida', 'frida-ps'],
    versionArgs: ['--version'],
    capabilities: ['attach', 'script load', 'runtime hooks'],
    safety: 'authorized device/process only; no stealth/evasion'
  },
  adb: {
    name: 'adb',
    label: 'Android Debug Bridge',
    bins: ['adb'],
    versionArgs: ['version'],
    capabilities: ['device list', 'forward'],
    safety: 'authorized device only'
  }
};

function toolNames() {
  return Object.keys(DEFS);
}

function ghidraHome(env = process.env) {
  return env.GHIDRA_HOME || env.GHIDRA_INSTALL_DIR || null;
}

async function detect(name, options = {}) {
  const def = DEFS[name];
  if (!def) throw new Error('TOOL_UNKNOWN ' + name);
  const env = options.env || process.env;
  // M23：工具装在非 PATH 目录时，用显式路径覆盖；仍然做版本探测，不盲信路径。
  const overrideKey = 'MARS_' + name.toUpperCase() + '_PATH';
  const override = env[overrideKey] || env[name.toUpperCase() + '_PATH'];
  if (override && fs.existsSync(override)) {
    const r = await run(override, [def.versionArgs[0]], { timeout: 8000 });
    return {
      name, label: def.label, present: true, path: override,
      version: ((r.stdout || r.stderr || '').trim().split(/\r?\n/)[0] || 'unknown').slice(0, 160),
      capabilities: def.capabilities, safety: def.safety, source: overrideKey, probe_ok: r.ok
    };
  }
  if (name === 'ghidra' && ghidraHome(env)) {
    const home = ghidraHome(env);
    const candidates = [
      path.join(home, 'support', 'analyzeHeadless'),
      path.join(home, 'support', 'analyzeHeadless.bat')
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (found) {
      return { name, label: def.label, present: true, path: found, version: 'GHIDRA_HOME=' + home, capabilities: def.capabilities, safety: def.safety, source: 'GHIDRA_HOME' };
    }
  }
  const found = await probe(def.bins, { versionFlag: Object.fromEntries(def.bins.map((b) => [b, def.versionArgs[0]])) });
  const main = found.find((f) => f.present) || found[0];
  return {
    name, label: def.label,
    present: Boolean(main && main.present),
    path: main ? main.path : null,
    version: main ? main.version : null,
    capabilities: def.capabilities,
    safety: def.safety,
    bins: found
  };
}

async function status(options = {}) {
  const out = [];
  for (const name of toolNames()) out.push(await detect(name, options));
  return out;
}

/** 统一执行入口。工具缺失返回 BLOCKED，不抛。 */
async function execute(name, args, options = {}) {
  const def = DEFS[name];
  if (!def) return { ok: false, error_code: 'TOOL_UNKNOWN', tool: name, stdout: '', stderr: '' };
  const info = await detect(name, options);
  if (!info.present) {
    return {
      ok: false, error_code: 'TOOL_MISSING', tool: name,
      bin: null, argv: args || [], stdout: '', stderr: '',
      message: def.label + ' 未安装或在 PATH 中找不到', install: installHint(name)
    };
  }
  const r = await run(info.path, args || [], {
    cwd: options.cwd,
    timeout: options.timeoutMs || DEFAULT_TIMEOUT,
    maxBuffer: options.maxBuffer || MAX_OUTPUT
  });
  return {
    ok: r.ok, error_code: r.ok ? null : (r.timed_out ? 'TOOL_TIMEOUT' : 'TOOL_EXIT_' + r.code),
    tool: name, bin: info.path, version: info.version, argv: args || [],
    exit_code: r.code, timed_out: r.timed_out, stdout: r.stdout, stderr: r.stderr
  };
}

function installHint(name) {
  const hints = {
    ghidra: '设置 GHIDRA_HOME，或把 support/analyzeHeadless 加入 PATH；官方 Ghidra 发行包自带 JDK 时可用其 java',
    jadx: '安装 JADX 并把 jadx 加入 PATH；需要 JDK',
    java: '安装 JDK 17+ 并加入 PATH',
    apktool: '安装 apktool 并加入 PATH',
    tshark: '安装 Wireshark/tshark 并加入 PATH',
    frida: 'pip install frida-tools；需要授权设备/进程',
    adb: '安装 Android platform-tools 并加入 PATH',
    objdump: '安装 binutils（Windows 可用 MinGW/MSYS2）'
  };
  return hints[name] || null;
}

function buildGhidraArgs({ sample, projectDir, projectName = 'mars-rea', scriptPath, postScript }) {
  const args = [projectDir, projectName, '-import', sample, '-deleteProject'];
  if (postScript) args.push('-postScript', postScript);
  if (scriptPath) args.push('-scriptPath', scriptPath);
  return args;
}

function buildJadxArgs({ sample, outDir, noResources = true }) {
  const args = ['-d', outDir];
  if (noResources) args.push('--no-res');
  args.push(sample);
  return args;
}

function buildTsharkArgs({ sample, mode = 'protocol-hierarchy' }) {
  if (mode === 'protocol-hierarchy') return ['-r', sample, '-q', '-z', 'io,phs'];
  if (mode === 'json') return ['-r', sample, '-T', 'json'];
  if (mode === 'conversations') return ['-r', sample, '-q', '-z', 'conv,tcp'];
  return ['-r', sample];
}

function buildFridaArgs({ pid, script, target }) {
  const args = [];
  if (pid) args.push('-p', String(pid));
  else if (target) args.push('-f', String(target));
  if (script) args.push('-l', script);
  return args;
}

function preflight(name, options = {}) {
  const def = DEFS[name];
  if (!def) return Promise.resolve({ ok: false, checks: [], blocked_reason: 'TOOL_UNKNOWN' });
  return detect(name, options).then((info) => {
    const checks = [{ check: `${def.label} 可用`, ok: info.present, detail: info.present ? `${info.path} (${info.version})` : (installHint(name) || '未找到') }];
    return { ok: info.present, checks, blocked_reason: info.present ? null : 'TOOL_MISSING:' + name, tool: info };
  });
}

module.exports = {
  DEFS, toolNames, detect, status, execute, preflight, installHint,
  buildGhidraArgs, buildJadxArgs, buildTsharkArgs, buildFridaArgs
};

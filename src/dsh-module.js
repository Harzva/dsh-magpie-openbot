'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { fileURLToPath, pathToFileURL } = require('node:url');

/** DSH's subprocess needs physical package files rather than virtual ASAR paths. */
function resolveDshRuntimeModule(location) {
  let target = location === '@openbot/bot-agent-runtime' ? require.resolve(location) : location;
  if (typeof target === 'string' && target.startsWith('file:')) target = fileURLToPath(target);
  if (path.isAbsolute(target)) {
    if (/\.asar[\\/]/.test(target)) {
      target = target.replace(/\.asar([\\/])/, '.asar.unpacked$1');
      if (!fs.existsSync(target)) throw Object.assign(new Error('DSH 运行时未完整解包'), { code: 'DSH_RUNTIME_NOT_UNPACKED' });
    }
    return pathToFileURL(target).href;
  }
  return target;
}

module.exports = { resolveDshRuntimeModule };

function resolveDshNodeExecutable() {
  if (!process.versions.electron) return undefined;
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    throw Object.assign(new Error('此桌面平台尚未装配 DSH 所需的 Node 运行时'), { code: 'DSH_NODE_REQUIRED' });
  }
  let target;
  try { target = require.resolve('node-bin-darwin-arm64/bin/node'); }
  catch { throw Object.assign(new Error('DSH 所需的 Node 运行时未完整安装'), { code: 'DSH_NODE_REQUIRED' }); }
  target = target.replace(/\.asar([\\/])/, '.asar.unpacked$1');
  if (!fs.existsSync(target)) throw Object.assign(new Error('DSH 所需的 Node 运行时未完整解包'), { code: 'DSH_NODE_REQUIRED' });
  return target;
}

module.exports.resolveDshNodeExecutable = resolveDshNodeExecutable;

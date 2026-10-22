'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(file, fallback, validate) {
  const accept = validate || ((v) => v && typeof v === 'object');
  let missing = false;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!accept(value)) throw new Error('Invalid document');
    return { value, warning: '' };
  } catch (e) { missing = e.code === 'ENOENT'; }
  if (missing) return { value: fallback, warning: '' };
  try {
    const value = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
    if (!accept(value)) throw new Error('Invalid backup');
    return { value, warning: path.basename(file) + ' 无法读取，已恢复上一次有效备份。原文件仍保留。' };
  } catch (e) {
    return { value: fallback, warning: path.basename(file) + ' 无法读取；原文件已保留，请从备份恢复。' };
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (fs.existsSync(file)) {
      const prior = fs.readFileSync(file);
      let valid = false;
      try { JSON.parse(prior.toString('utf8')); valid = true; } catch (e) {}
      const backup = valid ? file + '.bak' : file + '.corrupt-' + Date.now();
      fs.writeFileSync(backup, prior, { mode: 0o600 });
      fs.chmodSync(backup, 0o600);
    }
    fs.renameSync(tmp, file);
    fs.chmodSync(file, 0o600);
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function validBotId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value) &&
    !['__proto__', 'constructor', 'prototype'].includes(value);
}

module.exports = { readJson, writeJson, validBotId };

'use strict';
// Admission copies bytes only. It never imports plugin code or runs package scripts.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const MAX = 32 * 1024 * 1024;
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
function reject(message) { throw new Error(`Local DSH bundle: ${message}`); }
function safeName(name) {
  if (!name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.split('/').some(x => !x || x === '.' || x === '..') || /^[A-Za-z]:/.test(name)) reject('unsafe path');
  if (name.split('/').some(x => ['node_modules', '.git'].includes(x))) reject('excluded directory');
  return name;
}
function directoryFiles(root) {
  const files = new Map(); let bytes = 0; let count = 0;
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === '.git' || name === 'node_modules') continue;
      const rel = safeName(prefix + name), target = path.join(dir, name), stat = fs.lstatSync(target);
      if (++count > 4000) reject('too many entries');
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink !== 1)) reject('links and special files forbidden');
      if (stat.isDirectory()) walk(target, rel + '/');
      else {
        if ((bytes += stat.size) > MAX) reject('size limit');
        const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try { const current = fs.fstatSync(fd); if (!current.isFile() || current.ino !== stat.ino || current.size !== stat.size) reject('source changed'); files.set(rel, fs.readFileSync(fd)); }
        finally { fs.closeSync(fd); }
      }
    }
  }
  walk(root); return files;
}
function tarFiles(compressed) {
  if (compressed.length > MAX) reject('archive size limit');
  const data = zlib.gunzipSync(compressed, { maxOutputLength: MAX });
  const files = new Map(), names = new Set(); let count = 0, ended = false;
  const str = b => b.toString('utf8').replace(/\0.*$/s, '');
  for (let offset = 0; offset + 512 <= data.length;) {
    const h = data.subarray(offset, offset + 512); offset += 512;
    if (h.every(x => x === 0)) { if (data.subarray(offset).some(x => x !== 0)) reject('data after archive end'); ended = true; break; }
    if (++count > 4000) reject('too many entries');
    const octal = b => { const s = str(b).trim(); if (!/^[0-7]+$/.test(s)) reject('invalid tar number'); return parseInt(s, 8); };
    const checksum = octal(h.subarray(148,156));
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== checksum) reject('tar checksum');
    const size = octal(h.subarray(124,136)), type = h[156];
    if (![0,48,53].includes(type) || str(h.subarray(157,257))) reject('archive links and special types forbidden');
    let name = str(h.subarray(0,100)); const prefix = str(h.subarray(345,500)); if (prefix) name = prefix + '/' + name;
    name = name.replace(/\/$/, ''); safeName(name);
    if (name !== 'package' && !name.startsWith('package/')) reject('archive needs package root');
    if (names.has(name)) reject('duplicate archive path'); names.add(name);
    if (size > MAX || offset + size > data.length || (type === 53 && size)) reject('invalid archive size');
    if (type !== 53) { if (name === 'package') reject('invalid package root'); files.set(name.slice(8), Buffer.from(data.subarray(offset,offset + size))); }
    offset += Math.ceil(size / 512) * 512;
  }
  if (!ended) reject('truncated archive');
  return files;
}
function treeDigest(files) { const h = crypto.createHash('sha256'); for (const [n,b] of [...files].sort(([a],[b]) => a.localeCompare(b))) { h.update(JSON.stringify([n,b.length])); h.update(b); } return h.digest('hex'); }
function entryFiles(manifest, files) {
  const targets = [];
  function visit(value) { if (typeof value === 'string') targets.push(value); else if (value && typeof value === 'object') Object.values(value).forEach(visit); else reject('invalid export'); }
  if (manifest.exports) visit(manifest.exports); else if (manifest.main) targets.push(manifest.main); else reject('built entry required');
  for (const target of targets) {
    if (!target.startsWith('./')) reject('export must be package relative');
    safeName(target.slice(2));
    if (target.includes('*')) { const [a,b,...rest] = target.slice(2).split('*'); if (rest.length || ![...files.keys()].some(n => n.startsWith(a) && n.endsWith(b))) reject('missing export files'); }
    else if (!files.has(target.slice(2))) reject('missing export file');
  }
  const root = typeof manifest.exports === 'object' && manifest.exports['.'] || manifest.exports || manifest.main;
  const pick = v => typeof v === 'string' ? v : v && (pick(v.import) || pick(v.default) || pick(v.require));
  const entry = pick(root); if (!entry || !/\.[cm]?js$/.test(entry)) reject('built JavaScript entry required');
  return entry.slice(2);
}
async function installLocalDshBundle({ sourcePath, storeRoot, runtimeModule, expectedPackageName, expectedVersion, expectedSourceSha256 } = {}) {
  if (!path.isAbsolute(sourcePath || '') || !path.isAbsolute(storeRoot || '')) reject('absolute paths required');
  const stat = fs.lstatSync(sourcePath); if (stat.isSymbolicLink()) reject('source link');
  const kind = stat.isDirectory() ? 'directory' : 'tgz';
  if (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX)) reject('invalid archive source');
  const raw = kind === 'tgz' ? fs.readFileSync(sourcePath) : null;
  const files = raw ? tarFiles(raw) : directoryFiles(sourcePath);
  const sourceSha256 = raw ? sha(raw) : treeDigest(files);
  if (expectedSourceSha256 && expectedSourceSha256 !== sourceSha256) reject('source digest pin mismatch');
  const manifest = JSON.parse(files.get('package.json')?.toString() || 'null'); if (!manifest) reject('package manifest required');
  if (expectedPackageName && expectedPackageName !== manifest.name || expectedVersion && expectedVersion !== manifest.version) reject('identity pin mismatch');
  const entry = entryFiles(manifest, files);
  // Conservative declaration evidence only, never an execution/capability claim.
  const code = files.get(entry).toString();
  const declarations = [...code.matchAll(/(?:var|let|const)\s+inject\s*=\s*(\[[^\]]*\])/g)];
  let requiredServices = [], requiredServicesEvidence = /\binject\b|export\s*\*|\\u[0-9a-f]{4}/i.test(code) ? 'unknown' : 'not-declared';
  if (declarations.length === 1 && /export\s*(?:\{[^}]*\binject\b|(?:const|let|var)\s+inject\b)/s.test(code)) {
    try {
      const literal = JSON.parse(declarations[0][1]);
      if (Array.isArray(literal) && literal.every(x => typeof x === 'string' && /^[A-Za-z][\w.-]{0,127}$/.test(x))) {
        requiredServices = literal;
        requiredServicesEvidence = 'static-literal-declaration';
      }
    } catch { /* Unsupported syntax is unknown metadata, not rejected code. */ }
  }
  const runtimeDependencies = {};
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (manifest[field] !== undefined) {
      const value = manifest[field];
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(x => typeof x !== 'string')) reject('invalid dependency manifest');
      runtimeDependencies[field] = { ...value };
    }
  }
  const runtimeDependenciesStatus = Object.values(runtimeDependencies).some(x => Object.keys(x).length) ? 'not-resolved' : 'none-declared';
  fs.mkdirSync(storeRoot, { recursive: true, mode: 0o700 });
  const storeStat = fs.lstatSync(storeRoot);
  if (!storeStat.isDirectory() || storeStat.isSymbolicLink() || fs.realpathSync(storeRoot) !== path.resolve(storeRoot) || (storeStat.mode & 0o077)) reject('store must be private and real');
  const stage = fs.mkdtempSync(path.join(storeRoot, '.admit-'));
  const stageIdentity = fs.lstatSync(stage);
  let ownedPath = stage;
  try {
    const bundle = path.join(stage,'bundle'); fs.mkdirSync(bundle, { mode: 0o700 });
    for (const [rel,bytes] of files) { const dest = path.join(bundle,rel); fs.mkdirSync(path.dirname(dest), {recursive:true,mode:0o700}); fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o400}); }
    const rt = runtimeModule || require('./bundle-fingerprint');
    const fingerprint = rt.fingerprintBundle(bundle,{version:manifest.version});
    // Re-read source after snapshot creation to reject concurrent mutation.
    const after = kind === 'tgz' ? sha(fs.readFileSync(sourcePath)) : treeDigest(directoryFiles(sourcePath));
    if (after !== sourceSha256) reject('source changed during admission');
    const id = crypto.randomUUID(), final = path.join(storeRoot,id);
    const receipt = { schema:1, sourceKind:kind, sourceSha256, packageName:fingerprint.packageName, version:fingerprint.version, bundleSha256:fingerprint.sha256, bundlePath:path.join(final,'bundle'), requiredServices, requiredServicesEvidence, runtimeDependencies, runtimeDependenciesStatus, entry };
    fs.writeFileSync(path.join(stage,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx',mode:0o400});
    function seal(dir) { for (const name of fs.readdirSync(dir)) { const p=path.join(dir,name); if(fs.lstatSync(p).isDirectory()) seal(p); } fs.chmodSync(dir,0o500); }
    // Keep the stage root writable until promotion: some filesystems require
    // it when renaming a directory. The containing store remains owner-only.
    seal(bundle);
    fs.renameSync(stage,final); ownedPath = final;
    fs.chmodSync(final,0o500);
    return receipt;
  } catch(error) {
    try {
      const current = fs.lstatSync(ownedPath);
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== stageIdentity.dev || current.ino !== stageIdentity.ino) reject('admission cleanup ownership changed');
      // Writable parents are needed to unlink sealed children. Unlock only
      // this admission's directories, without following links to other trees.
      function unlock(dir) {
        fs.chmodSync(dir,0o700);
        for (const name of fs.readdirSync(dir)) {
          const target = path.join(dir,name), stat = fs.lstatSync(target);
          if (stat.isDirectory() && !stat.isSymbolicLink()) unlock(target);
        }
      }
      unlock(ownedPath); fs.rmSync(ownedPath,{recursive:true,force:true});
    } catch(cleanupError) {
      // Cleanup must never replace the original admission failure.
      try { if (error && typeof error === 'object') Object.defineProperty(error,'cleanupError',{value:cleanupError,configurable:true}); } catch {}
    }
    throw error;
  }
}
module.exports = { installLocalDshBundle };

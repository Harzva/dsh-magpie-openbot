// Extracted from OpenBot BOT Agent runtime 0.6.0; MIT, OpenBot contributors.
const { createHash } = require('node:crypto');
const { lstatSync, readdirSync, readFileSync, realpathSync } = require('node:fs');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');

const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function invalid(message) {
  return Object.assign(new Error(message), { code: 'INVALID_BUNDLE' });
}

/**
 * Validate a trusted installed DSH bundle and fingerprint its own package files.
 * Dependencies in node_modules are excluded; registry integrity and the installer
 * lock are separate receipt fields. This does not turn plugin code into a sandbox.
 */
function fingerprintBundle(path, { version } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw invalid('A bundle needs an absolute directory.');
  const bundlePath = realpathSync(path);
  if (!lstatSync(bundlePath).isDirectory()) throw invalid('A bundle must be a directory.');
  let manifest;
  try { manifest = JSON.parse(readFileSync(join(bundlePath, 'package.json'), 'utf8')); }
  catch { throw invalid('A bundle needs a readable package manifest.'); }
  if (!PACKAGE.test(manifest.name ?? '') || !VERSION.test(manifest.version ?? '')) throw invalid('Invalid bundle package identity.');
  if (version !== undefined && version !== manifest.version) throw invalid('Bundle version does not match its pin.');
  const declared = manifest.dsh?.bundle?.patch;
  const patches = typeof declared === 'string' ? [declared] : declared;
  if (!Array.isArray(patches) || !patches.length || patches.some(patch => typeof patch !== 'string' || !patch)) {
    throw invalid('A bundle must declare dsh.bundle.patch.');
  }
  for (const patch of patches) {
    const target = resolve(bundlePath, patch);
    const rel = relative(bundlePath, target);
    if (isAbsolute(patch) || rel === '..' || rel.startsWith('..' + sep) || !rel) throw invalid('Bundle patch escapes its package.');
    const real = realpathSync(target);
    if (real !== target || !lstatSync(target).isFile()) throw invalid('Bundle patches must be regular package files.');
  }
  const hash = createHash('sha256');
  let files = 0, bytes = 0;
  function visit(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      if (name === 'node_modules' || name === '.git') continue;
      const target = join(directory, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const info = lstatSync(target);
      if (++files > 20000) throw invalid('Bundle contains too many files.');
      if (info.isDirectory()) {
        hash.update(`d:${Buffer.byteLength(rel)}:${rel}\n`);
        visit(target, rel);
      } else if (info.isFile()) {
        bytes += info.size;
        if (bytes > 256 * 1024 * 1024) throw invalid('Bundle files exceed the size limit.');
        const contents = readFileSync(target);
        hash.update(`f:${Buffer.byteLength(rel)}:${rel}:${contents.length}:`);
        hash.update(contents);
      } else {
        throw invalid('Bundle files cannot contain symbolic links or special files.');
      }
    }
  }
  visit(bundlePath);
  return { bundlePath, packageName: manifest.name, version: manifest.version, sha256: hash.digest('hex') };
}

module.exports = { fingerprintBundle };

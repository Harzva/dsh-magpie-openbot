'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { MagpieManager } = require('./magpie-manager');
const ARCHIVE = path.resolve(__dirname, '../vendor/dsh-x-magpie-0.7.2.tgz');
const ARCHIVE_SHA256 = '8f8b2c4ab1306c9789c5957e8b2b44a38950a15d2bb9b5e58189721616cc221e';
function invalid() { throw Object.assign(new Error('Invalid Magpie host operation or arguments.'), { code: 'MAGPIE_INVALID' }); }
function args(input, allowed) {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  for (const key of Reflect.ownKeys(input)) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!allowed.includes(key) || !descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
  }
  return input;
}
/** One shared manager for approved human and Agent callers. Authorization belongs to the host. */
function createMagpieHost({ home, config, assertOpen = () => {} } = {}) {
  if (typeof home !== 'string' || !path.isAbsolute(home) || typeof config?.upsertProfile !== 'function' || typeof assertOpen !== 'function') invalid();
  const manager = new MagpieManager({ home, config, assertOpen });
  return Object.freeze({
    async invoke(operation, input) {
      assertOpen();
      switch (operation) {
        case 'status': args(input, []); return manager.refresh();
        case 'install': {
          args(input, []);
          const stat = fs.lstatSync(ARCHIVE);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024 ||
              createHash('sha256').update(fs.readFileSync(ARCHIVE)).digest('hex') !== ARCHIVE_SHA256) {
            throw Object.assign(new Error('Bundled Magpie archive does not match the original release.'), { code: 'MAGPIE_CHANGED' });
          }
          return manager.install({ sourcePath: ARCHIVE });
        }
        case 'configure': {
          const value = args(input, ['gatewayUrl', 'apiKey']);
          if (!Object.keys(value).length || Object.hasOwn(value, 'gatewayUrl') && (typeof value.gatewayUrl !== 'string' || !value.gatewayUrl) ||
              Object.hasOwn(value, 'apiKey') && (typeof value.apiKey !== 'string' || value.apiKey.length > 16384 || /[\r\n\0]/.test(value.apiKey))) invalid();
          return manager.configure({ ...value });
        }
        case 'enable': args(input, []); return manager.enable();
        case 'disable': args(input, []); return manager.disable();
        case 'sync': args(input, []); return manager.sync();
        case 'useModel': {
          const value = args(input, ['modelId']);
          if (typeof value.modelId !== 'string' || !value.modelId.trim() || value.modelId.length > 4096) invalid();
          return manager.useModel({ modelId: value.modelId });
        }
        default: invalid();
      }
    },
    isBusy: () => manager.isBusy(),
    close: () => manager.close()
  });
}
module.exports = { createMagpieHost };

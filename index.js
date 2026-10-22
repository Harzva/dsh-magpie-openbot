'use strict';
const { MagpieManager } = require('./src/magpie-manager');
const { installLocalDshBundle } = require('./src/local-dsh-bundle');
const { createMagpieHost } = require('./src/host');
module.exports = { MagpieManager, installLocalDshBundle, createMagpieHost };

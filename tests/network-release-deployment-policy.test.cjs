'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert.deepEqual(config, {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  git: { deploymentEnabled: {
    'codex/es-network-server-v01-release': false,
    'codex/es-network-commercial-addon-v01': false,
  } },
});
// Vercel's documented default for unspecified branches is true. Do not
// disable main, enable a Preview override, or change env/build/alias settings.
assert.equal(Object.hasOwn(config.git.deploymentEnabled, 'main'), false);
assert.equal(Object.keys(config.git.deploymentEnabled).some(key => /[*?{}]/.test(key)), false);
console.log('PASS exact Network server and commercial Add-on branches automatic deployment disabled; main and other branches unchanged');

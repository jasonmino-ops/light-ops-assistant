'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert.deepEqual(config, {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  crons: [{ path: '/api/cron/product-sales-daily', schedule: '10 17 * * *' }],
  git: { deploymentEnabled: {
    main: false,
    release: true,
    'codex/print-rc7-preflight-governance': false,
    'codex/es-network-server-v01-release': false,
    'codex/es-network-commercial-addon-v01': false,
    'codex/es-network-commercial-discovery-v01': false,
    'codex/es-network-commercial-cold-conversion-v01': false,
  } },
});
// The Founder-controlled Vercel setting must track `release` as the Production
// Branch. Disabling `main` here also prevents it becoming an automatic Preview
// branch after that switch. Unspecified branches retain Vercel's true default.
assert.equal(config.git.deploymentEnabled.main, false);
assert.equal(config.git.deploymentEnabled.release, true);
assert.equal(config.git.deploymentEnabled['codex/print-rc7-preflight-governance'], false);
assert.equal(Object.keys(config.git.deploymentEnabled).some(key => /[*?{}]/.test(key)), false);
console.log('PASS main automatic deployment disabled, release enabled, exact governance/Network branch exclusions preserved');

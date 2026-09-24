'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert.deepEqual(config, {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  crons: [
    { path: '/api/cron/product-sales-daily', schedule: '10 17 * * *' },
    { path: '/api/cron/product-import-staging-cleanup', schedule: '35 17 * * *' },
  ],
  git: { deploymentEnabled: {
    '**': false,
    main: false,
    release: true,
  } },
});
// The Founder-controlled Vercel setting must track `release` as the Production
// Branch. The wildcard deny keeps every other branch from creating a deployment;
// the explicit release allow is the only automatic deployment path.
assert.equal(config.git.deploymentEnabled['**'], false);
assert.equal(config.git.deploymentEnabled.main, false);
assert.equal(config.git.deploymentEnabled.release, true);
assert.deepEqual(Object.keys(config.git.deploymentEnabled), ['**', 'main', 'release']);
console.log('PASS wildcard deployment deny, main disabled, release enabled');

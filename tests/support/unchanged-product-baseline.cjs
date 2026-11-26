// Proposed exact frozen-test successor; no authorization or release effect.
'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const BASELINE = 'a693491afb5987a9d013e8098e24371664bf3e8e'
const CHANGES = new Set([
  'scripts/test/run-root-full-suite.mjs',
  'scripts/test/run-root-full-suite.test.mjs',
  'scripts/test/check-governance-evidence-reuse.mjs',
  'scripts/test/check-governance-evidence-reuse.test.mjs',
  'docs/workflows/STORE_ASSISTANT_DEV_WORKFLOW_SKILL_V1.md',
  'docs/workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V2.md',
  'docs/workflows/E_SHOP_TASK_STATE_TEMPLATE_V1.md',
  'tests/cashier-realtime-integration.test.ts',
  'tests/es-tray-device-print-contract.test.ts',
  'tests/v3-reprint-recovery.test.ts',
  'tests/native-inventory-m1-successor.test.cjs',
  'tests/es-tray-desktop-pos-entry.test.ts',
  'tests/support/unchanged-product-baseline.cjs',
  'tests/support/unchanged-product-baseline.test.cjs',
])
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const split = bytes => bytes.toString('utf8').split('\0').filter(Boolean)
// Fixed observation-only fixture paths in the existing evidence directory.
// These are examples of evidence recording, never grants or authority records.
const OBSERVATIONS = new Map([
  ['docs/change-gates/evidence/ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01/observation.json', 'ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01'],
  ['docs/change-gates/evidence/ES-PRINT-DEVICE-TAKEOVER/observation.json', 'ES-PRINT-DEVICE-TAKEOVER'],
])
const documentary = path => OBSERVATIONS.has(path)
const validObservation = (path, bytes) => {
  if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) return false
  const record = JSON.parse(bytes.toString('utf8'))
  return record && !Array.isArray(record) &&
    Object.keys(record).sort().join(',') === 'observation,recordType,taskId' &&
    record.recordType === 'OBSERVATION_ONLY' && record.taskId === OBSERVATIONS.get(path) &&
    typeof record.observation === 'string'
}

// This establishes only unchanged test inputs against one merged snapshot.
// It never imports another task's grant, admits a changed runtime, rewrites a
// historical result, certifies an unexecuted assertion, or authorizes a write.
function readUnchangedProductBaseline(root) {
  if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR',
    'GIT_NAMESPACE', 'GIT_GRAFT_FILE'].some(key => process.env[key])) return null
  try {
    // Reused from ES-DELIVERY-EFFICIENCY-01 P0 gitFacts: do not inherit
    // Git config injection, filters, lazy fetching or executable fsmonitor.
    const git = (...args) => execFileSync('git', ['--no-replace-objects',
      '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
        GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1',
        GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
      },
    })
    const text = (...args) => git(...args).toString('utf8').trim()
    const configKeys = text('config', '--name-only', '--list').split('\n')
    if (configKeys.some(key => /^(filter\.|include(?:if)?\.|extensions\.partialclone$|remote\..+\.promisor$|diff\.|core\.attributesfile$)/i.test(key))) return null
    if (existsSync(resolve(root, text('rev-parse', '--git-path', 'info/attributes')))) return null
    const main = text('rev-parse', '--verify', 'refs/remotes/origin/main')
    git('merge-base', '--is-ancestor', BASELINE, main)
    git('merge-base', '--is-ancestor', BASELINE, 'HEAD')
    if (existsSync(resolve(root, text('rev-parse', '--git-path', 'info/grafts')))
      || text('for-each-ref', '--format=%(refname)', 'refs/replace/')
      || /^[a-zS] /m.test(text('ls-files', '-v'))) return null

    // origin/main is an observed governance head, not this product input.
    // Its policy, authority, runtime and integration compatibility are NOT
    // assessed here. Latest-main drift cannot rewrite the local snapshot fact.

    // Check committed, staged, working and new paths independently. Restoring
    // a working file cannot hide a staged or committed runtime modification.
    const paths = [...new Set([
      ...split(git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', BASELINE, 'HEAD')),
      ...split(git('diff', '--cached', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', BASELINE)),
      ...split(git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', BASELINE)),
      // Ignore rules are not source boundaries: enumerate ignored and
      // unignored new files alike. Exclude only these root non-input caches.
      ...split(git('ls-files', '--others', '-z', '--',
        ':(top,exclude,literal)node_modules', ':(top,exclude,literal).next',
        ':(top,exclude,literal).task-state')),
    ])]
    if (paths.some(path => !CHANGES.has(path) && !documentary(path))) return null
    for (const path of paths) {
      const file = resolve(root, path)
      if (!existsSync(file) || !lstatSync(file).isFile()) return null
      if (documentary(path)) {
        if (!validObservation(path, readFileSync(file))) return null
        // A restored observation file cannot conceal a staged/committed grant.
        const headEntry = text('ls-tree', 'HEAD', '--', path)
        if (headEntry && (!headEntry.startsWith('100644 blob ') ||
          !validObservation(path, git('show', `HEAD:${path}`)))) return null
        const indexEntry = text('ls-files', '--stage', '--', path)
        if (indexEntry && (!indexEntry.startsWith('100644 ') ||
          !validObservation(path, git('show', `:${path}`)))) return null
      }
    }
    // Hash raw fixed inputs directly, independently of Git's index stat
    // cache, clean filters, attributes or line-ending normalization. This is
    // deliberately limited to the pinned snapshot, not a new authority store.
    for (const entry of split(git('ls-tree', '-r', '-z', BASELINE))) {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry)
      if (!match) return null
      const [, mode, objectId, path] = match
      if (CHANGES.has(path) || documentary(path)) continue
      const file = resolve(root, path)
      const stat = lstatSync(file)
      if (!stat.isFile() || Boolean(stat.mode & 0o111) !== (mode === '100755')) return null
      const bytes = readFileSync(file)
      const actualObjectId = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
      if (actualObjectId !== objectId) return null
    }
    const blob = path => git('show', `${BASELINE}:${path}`)
    return {
      baseline: BASELINE,
      governanceHead: main,
      governanceStatus: 'NOT_ASSESSED',
      authorizationStatus: 'NOT_ASSESSED',
      productInputStatus: 'UNCHANGED_PINNED_SNAPSHOT',
      cashierHash: sha256(blob('app/cashier/page.tsx')),
      recordsHash: sha256(blob('app/records/page.tsx')),
      candidatePaths: paths,
    }
  } catch {
    return null
  }
}

module.exports = { BASELINE, readUnchangedProductBaseline }

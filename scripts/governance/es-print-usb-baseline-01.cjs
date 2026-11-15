const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const REGISTRATION = 'd95fc930dfaf6169961f60ae5fcb1faca547c896'
const PRODUCT = 'c50bd967c59452b3ecae602f0624dccf10244127'
const RECORD = 'docs/freezes/ES-PRINT-USB-BASELINE-01.md'
const ACTIVATION = 'docs/change-gates/ES-PRINT-USB-BASELINE-01-EXECUTABLE-SUCCESSOR.json'
const REQUEST_SHA256 = 'a53cbad30f822934cfac20af9182871fd1dfa5402a07e6b7c78b0b05fa57c44a'
const RECORD_SHA256 = 'a566cd83b9feffaeeac0a8566fcccfe10925d0956a0ab02227dc46808598799f'
const GOVERNANCE_PATHS = [
  'desktop/scripts/release-foundation.mjs',
  'desktop/tests/es-print-usb-baseline-01.test.ts',
  'scripts/governance/es-print-usb-baseline-01.cjs',
  'tests/cashier-realtime-integration.test.ts',
]

const HISTORICAL_GRANTS = new Map([
  ...[
    'prisma/migrations/20261005120000_add_customer_order_fulfillment_intent/migration.sql',
    'prisma/migrations/20261006160000_add_customer_order_render_dispatch/migration.sql',
    'prisma/migrations/20261007090000_add_customer_order_submission_idempotency/migration.sql',
    'app/menu/page.tsx',
  ].map(path => [path, ['ES-H5-ORDER-FULFILLMENT-IMPLEMENTATION-01', 'MIGRATION-ATOMICITY-01']]),
  ['prisma/migrations/20261009090000_add_customer_order_fulfillment_purpose/migration.sql', ['ES-H5-THREE-TICKET-FULFILLMENT-01']],
  ['prisma/migrations/20261010_es_dine_in_01/migration.sql', ['ES-DINE-IN-01']],
  ['prisma/migrations/20261014000000_add_desktop_print_child_identity/migration.sql', ['ES-PRINT-NEW-STORE-NETWORK-ONBOARDING-01', 'M4-DESKTOP-PRINT-CHILD-IDENTITY-26']],
  ...[
    'prisma/migrations/20261101090000_add_retail_multi_unit/migration.sql',
    'prisma/schema.prisma',
    'app/api/sales/lookup/route.ts',
    'app/api/sales/route.ts',
    'app/records/page.tsx',
  ].map(path => [path, ['ES-RETAIL-MULTI-UNIT-01']]),
  ['app/sale/page.tsx', ['ES-PRODUCT-COUNT-LIMIT-01']],
  ['app/cashier/page.tsx', ['ES-PRODUCT-COUNT-LIMIT-01']],
])

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const lines = text => text.trim().split('\n').filter(Boolean)
const samePaths = (actual, expected) =>
  actual.length === expected.length && new Set(actual).size === actual.length && actual.every(path => expected.includes(path))

function evaluateUsbFrontSuccessor(readGit, { committedDigest, worktreeDigest }) {
  const git = (...args) => readGit(...args).toString('utf8').trim()
  const changed = (from, to) => lines(git('diff', '--no-renames', '--name-only', from, to))
  const remoteMain = git('rev-parse', '--verify', 'refs/remotes/origin/main')
  const [head, firstParent, secondParent, ...otherParents] = git('rev-list', '--parents', '-1', 'HEAD').split(' ')
  // Use the same exact graph for a pre-merge preview and for a Windows
  // release checkout at that integration commit. Later main commits expire it.
  const trustedMain = remoteMain === head ? firstParent : remoteMain
  if (!trustedMain || firstParent !== trustedMain || secondParent !== PRODUCT || otherParents.length ||
      git('status', '--porcelain=v1', '--untracked-files=all') !== '' ||
      /^[a-zS] /m.test(git('ls-files', '-v'))) return null

  // The declarative registration and a locally modified checker cannot
  // activate the successor. Trusted main must carry the exact separate grant.
  if (trustedMain === REGISTRATION) return null
  const activation = JSON.parse(git('show', `${trustedMain}:${ACTIVATION}`))
  const executable = activation.executableCommit
  if (activation.schemaVersion !== 1 || activation.taskId !== 'ES-PRINT-USB-BASELINE-01' ||
      activation.status !== 'ACTIVE' || activation.approvedBy !== 'Founder' ||
      activation.registrationCommit !== REGISTRATION || activation.productCommit !== PRODUCT ||
      activation.requestSha256 !== REQUEST_SHA256 || !/^[a-f0-9]{40}$/.test(executable) ||
      typeof activation.deadlineExclusive !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(activation.deadlineExclusive) ||
      !(Date.parse(activation.deadlineExclusive) > Date.now()) ||
      git('rev-list', '--parents', '-1', trustedMain) !== `${trustedMain} ${executable}` ||
      git('rev-list', '--parents', '-1', executable) !== `${executable} ${REGISTRATION}` ||
      git('diff', '--no-renames', '--name-status', executable, trustedMain) !== `A\t${ACTIVATION}` ||
      !samePaths(changed(REGISTRATION, executable), GOVERNANCE_PATHS) ||
      !samePaths(Object.keys(activation.executablePathsSha256 ?? {}), GOVERNANCE_PATHS)) return null
  for (const path of GOVERNANCE_PATHS) {
    const digest = activation.executablePathsSha256[path]
    if (!/^[a-f0-9]{64}$/.test(digest) || committedDigest(executable, path) !== digest ||
        committedDigest(trustedMain, path) !== digest || worktreeDigest(path) !== digest) return null
  }

  const recordBytes = readGit('show', `${trustedMain}:${RECORD}`)
  if (sha256(recordBytes) !== RECORD_SHA256) return null
  const record = recordBytes.toString('utf8')
  const product = [...record.matchAll(/^\| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
  const productPaths = product.map(([, path]) => path)
  if (productPaths.length !== 8 || !samePaths(changed(trustedMain, head), productPaths)) return null
  for (const [, path, digest] of product) {
    if (committedDigest(PRODUCT, path) !== digest || committedDigest(head, path) !== digest ||
        worktreeDigest(path) !== digest) return null
  }

  const anchors = new Map([...record.matchAll(/^\| ([^|]+) \| `([a-f0-9]{40})` \| (\d+) \|$/gm)]
    .map(([, group, anchor, count]) => [group, { anchor, count: Number(count), entries: [] }]))
  const historical = [...record.matchAll(/^\| ([^|]+) \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
  if (anchors.size !== 4 || historical.length !== 16) return null
  for (const [, group, path, digest] of historical) {
    if (!anchors.has(group)) return null
    anchors.get(group).entries.push({ path, digest })
  }
  for (const { count, entries } of anchors.values()) {
    if (count !== entries.length || new Set(entries.map(({ path }) => path)).size !== count) return null
  }
  const historyDigests = new Map(historical.map(([, , path, digest]) => [path, digest]))
  const activeHistory = Object.entries(activation.historicalPathsSha256 ?? {})
  if (historyDigests.size !== 16 || activeHistory.some(([path, digest]) => historyDigests.get(path) !== digest)) return null
  const activeHistoryPaths = new Set(activeHistory.map(([path]) => path))

  function historicalStatus(path, digest) {
    if (committedDigest(head, path) !== digest || committedDigest(trustedMain, path) !== digest ||
        worktreeDigest(path) !== digest) return 'BYTE_MISMATCH'
    if (path === 'app/home/page.tsx') return 'DRAFT_PENDING'
    const binding = HISTORICAL_GRANTS.get(path)
    if (!binding) return 'NO_ACTIVE_PATH_GRANT'

    const [task, authorizationId] = binding
    const registry = JSON.parse(git('show', `${trustedMain}:docs/change-gates/exceptions/${task}.json`))
    const matches = authorizationId
      ? (registry.additionalAuthorizations ?? []).filter(item => item.authorizationId === authorizationId)
      : [registry]
    const grant = matches[0]
    if (registry.taskId !== task || matches.length !== 1 || grant?.approvedBy !== 'Founder' ||
        (!Array.isArray(grant.authorizedPaths) || !grant.authorizedPaths.includes(path)) || grant.authorizedPathSha256?.[path] !== digest) return 'GRANT_MISMATCH'
    if (grant.status === 'CLOSED' || grant.featureMergeCommitSha) return 'HISTORICAL_CLOSED'
    if (grant.status !== 'ACTIVE') return 'GRANT_NOT_ACTIVE'
    for (const expiry of [grant.expiresAt, grant.deadlineExclusive]) {
      if (expiry !== undefined && !(Date.parse(expiry) > Date.now())) return 'GRANT_EXPIRED'
    }
    // The original grant is historical evidence, not this task's authority.
    return activeHistoryPaths.has(path) ? 'ACTIVE_EXACT_MATCH' : 'SUCCESSOR_PATH_NOT_ACTIVE'
  }

  return {
    productPaths: new Set(productPaths),
    evaluateReleaseGroup(label, anchor, groupPaths) {
      const group = anchors.get(label)
      if (!group || group.anchor !== anchor) return null
      const actual = lines(git('diff', '--no-renames', '--name-only', anchor, head, '--', ...groupPaths))
      const expected = group.entries.map(({ path }) => path)
      const paths = group.entries.map(({ path, digest }) => {
        if (!actual.includes(path)) return { path, status: 'EXPECTED_DELTA_MISSING' }
        try {
          return { path, status: historicalStatus(path, digest) }
        } catch {
          return { path, status: 'EVIDENCE_UNREADABLE' }
        }
      })
      for (const path of actual.filter(path => !expected.includes(path))) paths.push({ path, status: 'UNREGISTERED_DELTA' })
      return {
        admitted: samePaths(actual, expected) && paths.every(({ status }) => status === 'ACTIVE_EXACT_MATCH'),
        paths,
      }
    },
  }
}

function readUsbFrontSuccessor(root) {
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return evaluateUsbFrontSuccessor(git, {
      committedDigest: (ref, path) => sha256(git('show', `${ref}:${path}`)),
      worktreeDigest: path => sha256(readFileSync(resolve(root, path))),
    })
  } catch {
    // Missing or unreadable provenance leaves the original frozen checks in force.
    return null
  }
}

module.exports = { evaluateUsbFrontSuccessor, readUsbFrontSuccessor }

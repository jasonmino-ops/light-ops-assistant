'use strict'

const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')

const BASE = '24528f1e346b2c83913bdfa0a841b5e0ca6a6fd4'
const TREE = '50ee7db6f640d9a7cc6b22e81280769faae1d4fa'
const PATCH = '18728415d76510b19ed18f570463d2e9985547cac61d6cd64e33061b480811aa'
const TASK = 'ES-NATIVE-INVENTORY-V1-SALES-ROLLOUT-01'
const BRANCH = 'codex/es-native-inventory-sales-rollout'
const SCOPE = `docs/change-gates/exceptions/${TASK}.json`
const RECORD = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-SALES-ROLLOUT-SUCCESSOR.json'
const REVIEW = 'docs/freezes/ES-NATIVE-INVENTORY-V1-SALES-ROLLOUT-REVIEW.md'
const PRIOR_REVIEW = 'docs/freezes/ES-NATIVE-INVENTORY-V1-SALES-ROLLOUT-PRIOR-REVIEW.md'
const MAIN_VERIFIER = 'scripts/governance/es-native-inventory-m1-main-successor.cjs'
const SUCCESSOR = 'scripts/governance/es-native-inventory-sales-rollout-successor.cjs'
const FROZEN_APIS = [
  'app/api/native-inventory/[resource]/route.ts',
  'app/api/native-inventory/desktop-operator/route.ts',
  'app/api/public/orders/route.ts',
]
const INTEGRATION_MANIFEST = 'scripts/test/manifests/root-integration-tests.json'
const PRISMA = [
  'prisma/migrations/20261115120000_separate_native_inventory_sales/migration.sql',
  'prisma/schema.prisma',
]
const GOVERNANCE = [SCOPE, RECORD, REVIEW, PRIOR_REVIEW, MAIN_VERIFIER, SUCCESSOR]
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const samePaths = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(path => b.includes(path))

function verifySalesRollout({ git, text, blob, parents, pathsBetween, matches, atHead, trusted, head, branch, root }) {
  const commits = (from, to) => text('rev-list', '--first-parent', '--reverse', `${from}..${to}`).split('\n').filter(Boolean)
  const [registration, product, closure] = commits(BASE, head)
  if (!registration || parents(registration).join(' ') !== BASE ||
      !samePaths(pathsBetween(BASE, registration), GOVERNANCE)) return null
  git('merge-base', '--is-ancestor', registration, trusted)
  const recordBytes = blob(registration, RECORD)
  const record = JSON.parse(recordBytes)
  if (!atHead(RECORD, sha(recordBytes)) || record.status !== 'ACTIVE' || record.approvedBy !== 'Founder' ||
      record.schemaVersion !== 1 || record.taskId !== 'ES-NATIVE-INVENTORY-V1' || record.scopeTaskId !== TASK ||
      record.trustedOriginMainSha !== BASE ||
      record.candidateTree !== TREE || record.candidatePatchSha256 !== PATCH ||
      record.approvalPackageSha256 !== '16ad90a3771d07846cfce7d888b8b2f23a3746b487e99a8cd7be147d28834bfd' ||
      record.reviewDocument !== REVIEW || record.governancePathsSha256[REVIEW] !==
        'b87e239cc0aff4f4de7154df4996ee3cc92a6a63a03d5ed9c680386cc54ff4a4' ||
      !samePaths(Object.keys(record.governancePathsSha256), [REVIEW, PRIOR_REVIEW, MAIN_VERIFIER, SUCCESSOR]) ||
      !samePaths(Object.keys(record.frozenSuccessor), FROZEN_APIS) ||
      !samePaths(Object.keys(record.frozenManifestSupplement), [INTEGRATION_MANIFEST])) return null
  for (const [path, digest] of Object.entries(record.governancePathsSha256)) {
    if (!matches(registration, path, digest) || !atHead(path, digest)) return null
  }

  const activeBytes = blob(registration, SCOPE)
  if (sha(activeBytes) !== 'b9a906ba2c8240a2aa9f7ea38f47b06f99bc82f0f6fe38affd6f60ef532b4078') return null
  const active = JSON.parse(activeBytes)
  const { evaluateFile, validateException } = require('../guards/check-change-scope.js')
  const parsed = validateException(active, root)
  const config = JSON.parse(blob(BASE, 'docs/change-gates/gate-config.json'))
  if (active.status !== 'ACTIVE' || active.baseOriginMainSha !== BASE ||
      active.featureBranch !== BRANCH || !samePaths(active.authorizedPaths, PRISMA)) return null

  const hashes = record.candidatePathsSha256
  if (Object.keys(hashes).length !== 11) return null
  const manifest = record.frozenManifestSupplement[INTEGRATION_MANIFEST]
  if (manifest.previousSha256 !== '23fcb97dee9ed3119d4991087c73b782fa977bf6b03832c774a795eb19fd3ce5' ||
      manifest.candidateSha256 !== '8c855abc582121055bc5c48be944fb8c08be3e081695ea18cdd527747c7145e9' ||
      !matches(BASE, INTEGRATION_MANIFEST, manifest.previousSha256) ||
      hashes[INTEGRATION_MANIFEST] !== manifest.candidateSha256) return null
  for (const path of FROZEN_APIS) {
    const pair = record.frozenSuccessor[path]
    if (!matches(BASE, path, pair.previousSha256) || hashes[path] !== pair.candidateSha256) return null
  }

  const successors = new Map([[MAIN_VERIFIER, record.governancePathsSha256[MAIN_VERIFIER]]])
  const accepted = new Set([registration])
  if (!product) {
    if (head !== registration || trusted !== registration || !atHead(SCOPE, sha(activeBytes))) return null
    return { successors, accepted }
  }

  if (parents(product).join(' ') !== registration || !samePaths(pathsBetween(registration, product), Object.keys(hashes))) return null
  const patch = git('diff', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv',
    '--src-prefix=a/', '--dst-prefix=b/', registration, product)
  if (sha(patch) !== PATCH ||
      Object.entries(hashes).some(([path, digest]) => !matches(product, path, digest))) return null
  for (const path of PRISMA) {
    if (!evaluateFile({
      filePath: path, repoRoot: root, config, currentBranch: BRANCH, taskId: TASK, exception: parsed,
      contentHashResolver: file => sha(blob(product, file)),
    }).allowed) return null
  }
  for (const path of [...FROZEN_APIS, ...PRISMA, INTEGRATION_MANIFEST]) {
    if (!atHead(path, hashes[path])) return null
    successors.set(path, hashes[path])
  }
  accepted.add(product)

  if (!closure) {
    if (head !== product || trusted !== registration || branch !== BRANCH || !atHead(SCOPE, sha(activeBytes))) return null
    return { successors, accepted }
  }

  if (parents(closure).join(' ') !== product || !samePaths(pathsBetween(product, closure), [SCOPE])) return null
  git('merge-base', '--is-ancestor', closure, trusted)
  const closedBytes = blob(closure, SCOPE)
  const closed = JSON.parse(closedBytes)
  const { closedAt, featureMergeCommitSha, ...closedFields } = closed
  if (closed.status !== 'CLOSED' || featureMergeCommitSha !== product ||
      Date.parse(closedAt) !== Number(text('show', '-s', '--format=%ct', closure)) * 1000 ||
      !isDeepStrictEqual({ ...closedFields, status: 'ACTIVE' }, active) ||
      !atHead(SCOPE, sha(closedBytes))) return null
  validateException(closed, root)
  accepted.add(closure)

  const protectedPaths = new Set([...GOVERNANCE, ...FROZEN_APIS, ...PRISMA, INTEGRATION_MANIFEST].map(path => path.toLowerCase()))
  for (const line of text('rev-list', '--parents', `${closure}..${head}`).split('\n').filter(Boolean)) {
    const [commit, parent] = line.split(' ')
    if (!parent || pathsBetween(parent, commit).some(path => protectedPaths.has(path.toLowerCase()))) return null
  }
  return { successors, accepted }
}

module.exports = { verifySalesRollout }

'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const TASK = 'ES-NATIVE-INVENTORY-V1'
const ACTIVATION = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-FROZEN-SUCCESSOR.json'
const SCOPE = 'docs/change-gates/exceptions/ES-NATIVE-INVENTORY-V1.json'
const CONFIG = 'docs/change-gates/gate-config.json'
const REVIEW = 'docs/freezes/ES-NATIVE-INVENTORY-V1-M1-REVIEW.md'
const DESKTOP_POLICY = 'desktop/scripts/release-foundation.mjs'
const GUARD = 'scripts/guards/check-change-scope.js'
const MANIFEST = 'scripts/governance/es-native-inventory-m1-manifest.json'
const MANIFEST_SHA = '507de9f3e4c55f4dbf32be146eeb5b8702fb515e56d24a9cbaa6179337156ff1'
const INTEGRATION_MANIFEST = 'scripts/test/manifests/root-integration-tests.json'
const CASHIER = 'app/cashier/page.tsx'
const SCANNER = 'app/sale/page.tsx'
const EXECUTABLES = [
  MANIFEST,
  REVIEW,
  DESKTOP_POLICY,
  'scripts/governance/es-native-inventory-m1-successor.cjs',
  'scripts/test/manifests/root-core-tests.json',
  'tests/native-inventory-m1-successor.test.cjs',
  'tests/support/native-inventory-payment-contract.cjs',
  'tests/cashier-realtime-integration.test.ts',
  'tests/es-tray-device-print-contract.test.ts',
  'tests/es-tray-desktop-pos-entry.test.ts',
  'tests/v3-reprint-recovery.test.ts',
  SCOPE,
]
const KEYS = ['schemaVersion', 'taskId', 'status', 'approvedBy', 'reviewedBy', 'reviewSha256',
  'deadlineExclusive', 'manifestSha256', 'candidatePatchSha256', 'integrationManifestSha256', 'executablePathsSha256']
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const samePaths = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(path => b.includes(path))
const lines = text => text.split('\n').filter(Boolean)

function readOriginalNativeInventoryM1Successor(root) {
  if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'].some(key => process.env[key])) return null
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const text = (...args) => git(...args).toString('utf8').trim()
    const blob = (ref, path) => git('show', `${ref}:${path}`)
    const diffPaths = (base, head, ...options) =>
      lines(text('diff', '--no-renames', '--name-only', ...options, base, head))
    const patch = (base, head, paths) => git('diff', '--binary', '--full-index', '--no-renames',
      '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', base, head, '--', ...paths)
    const parents = ref => text('rev-list', '--parents', '-1', ref).split(' ').slice(1)
    const workingDigest = path => {
      const file = resolve(root, path)
      return lstatSync(file).isFile() ? sha(readFileSync(file)) : null
    }
    const atHead = (path, digest) => validSha(digest) &&
      text('ls-tree', 'HEAD', '--', path).startsWith('100644 blob ') &&
      sha(blob('HEAD', path)) === digest && sha(blob('', path)) === digest && workingDigest(path) === digest

    const main = text('rev-parse', '--verify', 'refs/remotes/origin/main')
    const head = text('rev-parse', '--verify', 'HEAD')
    const manifestBytes = blob(main, MANIFEST)
    if (sha(manifestBytes) !== MANIFEST_SHA) return null
    const manifest = JSON.parse(manifestBytes)
    if (text('branch', '--show-current') !== manifest.featureBranch ||
        text('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none') ||
        /^[a-zS] /m.test(text('ls-files', '-v'))) return null

    const activationBytes = blob(main, ACTIVATION)
    const activation = JSON.parse(activationBytes)
    const deadline = Date.parse(activation.deadlineExclusive)
    if (!samePaths(Object.keys(activation), KEYS) || activation.schemaVersion !== 1 ||
        activation.taskId !== TASK || activation.status !== 'ACTIVE' || activation.approvedBy !== 'Founder' ||
        typeof activation.reviewedBy !== 'string' || !activation.reviewedBy.trim() ||
        !validSha(activation.reviewSha256) ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(activation.deadlineExclusive) ||
        !Number.isFinite(deadline) || new Date(deadline).toISOString().replace('.000Z', 'Z') !== activation.deadlineExclusive ||
        deadline <= Date.now() || sha(blob(main, REVIEW)) !== activation.reviewSha256 ||
        activation.manifestSha256 !== MANIFEST_SHA ||
        activation.candidatePatchSha256 !== manifest.sealedCandidatePatchSha256 ||
        !samePaths(Object.keys(activation.executablePathsSha256), EXECUTABLES) ||
        parents(main).join(' ') !== manifest.trustedOriginMainSha ||
        !samePaths(diffPaths(manifest.trustedOriginMainSha, main), [...EXECUTABLES, ACTIVATION]) ||
        !atHead(ACTIVATION, sha(activationBytes))) return null

    for (const path of EXECUTABLES) {
      const digest = activation.executablePathsSha256[path]
      if (sha(blob(main, path)) !== digest || !atHead(path, digest)) return null
    }
    for (const path of [CONFIG, GUARD]) {
      if (!atHead(path, sha(blob(manifest.trustedOriginMainSha, path)))) return null
    }

    const scope = JSON.parse(blob(main, SCOPE))
    const priorScope = JSON.parse(blob(manifest.trustedOriginMainSha, SCOPE))
    const mutableScopeFields = new Set(['authorizedPaths', 'authorizedPathSha256', 'sealedCandidatePatchSha256', 'approvalSource'])
    const stableScope = record => Object.fromEntries(Object.entries(record).filter(([key]) => !mutableScopeFields.has(key)))
    if (JSON.stringify(stableScope(scope)) !== JSON.stringify(stableScope(priorScope))) return null
    const allowed = { ...manifest.existingActivePathSha256, ...manifest.newScopeGuardPaths,
      ...manifest.frozenPathsForExactSuccessor }
    if (scope.taskId !== TASK || scope.status !== 'ACTIVE' || scope.approvedBy !== 'Founder' ||
        scope.featureBranch !== manifest.featureBranch || scope.lineageMode !== 'PRE_COMMIT_CONTENT_SHA256' ||
        scope.sealedCandidatePatchSha256 !== manifest.sealedCandidatePatchSha256 ||
        !samePaths(scope.authorizedPaths, Object.keys(allowed)) ||
        !samePaths(Object.keys(scope.authorizedPathSha256), Object.keys(allowed)) ||
        Object.entries(allowed).some(([path, digest]) => scope.authorizedPathSha256[path] !== digest || !atHead(path, digest))) return null

    const [integration, ...extraParents] = parents(head)
    if (extraParents.length || parents(integration).join(' ') !== `${manifest.businessBaseSha} ${main}`) return null
    // The older feature tip lacked the previous main-only registry file.
    // Its replacement must come from the trusted registration, never the feature.
    const priorBusiness = diffPaths(manifest.trustedOriginMainSha, manifest.businessBaseSha)
      .filter(path => path !== SCOPE)
    if (!samePaths(diffPaths(main, integration), priorBusiness) || priorBusiness.some(path =>
      !git('ls-tree', integration, '--', path).equals(git('ls-tree', manifest.businessBaseSha, '--', path)))) return null
    const product = Object.keys(manifest.exactCandidatePaths)
    if (!samePaths(diffPaths(integration, head), [...product, INTEGRATION_MANIFEST]) ||
        !atHead(INTEGRATION_MANIFEST, activation.integrationManifestSha256) || product.some(path =>
      !atHead(path, manifest.exactCandidatePaths[path]))) return null

    const added = diffPaths(integration, head, '--diff-filter=A').filter(path => product.includes(path)).sort()
    const existing = product.filter(path => !added.includes(path))
    const exactPatch = Buffer.concat([patch(integration, head, existing), ...added.map(path => patch(integration, head, [path]))])
    if (sha(exactPatch) !== manifest.sealedCandidatePatchSha256) return null

    const corePaths = diffPaths(main, head)
    if (!samePaths(corePaths, [...new Set([...priorBusiness, ...product])])) return null
    execFileSync(process.execPath, [GUARD, '--task-id', TASK, '--files', corePaths.join(',')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      registrationSha: main,
      cashierHash: manifest.frozenPathsForExactSuccessor[CASHIER],
      scannerPath: SCANNER,
      corePaths: new Set(corePaths),
    }
  } catch {
    return null
  }
}

function readNativeInventoryM1Successor(root) {
  return readOriginalNativeInventoryM1Successor(root) ??
    require('./es-native-inventory-m1-runtime-successor.cjs').readNativeInventoryM1RuntimeSuccessor(root) ??
    require('./es-native-inventory-m1-main-successor.cjs').readNativeInventoryM1MainSuccessor(root)
}

function verifyNativeInventoryM1Remote(root, exact) {
  if ((exact.mainline && exact.scopeStatus !== 'CLOSED') || (exact.closedBaseline && !exact.mainline)) {
    throw new Error('M1 mainline authority requires the atomic CLOSED handoff')
  }
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim()
  if (!['git@github.com:jasonmino-ops/light-ops-assistant.git',
    'https://github.com/jasonmino-ops/light-ops-assistant.git'].includes(url)) {
    throw new Error('M1 authority requires the canonical GitHub origin')
  }
  const sha = execFileSync('gh', ['api', '--hostname', 'github.com',
    'repos/jasonmino-ops/light-ops-assistant/git/ref/heads/main', '--jq', '.object.sha'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
  }).trim()
  if (sha !== (exact.trustedMainSha ?? exact.registrationSha)) throw new Error('M1 registration does not match the live GitHub main ref')
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    const local = args.length === 1 && args[0] === '--check-local'
    if (args.length && !local) throw new Error('usage: es-native-inventory-m1-successor.cjs [--check-local]')
    const exact = readNativeInventoryM1Successor(process.cwd())
    if (!exact) throw new Error('no exact, trusted M1 Frozen Successor')
    if (!local) verifyNativeInventoryM1Remote(process.cwd(), exact)
    console.log(`${local ? 'LOCAL REHEARSAL PASS' : 'REMOTE AUTHORITY PASS'}: non-production M1 Frozen Successor, ${exact.corePaths.size} product paths, Cashier ${exact.cashierHash}`)
  } catch (error) {
    console.error(`BLOCKED: ${error.message}`)
    process.exitCode = 1
  }
}

module.exports = { readNativeInventoryM1Successor, verifyNativeInventoryM1Remote }

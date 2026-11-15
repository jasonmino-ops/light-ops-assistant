'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const TASK = 'ES-NATIVE-INVENTORY-V1'
const SIGNATURE = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SIGNATURE.json'
const SIGNATURE_SHA = 'ecfe94be4744bf4ec0ea8751d51cb4cd5d630b1f8ee7be25be79894b098c83eb'
const ACTIVATION = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SUCCESSOR.json'
const SCOPE = 'docs/change-gates/exceptions/ES-NATIVE-INVENTORY-V1.json'
const REVIEW = 'docs/freezes/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-REVIEW.md'
const GUARD = 'scripts/guards/check-change-scope.js'
const CASHIER = 'app/cashier/page.tsx'
const GOVERNANCE = [
  SIGNATURE, SCOPE, REVIEW,
  'scripts/governance/es-native-inventory-m1-successor.cjs',
  'scripts/governance/es-native-inventory-m1-runtime-successor.cjs',
  'tests/native-inventory-m1-successor.test.cjs',
]
const RECORD_KEYS = ['schemaVersion', 'taskId', 'status', 'approvedBy', 'reviewedBy',
  'signatureSha256', 'deadlineExclusive', 'executablePathsSha256']
const APPROVAL_SOURCE = 'Founder exact M1 runtime successor signature SHA-256 ' + SIGNATURE_SHA
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const samePaths = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(path => b.includes(path))

function readNativeInventoryM1RuntimeSuccessor(root) {
  if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE'].some(key => process.env[key])) return null
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const text = (...args) => git(...args).toString('utf8').trim()
    const blob = (ref, path) => git('show', `${ref}:${path}`)
    const tree = (ref, path) => git('ls-tree', ref, '--', path)
    const parents = ref => text('rev-list', '--parents', '-1', ref).split(' ').slice(1)
    const pathsBetween = (base, head) => git('diff', '--no-renames', '--name-only', '-z', base, head)
      .toString('utf8').split('\0').filter(Boolean)
    const atHead = (path, digest) => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) &&
      tree('HEAD', path).toString().startsWith('100644 blob ') &&
      lstatSync(resolve(root, path)).isFile() &&
      sha(blob('HEAD', path)) === digest && sha(blob('', path)) === digest &&
      sha(readFileSync(resolve(root, path))) === digest

    const main = text('rev-parse', '--verify', 'refs/remotes/origin/main')
    const head = text('rev-parse', '--verify', 'HEAD')
    const signatureBytes = blob(main, SIGNATURE)
    if (sha(signatureBytes) !== SIGNATURE_SHA) return null
    const signature = JSON.parse(signatureBytes)
    const { trustedGovernanceBefore: previous, businessParent: business, featureBranch } = signature
    if (text('branch', '--show-current') !== featureBranch ||
        text('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none') ||
        /^[a-zS] /m.test(text('ls-files', '-v'))) return null
    if (parents(main).join(' ') !== previous ||
        !samePaths(pathsBetween(previous, main), [...GOVERNANCE, ACTIVATION])) return null

    const activationBytes = blob(main, ACTIVATION)
    const activation = JSON.parse(activationBytes)
    const predecessorActivation = JSON.parse(blob(previous, 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-FROZEN-SUCCESSOR.json'))
    if (!samePaths(Object.keys(activation), RECORD_KEYS) || activation.schemaVersion !== 1 ||
        activation.taskId !== TASK || activation.status !== 'ACTIVE' || activation.approvedBy !== 'Founder' ||
        typeof activation.reviewedBy !== 'string' || !activation.reviewedBy.trim() ||
        activation.signatureSha256 !== SIGNATURE_SHA ||
        activation.deadlineExclusive !== predecessorActivation.deadlineExclusive ||
        !(Date.parse(activation.deadlineExclusive) > Date.now()) ||
        !samePaths(Object.keys(activation.executablePathsSha256), GOVERNANCE) ||
        !atHead(ACTIVATION, sha(activationBytes))) return null

    for (const path of GOVERNANCE) {
      const digest = activation.executablePathsSha256[path]
      if (sha(blob(main, path)) !== digest || !atHead(path, digest)) return null
    }
    for (const path of [GUARD, 'docs/change-gates/gate-config.json', ...Object.keys(predecessorActivation.executablePathsSha256)]) {
      if (!GOVERNANCE.includes(path) && !atHead(path, sha(blob(previous, path)))) return null
    }

    const priorScope = JSON.parse(blob(previous, SCOPE))
    const scope = JSON.parse(blob(main, SCOPE))
    const allowed = { ...priorScope.authorizedPathSha256, ...signature.exactScopeAddOrReplace }
    const expectedScope = {
      ...priorScope,
      approvalSource: APPROVAL_SOURCE,
      sealedCandidatePatchSha256: signature.candidatePatchSha256,
      authorizedPaths: Object.keys(allowed).sort(),
      authorizedPathSha256: Object.fromEntries(Object.entries(allowed).sort(([a], [b]) => a < b ? -1 : Number(a > b))),
    }
    if (JSON.stringify(scope) !== JSON.stringify(expectedScope) ||
        Object.entries(allowed).some(([path, digest]) => !atHead(path, digest))) return null

    const [integration, ...extraParents] = parents(head)
    if (!integration || extraParents.length || parents(integration).join(' ') !== `${business} ${main}`) return null
    const governancePaths = [...GOVERNANCE, ACTIVATION]
    if (!samePaths(pathsBetween(business, integration), governancePaths) ||
        governancePaths.some(path => !tree(integration, path).equals(tree(main, path)))) return null

    const product = Object.keys(signature.candidatePathsSha256)
    if (!samePaths(pathsBetween(integration, head), product) ||
        product.some(path => !atHead(path, signature.candidatePathsSha256[path]))) return null
    for (const [path, { previousSha256, candidateSha256 }] of Object.entries(signature.frozenSuccessor)) {
      if (sha(blob(business, path)) !== previousSha256 || !atHead(path, candidateSha256)) return null
    }
    const patch = git('diff', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv',
      '--src-prefix=a/', '--dst-prefix=b/', integration, head)
    if (sha(patch) !== signature.candidatePatchSha256) return null

    const corePaths = pathsBetween(main, head)
    if (!samePaths(corePaths, [...new Set([...pathsBetween(previous, business), ...product])])) return null
    execFileSync(process.execPath, [GUARD, '--task-id', TASK, '--files', corePaths.join(',')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      registrationSha: main,
      cashierHash: signature.candidatePathsSha256[CASHIER],
      scannerPath: 'app/sale/page.tsx',
      corePaths: new Set(corePaths),
      runtimeRoleSuccessor: true,
    }
  } catch {
    return null
  }
}

module.exports = { readNativeInventoryM1RuntimeSuccessor }

'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const TASK = 'ES-PRINT-UNIFIED-INTEGRATION-01'
const REGISTRATION = '948d31b396602a18e515e7fab1cf629491b0a9b3'
const SOURCE_BASE = 'd931a77c63b9c080214ab56117123b0230c0c4e2'
const PRODUCTION = 'd441b55c8014642eb1b26b90d7bf5ce1b2df7941'
const PRODUCT = 'a8c13b2da80ce3311945cb6ad3f4ab1672c7b044'
const PRODUCT_TREE = '85a84d6a888421bfadb5e7e6813edb3fd54961e2'
const PRODUCT_DIFF = '510665a0eaa23c56c523e107f0f2ea32df4270dd4529373ac58a9c6af599515f'
const RECORD = `docs/freezes/${TASK}.md`
const RECORD_SHA = '321c9ed4494c5f80b336823fa656e74d2af97049ccb862092c1cf4148c1fa766'
const ACTIVATION = `docs/change-gates/${TASK}-EXECUTABLE-SUCCESSOR.json`
const CLOSURE_BASE = '1e35d4d5a52c89602037c7952e7bb181bfd6335f'
const CLOSURE_ACTIVATION = `docs/change-gates/${TASK}-SOFTWARE-CLOSURE.json`
const CLOSURE_DEPENDENCIES = [
  '.github/workflows/desktop-release-pilot.yml',
  '.github/workflows/desktop-windows-build.yml',
  'app/ops/[tenantId]/page.tsx',
  'desktop/scripts/release-foundation.mjs',
  'desktop/tests/release-foundation.test.ts',
  'scripts/governance/es-print-unified-integration-01.cjs',
  'tests/customer-order-recovery.test.ts',
  'tests/v3-print-control-plane-contract.test.cjs',
]
const CLOSURE_ACTIVATION_KEYS = [
  'approvedBy', 'deadlineExclusive', 'dependencyCommit', 'dependencyTree', 'dependencyPathsSha256',
  'priorMain', 'productCommit', 'productTree', 'requestSha256', 'reviewSha256', 'reviewedBy',
  'schemaVersion', 'status', 'taskId',
]
// This exact development base follows the registered first-parent disposition.
const RESUME_BASE = '332137496dd3578a0a8eb3fcc83e5e835f52aae1'
const RESUME_ACTIVATION = `docs/change-gates/${TASK}-RESUME.json`
const RESUME_DEPENDENCIES = [
  '.github/workflows/desktop-windows-build.yml',
  'desktop/scripts/release-foundation.mjs',
  'desktop/tests/release-foundation.test.ts',
  'scripts/governance/es-print-unified-integration-01.cjs',
]
const CORE = 'tests/cashier-realtime-integration.test.ts'
const CORE_SHA = 'ccad9c0a1c3fb485871966a4c5aa9fcd7acfe7fdc9f9e567b0ff19d686235b60'
const RUNTIME = 'desktop/src/main/printing/v3PrintingRuntime.ts'
const STARTUP = 'desktop/src/main/main.ts'
const STARTUP_ANCHOR = '227146b9e215e1441082c04e8941de8611592226'
const EXECUTABLE_PATHS = [
  'desktop/scripts/release-foundation.mjs',
  'scripts/governance/es-print-unified-integration-01.cjs',
  CORE,
  'scripts/governance/es-print-unified-successor.test.cjs',
]
const ACTIVATION_KEYS = [
  'approvedBy', 'deadlineExclusive', 'executableCommit', 'executablePathsSha256',
  'productCommit', 'productTree', 'registrationCommit', 'requestSha256', 'reviewSha256',
  'reviewedBy', 'schemaVersion', 'status', 'taskId',
]

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const isSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const isCommit = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const lines = value => value.trim().split('\n').filter(Boolean)
const samePaths = (a, b) =>
  a.length === b.length && new Set(a).size === a.length && a.every(path => b.includes(path))

function isCurrentDeadline(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString().replace('.000Z', 'Z') === value && Date.now() < time
}

function readUnifiedPrintSuccessor(root) {
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const text = (...args) => git(...args).toString('utf8').trim()
    const blob = (ref, path) => git('show', `${ref}:${path}`)
    const digest = (ref, path) => sha(blob(ref, path))
    const changed = (from, to, ...paths) => lines(text('diff', '--no-renames', '--name-only', from, to, '--', ...paths))
    const patch = (from, to, ...paths) => sha(git('diff', '--binary', '--full-index', '--no-renames', '--no-ext-diff',
      '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', from, to, '--', ...paths))

    const main = text('rev-parse', '--verify', 'refs/remotes/origin/main')
    const [head, first, second, ...extra] = text('rev-list', '--parents', '-1', 'HEAD').split(' ')
    if (second !== PRODUCT || extra.length || (main !== head && main !== first) || !isCommit(first)) return null
    if (text('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none') ||
        /^[a-zS] /m.test(text('ls-files', '-v'))) return null

    const matchesTree = (ref, path, expected) =>
      isSha(expected) && digest(ref, path) === expected &&
      git('ls-tree', ref, '--', path).equals(git('ls-tree', head, '--', path)) &&
      digest(head, path) === expected && digest('', path) === expected &&
      sha(readFileSync(resolve(root, path))) === expected

    // Select the new record only when present. A malformed new record never
    // falls back to the historical closure approval.
    const resumed = Boolean(text('ls-tree', first, '--', RESUME_ACTIVATION))
    const closurePath = resumed ? RESUME_ACTIVATION : CLOSURE_ACTIVATION
    const closureBase = resumed ? RESUME_BASE : CLOSURE_BASE
    const dependencies = resumed ? RESUME_DEPENDENCIES : CLOSURE_DEPENDENCIES
    const closureEntry = text('ls-tree', first, '--', closurePath)
    const closure = closureEntry ? JSON.parse(blob(first, closurePath)) : null
    let approvalBase = first
    if (closureEntry) {
      if (!closure || !samePaths(Object.keys(closure), CLOSURE_ACTIVATION_KEYS) ||
          closure.schemaVersion !== 1 || closure.taskId !== TASK || closure.status !== 'ACTIVE' ||
          closure.approvedBy !== 'Founder' || closure.reviewedBy !== 'Claude' ||
          closure.priorMain !== closureBase || closure.productCommit !== PRODUCT || closure.productTree !== PRODUCT_TREE ||
          !isSha(closure.requestSha256) || !isSha(closure.reviewSha256) ||
          !isCurrentDeadline(closure.deadlineExclusive) || !isCommit(closure.dependencyCommit) ||
          !isCommit(closure.dependencyTree) ||
          text('rev-list', '--parents', '-1', first) !== `${first} ${closure.dependencyCommit}` ||
          text('rev-list', '--parents', '-1', closure.dependencyCommit) !== `${closure.dependencyCommit} ${closureBase}` ||
          text('rev-parse', `${closure.dependencyCommit}^{tree}`) !== closure.dependencyTree ||
          text('diff', '--no-renames', '--name-status', closure.dependencyCommit, first) !== `A\t${closurePath}` ||
          !samePaths(changed(closureBase, closure.dependencyCommit), dependencies) ||
          !samePaths(Object.keys(closure.dependencyPathsSha256), dependencies) ||
          !matchesTree(first, closurePath, digest(first, closurePath))) return null
      for (const path of dependencies) {
        if (!matchesTree(closure.dependencyCommit, path, closure.dependencyPathsSha256[path]) ||
            !git('ls-tree', closure.dependencyCommit, '--', path).equals(git('ls-tree', first, '--', path))) return null
      }
      approvalBase = CLOSURE_BASE
    }

    // The original activation keeps its exact chain. Only the independent
    // approval above can bind a new first parent and expiry.
    const activation = JSON.parse(blob(approvalBase, ACTIVATION))
    if (!samePaths(Object.keys(activation), ACTIVATION_KEYS) || activation.schemaVersion !== 1 ||
        activation.taskId !== TASK || activation.status !== 'ACTIVE' || activation.approvedBy !== 'Founder' ||
        activation.reviewedBy !== 'Claude' ||
        activation.registrationCommit !== REGISTRATION || activation.productCommit !== PRODUCT ||
        activation.productTree !== PRODUCT_TREE || !isSha(activation.requestSha256) || !isSha(activation.reviewSha256) ||
        !isCurrentDeadline(closure?.deadlineExclusive ?? activation.deadlineExclusive) || !isCommit(activation.executableCommit)) return null
    const executable = activation.executableCommit
    if (text('rev-list', '--parents', '-1', approvalBase) !== `${approvalBase} ${executable}` ||
        text('rev-list', '--parents', '-1', executable) !== `${executable} ${REGISTRATION}` ||
        text('diff', '--no-renames', '--name-status', executable, approvalBase) !== `A\t${ACTIVATION}` ||
        !samePaths(changed(REGISTRATION, executable), EXECUTABLE_PATHS) ||
        !samePaths(Object.keys(activation.executablePathsSha256), EXECUTABLE_PATHS)) return null

    for (const path of EXECUTABLE_PATHS) {
      const expected = activation.executablePathsSha256[path]
      if (resumed && path === CORE) {
        // The independently merged shift-report successor owns the newer CORE
        // checker bytes. Preserve both the original evidence and the current file.
        if (!isSha(expected) || digest(executable, path) !== expected ||
            !matchesTree(RESUME_BASE, path, digest(RESUME_BASE, path))) return null
      } else if (closure && CLOSURE_DEPENDENCIES.includes(path)) {
        if (!isSha(expected) || digest(executable, path) !== expected ||
            !git('ls-tree', executable, '--', path).equals(git('ls-tree', approvalBase, '--', path))) return null
      } else if (!matchesTree(executable, path, expected) ||
          !git('ls-tree', executable, '--', path).equals(git('ls-tree', first, '--', path))) return null
    }

    if (text('rev-list', '--parents', '-1', REGISTRATION) !== `${REGISTRATION} ${SOURCE_BASE}`) return null
    git('merge-base', '--is-ancestor', PRODUCTION, REGISTRATION)
    const record = blob(REGISTRATION, RECORD)
    if (sha(record) !== RECORD_SHA || !matchesTree(REGISTRATION, RECORD, RECORD_SHA) ||
        digest(REGISTRATION, CORE) !== CORE_SHA || text('rev-parse', `${PRODUCT}^{tree}`) !== PRODUCT_TREE ||
        patch(SOURCE_BASE, PRODUCT) !== PRODUCT_DIFF) return null
    const source = record.toString('utf8')
    const productPaths = [...source.matchAll(/^\| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
    const paths = productPaths.map(([, path]) => path)
    if (paths.length !== 25 || !samePaths(changed(first, head), paths) ||
        productPaths.some(([, path, expected]) => !matchesTree(PRODUCT, path, expected))) return null

    // The complete merge tree is pinned by the exact first-parent delta,
    // including modes and blobs, while the second parent pins the product tree.
    // The two frozen files have additional independent anchor and patch checks.
    const frozen = [...source.matchAll(/^\| `([^`]+)` \| `([a-f0-9]{40})` \| `([a-f0-9]{64})` \| `([a-f0-9]{64})` \| `([a-f0-9]{64})` \|$/gm)]
    if (!samePaths(frozen.map(([, path]) => path), [RUNTIME, STARTUP])) return null
    for (const [, path, anchor, before, after, diff] of frozen) {
      if (anchor !== (path === STARTUP ? STARTUP_ANCHOR : SOURCE_BASE) ||
          digest(anchor, path) !== before || digest(head, path) !== after ||
          patch(anchor, head, path) !== diff || !samePaths(changed(anchor, head, path), [path])) return null
    }
    return {
      allowsFoundationHistory() {
        return closure !== null && isCurrentDeadline(closure.deadlineExclusive)
      },
      resumedCashierSnapshot() {
        return resumed && isCurrentDeadline(closure.deadlineExclusive) ? RESUME_BASE : undefined
      },
      corePaths(candidatePaths, rejectedPaths) {
        return isCurrentDeadline(closure?.deadlineExclusive ?? activation.deadlineExclusive) && samePaths(candidatePaths, paths) &&
          samePaths(rejectedPaths, paths) ? new Set(paths) : null
      },
      admitsStartup(label, anchor, groupPaths) {
        return isCurrentDeadline(closure?.deadlineExclusive ?? activation.deadlineExclusive) && label === 'main startup gate' &&
          anchor === STARTUP_ANCHOR && samePaths(groupPaths, [STARTUP])
      },
    }
  } catch {
    // Missing, unreadable or mismatched evidence leaves the original gates in force.
    return null
  }
}

module.exports = { readUnifiedPrintSuccessor }

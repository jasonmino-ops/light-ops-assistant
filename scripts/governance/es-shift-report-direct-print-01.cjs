'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const base = '304c03695bf904b5e179da8e19de2275eec9ea13'
const task = 'ES-SHIFT-REPORT-DIRECT-PRINT-01'
const recordPath = `docs/change-gates/${task}-FROZEN-SUCCESSOR.json`
const scopePath = `docs/change-gates/exceptions/${task}.json`
const priorRecord = 'docs/change-gates/ES-PRINT-UNIFIED-INTEGRATION-01-RESUME.json'
const cashier = 'app/cashier/page.tsx'
const report = 'app/components/ShiftReportPrint.tsx'
const productPaths = [cashier, report]
const paths = [
  scopePath,
  'desktop/scripts/release-foundation.mjs',
  'desktop/tests/release-foundation.test.ts',
  'scripts/governance/es-shift-report-direct-print-01.cjs',
  'tests/cashier-realtime-integration.test.ts',
  'tests/es-tray-device-print-contract.test.ts',
  'tests/v3-reprint-recovery.test.ts',
]
const after = {
  [cashier]: '5c00b6d10ee6deb79b9574cf0d0bcfe9d18c6d7456fcd2adbca3af8265b9320c',
  [report]: '29e62ad401e0019b09a142ab1f7fdbf186097053a0c15d8dad22573474ccaeae',
}
const patch = 'f5590e67b254a6aa91d0ebc9c9c10f7223291195f969aab47fe7e4d52651b0f3'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => a.length === b.length && a.every(item => b.includes(item))
const foundationGroups = new Set([
  'main startup gate', 'Prisma', 'Payment', 'Scanner', 'cashier/customer/mobile business',
])

function readDirectShiftSuccessor(root) {
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const str = (...args) => git(...args).toString('utf8').trim()
    const lines = (...args) => str(...args).split('\n').filter(Boolean)
    const blob = (ref, file) => git('show', `${ref}:${file}`)
    const changed = (from, to) => lines('diff', '--no-renames', '--name-only', from, to)
    const diff = (from, to) => git('diff', '--binary', '--full-index', '--no-renames',
      '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', from, to)
    const trusted = str('rev-parse', '--verify', 'refs/remotes/origin/main')
    const head = str('rev-parse', '--verify', 'HEAD')
    const [registration, product, closure] = lines('rev-list', '--first-parent', '--reverse', `${base}..${head}`)
    if (!registration || head !== (closure || product || registration) || ![registration, product, closure].includes(trusted) ||
        str('rev-list', '--parents', '-1', registration) !== `${registration} ${base}` ||
        !same(changed(base, registration), [...paths, recordPath]) ||
        str('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none') ||
        /^[a-zS] /m.test(str('ls-files', '-v'))) return null
    const record = JSON.parse(blob(registration, recordPath))
    if (record.taskId !== task || record.status !== 'ACTIVE' || record.approvedBy !== 'Founder' ||
        record.base !== base || record.productPatchSha256 !== patch ||
        !same(Object.keys(record.governanceSha256), paths)) return null
    const scope = JSON.parse(blob(registration, scopePath))
    if (scope.taskId !== task || scope.status !== 'ACTIVE' || scope.approvedBy !== 'Founder' ||
        scope.featureBranch !== 'codex/es-shift-report-direct-print-01-web' ||
        !same(scope.authorizedPaths, productPaths) ||
        productPaths.some(file => scope.authorizedPathSha256[file] !== after[file])) return null
    for (const file of [recordPath, ...paths]) {
      if (file !== recordPath && sha(blob(registration, file)) !== record.governanceSha256[file]) return null
      if (file === scopePath && closure) continue
      if (!git('ls-tree', registration, '--', file).equals(git('ls-tree', head, '--', file))) return null
    }
    if (product && (str('rev-list', '--parents', '-1', product) !== `${product} ${registration}` ||
        !same(changed(registration, product), productPaths) || sha(diff(registration, product)) !== patch ||
        (trusted === registration && str('branch', '--show-current') !== scope.featureBranch))) return null
    if (closure) {
      if (str('rev-list', '--parents', '-1', closure) !== `${closure} ${product}` ||
          !same(changed(product, closure), [scopePath])) return null
      const closed = JSON.parse(blob(closure, scopePath))
      const { closedAt, featureMergeCommitSha, ...fields } = closed
      if (!Number.isFinite(Date.parse(closedAt)) || featureMergeCommitSha !== product ||
          closed.status !== 'CLOSED' || JSON.stringify({ ...fields, status: 'ACTIVE' }) !== JSON.stringify(scope)) return null
    }
    const productRef = product || base
    if (productPaths.some(file => {
      const expected = product ? after[file] : sha(blob(base, file))
      const mode = git('ls-tree', productRef, '--', file)
      return !mode.equals(git('ls-tree', head, '--', file)) ||
        sha(blob(head, file)) !== expected || sha(blob('', file)) !== expected ||
        !lstatSync(resolve(root, file)).isFile() || sha(readFileSync(resolve(root, file))) !== expected
    })) return null

    const approval = JSON.parse(blob(base, priorRecord))
    const inheritsFoundation = approval.status === 'ACTIVE' &&
      sha(blob(base, priorRecord)) === record.priorFoundationRecordSha256 &&
      Date.parse(approval.deadlineExclusive) > Date.now() &&
      git('ls-tree', base, '--', priorRecord).equals(git('ls-tree', head, '--', priorRecord))
    return {
      cashierHash: sha(blob(productRef, cashier)),
      corePaths: head === trusted ? null : new Set(changed(trusted, head)),
      foundationSnapshot(label, groupPaths) {
        if (!inheritsFoundation || !foundationGroups.has(label)) return undefined
        const snapshot = label === 'cashier/customer/mobile business' && product
          ? product : base
        if (str('diff', '--name-only', snapshot, '--', ...groupPaths)) return undefined
        return snapshot
      },
    }
  } catch {
    return null
  }
}

module.exports = { readDirectShiftSuccessor }

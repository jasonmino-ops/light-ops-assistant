'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const REGISTRATION = '532c4e30e5215c211a6297dee556db560fce8606'
const TASK = 'ES-SHIFT-REPORT-FOLLOW-FRONT-PRINT-01'
const FREEZE = `docs/change-gates/${TASK}-FROZEN-SUCCESSOR.json`
const SCOPE = `docs/change-gates/exceptions/${TASK}.json`
const CASHIER = 'app/cashier/page.tsx'
const PRODUCT_PATHS = [CASHIER, 'app/components/ShiftReportPrint.tsx']
const EXECUTABLE_PATHS = [
  'scripts/governance/es-shift-report-follow-front-print-01.cjs',
  'tests/cashier-realtime-integration.test.ts',
  'tests/es-tray-device-print-contract.test.ts',
  'tests/v3-reprint-recovery.test.ts',
]
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const samePaths = (actual, expected) =>
  actual.length === expected.length && expected.every(path => actual.includes(path))

function readShiftReportSuccessor(root) {
  let rejected = null
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const text = (...args) => git(...args).toString('utf8').trim()
    const blob = (ref, path) => git('show', `${ref}:${path}`)
    const changes = (from, to) => text('diff', '--name-only', '--no-renames', from, to).split('\n')
    const main = text('rev-parse', '--verify', 'refs/remotes/origin/main')
    const head = text('rev-parse', '--verify', 'HEAD')
    const [governance, mergedProduct] = text(
      'rev-list', '--first-parent', '--reverse', `${REGISTRATION}..${main}`,
    ).split('\n')
    if (!governance ||
        text('rev-list', '--parents', '-1', governance) !== `${governance} ${REGISTRATION}` ||
        !samePaths(changes(REGISTRATION, governance), EXECUTABLE_PATHS)) return null

    // The approved registry is immutable. The reviewed executor is trusted
    // only after its exact governance commit is on origin/main.
    const recordBytes = blob(REGISTRATION, FREEZE)
    const scopeBytes = blob(REGISTRATION, SCOPE)
    if (sha(recordBytes) !== '02602db9ee73a0193605d3eb831056b6f47d68335957b0a79ac4bfaca776429c' ||
        sha(scopeBytes) !== '1a32963e06cf2a2b7ff3eeec30e0ca5f63e54f6ddbf1c3f439520147d167cafd') return null
    const record = JSON.parse(recordBytes)
    const scope = JSON.parse(scopeBytes)

    const pending = main === governance
    const product = pending ? head : mergedProduct
    if (!product || text('rev-list', '--parents', '-1', product) !== `${product} ${governance}` ||
        !samePaths(changes(governance, product), PRODUCT_PATHS)) return null
    if (pending) {
      if (text('branch', '--show-current') !== scope.featureBranch ||
          text('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none') ||
          /^[a-zS] /m.test(text('ls-files', '-v'))) return null
    }

    const diff = git('diff', '--binary', '--full-index', '--no-renames', '--no-ext-diff',
      '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/', governance, product)
    if (sha(diff) !== record.fullIndexDiffSha256) return null
    const cashierHash = record.paths[CASHIER].after
    if (!pending) {
      // A recognized merged successor must never fall back to the old hash,
      // even when the checkout itself has reverted to those historical bytes.
      rejected = { cashierHash, corePaths: null, blocked: true }
      git('merge-base', '--is-ancestor', product, head)
    }

    const matches = (ref, path, expected) => {
      const file = resolve(root, path)
      const entry = git('ls-tree', ref, '--', path)
      return entry.equals(git('ls-tree', main, '--', path)) &&
        entry.equals(git('ls-tree', head, '--', path)) &&
        sha(blob('', path)) === expected && lstatSync(file).isFile() &&
        sha(readFileSync(file)) === expected
    }
    if (EXECUTABLE_PATHS.some(path => !matches(governance, path, sha(blob(governance, path))))) return rejected
    if (PRODUCT_PATHS.some(path => {
      const { before, after } = record.paths[path]
      if (sha(blob(governance, path)) !== before || sha(blob(product, path)) !== after) return true
      if (!pending) return !matches(product, path, after)
      const file = resolve(root, path)
      return !lstatSync(file).isFile() || sha(blob('', path)) !== after || sha(readFileSync(file)) !== after
    })) return rejected

    // Only the pending, exact product commit can receive a CORE path grant.
    // After the fast-forward, preserve the accepted hash as the frozen baseline.
    return { cashierHash, corePaths: pending ? new Set(PRODUCT_PATHS) : null, blocked: false }
  } catch {
    return rejected
  }
}

module.exports = { readShiftReportSuccessor }

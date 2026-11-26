import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Read-only evidence aid; never a Scope, Acceptance, authorization or release validator.
// Reuses P1 (3f39aa20) exact identities/paths and fail-closed input checks, not its ledger.
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const isPath = value => typeof value === 'string' && value === value.trim()
  && !/[\x00-\x1f\\:*?{}]/.test(value)
  && value.split('/').every(part => part && !['.', '..', '.git'].includes(part))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (left, right) => left.length === right.length && left.every(item => right.includes(item))
const documentary = path => /^docs\/(?:acceptance|change-gates\/evidence)\/.+\.(?:md|json)$/.test(path)
  && !/(?:^|[/ ._-])(?:authorization|grant|gate|manifest|policy|rules|ktf|known-failures)(?:[/ ._-]|$)/i.test(path)
const taskRecord = path => path.match(/^docs\/(?:change-gates\/exceptions|releases)\/([A-Z0-9-]+)\.json$/)?.[1]
  ?? path.match(/^docs\/releases\/evidence\/([A-Z0-9-]+)\/(?:controller-review\.json|founder-release\.md)$/)?.[1]

export function inspectEvidenceReuse(repoRoot, input, now = Date.now()) {
  const blocked = reason => ({ evidenceStatus: 'NOT_REUSABLE', reason, authorizationStatus: 'NOT_ASSESSED' })
  try {
    const { taskId, productSha, productTree, observedProductSha, observedProductTree, productionSha,
      observedProductionSha, governanceFrom, governanceTo, environmentSha256,
      observedEnvironmentSha256, productInputs, authorityInputs, documentaryPaths,
      ownReceiptPath = null, expiresAt, authorizationBinding } = input ?? {}
    if (typeof taskId !== 'string' || !/^[A-Z0-9][A-Z0-9-]+$/.test(taskId)
      || ![productSha, productTree, observedProductSha, observedProductTree, productionSha,
      observedProductionSha, governanceFrom, governanceTo].every(isSha)
      || ![environmentSha256, observedEnvironmentSha256].every(isDigest)
      || !['EXACT_GOVERNANCE_HEAD', 'DOCUMENTARY_ADVANCE_DECLARED'].includes(authorizationBinding)
      || !Array.isArray(documentaryPaths) || !documentaryPaths.every(isPath)
      || new Set(documentaryPaths).size !== documentaryPaths.length
      || (ownReceiptPath !== null && (!isPath(ownReceiptPath) || !documentary(ownReceiptPath)))) return blocked('INVALID_INPUT')
    const expiry = Date.parse(expiresAt)
    if (!Number.isFinite(now) || !Number.isFinite(expiry) || expiry <= now
      || new Date(expiry).toISOString() !== expiresAt) return blocked('EXPIRED_OR_INVALID_TIME')
    if (productSha !== observedProductSha || productTree !== observedProductTree) return blocked('PRODUCT_CHANGED')
    if (productionSha !== observedProductionSha) return blocked('PRODUCTION_CHANGED')
    if (environmentSha256 !== observedEnvironmentSha256) return blocked('ENVIRONMENT_CHANGED')
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000,
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
    })
    for (const sha of [productSha, productionSha, governanceFrom, governanceTo]) {
      if (git('rev-parse', '--verify', `${sha}^{commit}`).toString().trim() !== sha) return blocked('UNKNOWN_COMMIT')
    }
    if (git('rev-parse', `${productSha}^{tree}`).toString().trim() !== productTree) return blocked('TREE_MISMATCH')
    git('merge-base', '--is-ancestor', governanceFrom, governanceTo)
    const blob = (ref, path) => {
      const entry = git('ls-tree', '-z', ref, '--', path).toString()
      if (!/^100644 blob [a-f0-9]{40}\t/.test(entry) || entry.slice(entry.indexOf('\t') + 1) !== `${path}\0`) {
        throw new Error('Non-regular, missing or ambiguous evidence input')
      }
      return git('show', `${ref}:${path}`)
    }
    const verifyInputs = (inputs, refs) => {
      if (!inputs || Array.isArray(inputs) || typeof inputs !== 'object' || !Object.keys(inputs).length) return false
      return Object.entries(inputs).every(([path, hash]) => isPath(path) && isDigest(hash)
        && refs.every(ref => digest(blob(ref, path)) === hash))
    }
    if (!verifyInputs(productInputs, [productSha])
      || !verifyInputs(authorityInputs, [governanceFrom, governanceTo])) return blocked('EVIDENCE_INPUT_CHANGED_OR_MISSING')
    const raw = git('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-status', '-z', governanceFrom, governanceTo).toString()
    const fields = raw.split('\0').filter(Boolean)
    const changes = []
    for (let i = 0; i < fields.length; i += 2) {
      const [status, path] = [fields[i], fields[i + 1]]
      if (!['A', 'M'].includes(status) || !isPath(path)
        || Object.hasOwn(authorityInputs, path) || Object.hasOwn(productInputs, path)) return blocked('NON_DOCUMENTARY_OR_BOUND_INPUT_CHANGE')
      const owner = taskRecord(path)
      if (owner === taskId) return blocked('OWN_AUTHORIZATION_CHANGED')
      if (!documentary(path) && !owner) return blocked('NON_DOCUMENTARY_OR_BOUND_INPUT_CHANGE')
      const current = blob(governanceTo, path)
      if (status === 'M') blob(governanceFrom, path)
      if (current.includes(0)) return blocked('BINARY_DOCUMENT')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(current)
      if (path.endsWith('.json')) {
        const record = JSON.parse(text)
        if (owner && !path.includes('/evidence/') && record.taskId !== owner) return blocked('TASK_RECORD_OWNER_MISMATCH')
      }
      changes.push(path)
    }
    const declared = [...documentaryPaths, ...(ownReceiptPath === null ? [] : [ownReceiptPath])]
    if (new Set(declared).size !== declared.length || !same(changes, declared)) return blocked('EXACT_DOCUMENTARY_PATHS_MISMATCH')
    if (governanceFrom !== governanceTo && authorizationBinding === 'EXACT_GOVERNANCE_HEAD') {
      return { evidenceStatus: 'UNCHANGED_INPUTS', reason: 'EXACT_REF_CHANGED_NO_TRANSFER',
        authorizationStatus: 'EXACT_REF_CHANGED_NO_TRANSFER', changedPaths: changes }
    }
    return { evidenceStatus: 'UNCHANGED_INPUTS_REVIEW_GOVERNANCE', changedPaths: changes,
      authorizationStatus: 'NOT_ASSESSED', limitations: 'Immutable Git objects only. Declared input completeness, document semantics/dependencies, original consent, current worktree/platform and all action gates still require review.' }
  } catch {
    return blocked('GIT_OR_EVIDENCE_UNVERIFIED')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let result
  try {
    if (process.argv.length !== 4) throw new Error('Expected repo root and JSON evidence projection')
    result = inspectEvidenceReuse(resolve(process.argv[2]), JSON.parse(readFileSync(process.argv[3], 'utf8')))
  } catch { result = { evidenceStatus: 'NOT_REUSABLE', reason: 'INVALID_INPUT', authorizationStatus: 'NOT_ASSESSED' } }
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.evidenceStatus === 'UNCHANGED_INPUTS_REVIEW_GOVERNANCE' ? 0 : 2
}

#!/usr/bin/env node
// Read-only, one-candidate verifier. Exit 3 means rehearsal only.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const release = '1f33d03bcba0bc5d2173be7afe0e3cb0694345c8'
const mainBefore = 'db16177d311dc6b070f98f5dc2ebb8048c9e5957'
const candidate = 'cf3960dc953eb58c48dd50edefe605aa4327abd8'
const intermediate = '50d47a1e9555e1919f7b0017a860132e8ba66930'
const candidateTree = '923ed8b4aa864e8ad7e929545355263ac6ce2889'
const productBranch = 'refs/heads/codex/es-native-inventory-diamond-phase1'
const controlBranch = 'refs/heads/codex/release-validator-control'
const approvedRecordPath = 'docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-ADMISSION.json'
const scopePath = 'docs/change-gates/exceptions/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B.json'
const independentPath = 'docs/freezes/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-INDEPENDENT-REVIEW.json'
const founderPath = 'docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-FOUNDER-RECORD.json'
const managedMigration = 'prisma/migrations/20261112133000_isolate_native_inventory_capability/migration.sql'
const migrationHash = '94ddb2a8ef3ebff029437361e31033ca9a5e31aeaf64ecffd6523ac11d4ca8f8'
const manifestHash = '8d0e4e2193795e234ae5c867339b03b487598cb0bb15ad5e8ac0cb2c2ee19a2b'
const canonicalRepo = 'jasonmino-ops/light-ops-assistant'
const gitUrl = 'https://github.com/' + canonicalRepo + '.git'
const canonicalUrls = new Set([gitUrl, 'git@github.com:' + canonicalRepo + '.git'])
const productionDeployment = 'dpl_NYkFAHe9NbLxyhzdhSNQi2wNW4JS'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const check = (value, label) => { if (!value) throw new Error(label) }

export function validWindow(evidence, now) {
  const issued = Date.parse(evidence?.issuedAt)
  const expires = Date.parse(evidence?.expiresAt)
  return Number.isFinite(issued) && Number.isFinite(expires) &&
    issued <= now && now < expires
}

export function hasExactAppSuccess(statuses, evidence, now = Date.now()) {
  if (!Array.isArray(statuses) || !validWindow(evidence, now) ||
      !/^[0-9a-f]{64}$/.test(evidence.recordSha256)) return false
  const newest = statuses.find(entry => entry?.context === 'eshop/selective-release-validator')
  const signed = Date.parse(newest?.created_at)
  return newest?.state === 'success' && newest.creator?.id === 351820557 &&
    signed >= Date.parse(evidence.issuedAt) && signed <= now &&
    signed < Date.parse(evidence.expiresAt) &&
    newest.description === 'Diamond B/R2 ' + evidence.recordSha256
}

export function verify(root, target, manifestBytes, { rehearsal = false, mainWorktree, forApp = false } = {}) {
  check(!Object.keys(process.env).some(key => /^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|CONFIG.*|SSH.*|REPLACE_REF_BASE)$/.test(key)), 'GIT_OVERRIDE')
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })
  const text = (...args) => git(...args).toString().trim()
  const canonical = text('remote', 'get-url', 'origin')
  check(canonicalUrls.has(canonical), 'NON_CANONICAL_ORIGIN')
  check(!text('status', '--porcelain=v1', '--untracked-files=no'), 'DIRTY_TRACKED_WORKTREE')
  check(target === candidate && text('rev-parse', 'HEAD') === candidate, 'CANDIDATE_SHA_MISMATCH')
  check(text('show', '-s', '--format=%P', target) === intermediate &&
        text('show', '-s', '--format=%P', intermediate) === release, 'CANDIDATE_PARENT_CHAIN')
  check(text('rev-parse', target + '^{tree}') === candidateTree, 'CANDIDATE_TREE_MISMATCH')
  check(digest(manifestBytes) === manifestHash, 'PRODUCT_MANIFEST_HASH')
  const rows = manifestBytes.toString('utf8').trimEnd().split('\n')
    .map(line => /^([0-9a-f]{64})  ([^\u0000]+)$/.exec(line))
  check(rows.length === 28 && rows.every(Boolean), 'FILE_MANIFEST_FORMAT')
  const expected = new Map(rows.map(([, sha, path]) => [path, sha]))
  check(expected.size === 28, 'DUPLICATE_PATH')
  const paths = (base, tip) => git('diff', '--name-only', '-z', '--no-renames', base, tip)
    .toString().split('\0').filter(Boolean).sort()
  check(JSON.stringify(paths(release, target)) === JSON.stringify([...expected.keys()].sort()), 'UNAUTHORIZED_PATH')
  for (const [path, sha] of expected) {
    const entry = text('ls-tree', target, '--', path)
    check(entry.startsWith('100644 blob ') && digest(git('show', target + ':' + path)) === sha, 'FILE_HASH:' + path)
  }
  const protectedPaths = [...expected.keys()].filter(path => path.startsWith('prisma/'))
  check(protectedPaths.length === 8 && expected.get(managedMigration) === migrationHash, 'PROTECTED_SET')
  for (const path of protectedPaths.filter(path => path !== managedMigration)) {
    check(digest(git('show', mainBefore + ':' + path)) === expected.get(path), 'PRISMA_SOURCE_DRIFT:' + path)
  }
  check(digest(git('show', mainBefore + ':' + managedMigration)) !== migrationHash, 'EXPECTED_MAIN_VARIANT_ABSENT')
  if (rehearsal) return { state: 'REHEARSAL_ONLY', candidate, paths: expected.size, protected: protectedPaths.length }

  // Production proof reads actual GitHub refs against the pinned URL, never a synthetic ref.
  const refs = new Map(text('ls-remote', '--heads', gitUrl, 'refs/heads/main', 'refs/heads/release', productBranch, controlBranch)
    .split('\n').map(line => line.split('\t').reverse()))
  const main = refs.get('refs/heads/main')
  check(main && main === text('rev-parse', 'origin/main'), 'TRUSTED_MAIN_NOT_CURRENT')
  check(refs.get('refs/heads/release') === release && refs.get(productBranch) === candidate, 'LIVE_RELEASE_OR_PRODUCT_CHANGED')
  git('merge-base', '--is-ancestor', mainBefore, main)
  if (!forApp) {
    const live = JSON.parse(execFileSync('vercel', ['api','/v13/deployments/light-ops-assistant.vercel.app',
      '--method','GET','--scope','sunxiaojian0910-2556s-projects','--non-interactive'],
      { timeout: 25000, stdio: ['ignore','pipe','pipe'] }).toString())
    check(live.projectId === 'prj_Ld76p2KNULYeu7mcf40vTG0EprY1' && live.target === 'production' &&
          live.meta?.githubCommitSha === release && live.readyState === 'READY', 'PRODUCTION_BASE_CHANGED')
  }
  const approvalBytes = git('show', main + ':' + approvedRecordPath)
  const approval = JSON.parse(approvalBytes)
  check(approval.productionPreflight?.sha === release &&
    approval.productionPreflight?.deploymentId === productionDeployment &&
    approval.productionPreflight?.state === 'READY' &&
    Number.isFinite(Date.parse(approval.productionPreflight.observedAt)) &&
    Date.parse(approval.productionPreflight.observedAt) >= Date.parse(approval.issuedAt) &&
    Date.parse(approval.productionPreflight.observedAt) <= Date.now(), 'PRODUCTION_PREFLIGHT_NOT_BOUND')
  check(validWindow(approval, Date.now()), 'APPROVAL_NOT_CURRENT')
  check(approval.status === 'APPROVED' && approval.approvedBy === 'Founder'
        && approval.releaseBase === release && approval.candidate === candidate
        && approval.candidateTree === candidateTree && approval.manifestSha256 === manifestHash
        && approval.path === 'B' && approval.runtime === 'R2'
        && /^[0-9a-f]{40}$/.test(approval.signingControlSha) && refs.get(controlBranch) === approval.signingControlSha
        && /^[0-9a-f]{64}$/.test(approval.independentReviewSha256)
        && /^[0-9a-f]{64}$/.test(approval.founderRecordSha256), 'APPROVAL_NOT_BOUND')
  check(typeof mainWorktree === 'string' && mainWorktree.length > 0, 'FROZEN_MAIN_WORKTREE_REQUIRED')
  const mainRoot = resolve(mainWorktree)
  const mainGit = (...args) => execFileSync('git',['--no-replace-objects','-C',mainRoot,...args],
    { timeout: 15000, stdio:['ignore','pipe','pipe'] }).toString().trim()
  check(mainGit('rev-parse','HEAD') === main && mainGit('rev-parse','origin/main') === main &&
    canonicalUrls.has(mainGit('remote','get-url','origin')) && !mainGit('status','--porcelain=v1','--untracked-files=all'),
    'FROZEN_MAIN_WORKTREE_MISMATCH')
  const frozen = execFileSync(process.execPath, ['scripts/governance/es-native-inventory-m1-successor.cjs'],
    { cwd:mainRoot, timeout:25000, stdio:['ignore','pipe','pipe'] }).toString()
  check(frozen.startsWith('REMOTE AUTHORITY PASS: non-production M1 Frozen Successor'), 'FROZEN_MAIN_NOT_PASS')
  const reviewBytes = git('show', main + ':' + independentPath)
  const founderBytes = git('show', main + ':' + founderPath)
  check(digest(reviewBytes) === approval.independentReviewSha256 &&
        digest(founderBytes) === approval.founderRecordSha256, 'REVIEW_OR_FOUNDER_EVIDENCE_HASH')
  const review = JSON.parse(reviewBytes)
  const founder = JSON.parse(founderBytes)
  check(review.result === 'PASS' && review.kind === 'INDEPENDENT_READ_ONLY' &&
        review.candidate === candidate && review.manifestSha256 === manifestHash &&
        review.releaseBase === release &&
        digest(readFileSync(fileURLToPath(import.meta.url))) === review.verifierSha256,
        'INDEPENDENT_REVIEW_NOT_BOUND')
  check(founder.candidate === candidate && founder.path === 'B' && founder.runtime === 'R2' &&
        founder.independentReviewSha256 === approval.independentReviewSha256 &&
        founder.manifestSha256 === manifestHash && founder.managedMigrationSha256 === migrationHash &&
        founder.issuedAt === approval.issuedAt && founder.expiresAt === approval.expiresAt &&
        founder.signingControlSha === approval.signingControlSha &&
        founder.productionPreflight?.sha === approval.productionPreflight.sha &&
        founder.productionPreflight?.deploymentId === approval.productionPreflight.deploymentId &&
        founder.productionPreflight?.state === approval.productionPreflight.state &&
        founder.productionPreflight?.observedAt === approval.productionPreflight.observedAt &&
        founder.admissionStatus === 'APPROVED', 'FOUNDER_ADMISSION_NOT_BOUND')
  check(/^[0-9a-f]{40}$/.test(approval.sourceCommit), 'SOURCE_COMMIT')
  git('merge-base', '--is-ancestor', mainBefore, approval.sourceCommit)
  git('merge-base', '--is-ancestor', approval.sourceCommit, main)
  const registration = text('show','-s','--format=%P',approval.sourceCommit)
  check(/^[0-9a-f]{40}$/.test(registration) &&
        text('show','-s','--format=%P',registration) === mainBefore &&
        text('show','-s','--format=%P',main) === approval.sourceCommit &&
        JSON.stringify(paths(registration,approval.sourceCommit)) === JSON.stringify([managedMigration]), 'MAIN_SOURCE_DELTA')
  const scope = JSON.parse(git('show', registration + ':' + scopePath))
  check(scope.status === 'ACTIVE' && scope.approvedBy === 'Founder' &&
        scope.authorizationType === 'FOUNDER_APPROVED_TASK_SCOPED_EXCEPTION' &&
        scope.trustedRef === 'origin/main' && scope.taskId === 'ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B' &&
        scope.baseOriginMainSha === mainBefore && scope.authorizedPaths?.length === 1 &&
        scope.authorizedPaths[0] === managedMigration &&
        scope.authorizedPathSha256?.[managedMigration] === migrationHash, 'V6_SCOPE_NOT_BOUND')
  for (const path of protectedPaths) {
    check(digest(git('show', approval.sourceCommit + ':' + path)) === expected.get(path) &&
          digest(git('show', main + ':' + path)) === expected.get(path), 'APPROVED_SOURCE_HASH:' + path)
  }
  const api = path => JSON.parse(execFileSync('gh', ['api', path],
    { timeout: 15000, stdio: ['ignore','pipe','pipe'] }).toString())
  const rules = api('repos/' + canonicalRepo + '/rules/branches/release')
  const context = 'eshop/selective-release-validator'
  check(rules.some(rule => rule.ruleset_id === 26426184 &&
    rule.parameters?.required_status_checks?.some(entry =>
      entry.context === context && entry.integration_id === 5590705)), 'EXACT_APP_RULESET_MISSING')
  const recordSha256 = digest(approvalBytes)
  if (forApp) return { state:'VERIFIED_FOR_SIGNING',candidate,main,paths:expected.size,recordSha256,
    issuedAt:approval.issuedAt,expiresAt:approval.expiresAt,
    description:'Diamond B/R2 ' + recordSha256 }
  // GitHub's combined-status object omits creator. The detailed list is
  // newest-first, so a stale success cannot override a newer pending or failure.
  const statuses = api('repos/' + canonicalRepo + '/commits/' + candidate + '/statuses?per_page=100')
  const verified = hasExactAppSuccess(statuses, {
    issuedAt: approval.issuedAt, expiresAt: approval.expiresAt, recordSha256,
  })
  return { state: verified ? 'VERIFIED_ADMISSION' : 'VERIFIED_EVIDENCE_ONLY', candidate, main, paths: expected.size }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [root, target, manifest, mode, mainWorktree] = process.argv.slice(2)
    check((process.argv.length === 6 && mode === '--rehearsal') ||
      (process.argv.length === 7 && ['--verify-live','--verify-for-app'].includes(mode) && mainWorktree), 'USAGE')
    const result = verify(root, target, readFileSync(manifest), { rehearsal: mode === '--rehearsal', mainWorktree, forApp: mode === '--verify-for-app' })
    console.log(JSON.stringify(result))
    if (result.state === 'REHEARSAL_ONLY') process.exitCode = 3
    if (result.state === 'VERIFIED_EVIDENCE_ONLY') process.exitCode = 4
  } catch (error) {
    // Omit subprocess stderr because the live API output is private.
    console.error('BLOCKED: ' + (error.code ? error.code : error.message.split('\n', 1)[0]))
    process.exitCode = 1
  }
}

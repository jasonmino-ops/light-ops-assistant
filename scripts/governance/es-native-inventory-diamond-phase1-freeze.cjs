'use strict'

const { createHash } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')

const BASE = 'db16177d311dc6b070f98f5dc2ebb8048c9e5957'
const CANDIDATE = 'cf3960dc953eb58c48dd50edefe605aa4327abd8'
const TASK = 'ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B'
const MAIN_VERIFIER = 'scripts/governance/es-native-inventory-m1-main-successor.cjs'
const HANDOFF = 'scripts/governance/es-native-inventory-diamond-phase1-freeze.cjs'
const V6 = 'prisma/migrations/20261112133000_isolate_native_inventory_capability/migration.sql'
const PRIOR_V6_SHA = 'f45c016172da6d3b873a60e517fd5e3f733056fad55a850a45c0abc30e198783'
const V6_SHA = '94ddb2a8ef3ebff029437361e31033ca9a5e31aeaf64ecffd6523ac11d4ca8f8'
const MANIFEST_SHA = '8d0e4e2193795e234ae5c867339b03b487598cb0bb15ad5e8ac0cb2c2ee19a2b'
const RECORD = 'docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-ADMISSION.json'
const SCOPE = 'docs/change-gates/exceptions/' + TASK + '.json'
const REVIEW = 'docs/freezes/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-INDEPENDENT-REVIEW.json'
const FOUNDER = 'docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-PHASE1-B-FOUNDER-RECORD.json'
const B_CHECK = 'scripts/governance/verify-diamond-phase1-b.mjs'
const POLICY = 'docs/governance/ES-RELEASE-DIAMOND-PHASE1-B-ADDENDUM.md'
const GOVERNANCE = [MAIN_VERIFIER, HANDOFF, B_CHECK, POLICY, SCOPE, REVIEW, FOUNDER]
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const samePaths = (a, b) => a.length === b.length && a.every(path => b.includes(path))

function verifyDiamondPhase1Freeze({ git, text, blob, parents, pathsBetween, matches, atHead, trusted, head, branch, root }) {
  if (head !== trusted || !['main', ''].includes(branch)) return null
  if (!['git@github.com:jasonmino-ops/light-ops-assistant.git','https://github.com/jasonmino-ops/light-ops-assistant.git'].includes(text('remote','get-url','origin'))) return null
  git('merge-base','--is-ancestor',BASE,head)
  const chain = text('rev-list','--first-parent','--reverse',BASE + '..' + head).split('\n').filter(Boolean)
  if (chain.length < 3) return null
  const [registration, source, closure] = chain
  if (parents(registration).join(' ') !== BASE || parents(source).join(' ') !== registration ||
      parents(closure).join(' ') !== source ||
      !samePaths(pathsBetween(BASE, registration), GOVERNANCE) ||
      !samePaths(pathsBetween(registration, source), [V6]) ||
      !samePaths(pathsBetween(source, closure), [SCOPE, RECORD])) return null

  const proof = JSON.parse(blob(closure, RECORD))
  const fold = JSON.parse(blob(registration, FOUNDER))
  const review = JSON.parse(blob(registration, REVIEW))
  const active = JSON.parse(blob(registration, SCOPE))
  const closed = JSON.parse(blob(closure, SCOPE))
  const { closedAt, featureMergeCommitSha, ...closedFields } = closed
  if (proof.status !== 'APPROVED' || proof.approvedBy !== 'Founder' ||
      proof.path !== 'B' || proof.runtime !== 'R2' || proof.candidate !== CANDIDATE ||
      proof.sourceCommit !== source || proof.manifestSha256 !== MANIFEST_SHA ||
      proof.founderRecordSha256 !== sha(blob(registration, FOUNDER)) ||
      proof.independentReviewSha256 !== sha(blob(registration, REVIEW)) ||
      !samePaths(Object.keys(proof.governancePathsSha256 ?? {}), GOVERNANCE.filter(p => p !== SCOPE)) ||
      !atHead(RECORD, sha(blob(closure, RECORD))) || !atHead(SCOPE, sha(blob(closure, SCOPE))) ||
      !matches(BASE, V6, PRIOR_V6_SHA) || !matches(source, V6, V6_SHA) || !atHead(V6, V6_SHA)) return null
  const reviewable = [MAIN_VERIFIER, HANDOFF, B_CHECK, POLICY]
  if (fold.candidate !== CANDIDATE || fold.admissionStatus !== 'APPROVED' ||
      fold.managedMigrationSha256 !== V6_SHA || fold.path !== 'B' || fold.runtime !== 'R2' ||
      fold.issuedAt !== proof.issuedAt || fold.expiresAt !== proof.expiresAt ||
      !(Date.parse(fold.issuedAt) < Date.parse(fold.expiresAt)) ||
      fold.independentReviewSha256 !== proof.independentReviewSha256 ||
      review.kind !== 'INDEPENDENT_READ_ONLY' || review.result !== 'PASS' ||
      review.candidate !== CANDIDATE || review.verifierSha256 !== proof.governancePathsSha256[B_CHECK] ||
      !samePaths(Object.keys(review.governancePathsSha256 ?? {}), reviewable) ||
      !reviewable.every(path => review.governancePathsSha256[path] === proof.governancePathsSha256[path]) ||
      !Object.entries(proof.governancePathsSha256).every(([path, hash]) =>
        matches(registration,path,hash) && atHead(path,hash))) return null

  const { validateException, evaluateFile } = require('../guards/check-change-scope.js')
  const scope = validateException(active,root)
  validateException(closed,root)
  const config = JSON.parse(blob(BASE,'docs/change-gates/gate-config.json'))
  if (scope.status !== 'ACTIVE' || scope.taskId !== TASK || scope.baseOriginMainSha !== BASE ||
      !samePaths(scope.authorizedPaths,[V6]) || scope.authorizedPathSha256[V6] !== V6_SHA ||
      !evaluateFile({ filePath: V6, repoRoot:root, taskId:TASK, currentBranch:scope.featureBranch,
        config, exception:scope, contentHashResolver:p=>sha(blob(source,p)) }).allowed ||
      featureMergeCommitSha !== source || closed.status !== 'CLOSED' ||
      Date.parse(closedAt) !== Number(text('show','-s','--format=%ct',closure))*1000 ||
      !isDeepStrictEqual({...closedFields,status:'ACTIVE'},active)) return null

  return { registration, accepted:new Set([registration,source,closure]), protectedPaths:[...GOVERNANCE, RECORD], legacyVerifierSha256:sha(blob(BASE, MAIN_VERIFIER)),
    successors:new Map([[MAIN_VERIFIER,proof.governancePathsSha256[MAIN_VERIFIER]],[V6,V6_SHA]]) }
}
module.exports = { RECORD, MAIN_VERIFIER, verifyDiamondPhase1Freeze }

// One exact successor inside the existing protected App workflow. Not a generic signer.
import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, appendFileSync, mkdtempSync, existsSync, rmSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repo = 'jasonmino-ops/light-ops-assistant', origin = 'https://github.com/' + repo + '.git'
const controlRef = 'refs/heads/codex/release-validator-control'
const appId = 5590705, installationId = 178077967, creatorId = 351820557
const context = 'eshop/selective-release-validator'
const prefix = 'Dining performance '
const manifestPath = '.github/release-validator/print-device-takeover.json'
const manifestSha = '9d96feec9a01da32dae1d184fb075b5173a0c531c56b5472f079a332f6d3de69'
const rawManifest = readFileSync(new URL('./print-device-takeover.json', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(rawManifest), manifestSha)
export const manifest = JSON.parse(rawManifest)
export const controlPaths = [manifestPath, '.github/release-validator/print-device-takeover.mjs',
  '.github/release-validator/print-device-takeover.test.mjs', '.github/workflows/selective-release-validator.yml'].sort()
const admissionPath = 'docs/releases/ES-STD9E5497D-FIELD-STABILITY-01-B.json'
const receiptPath = 'docs/releases/evidence/ES-STD9E5497D-FIELD-STABILITY-01-B/founder-release.md'
const reviewPath = 'docs/releases/evidence/ES-STD9E5497D-FIELD-STABILITY-01-B/controller-review.json'
const evidencePath = 'docs/releases/evidence/ES-STD9E5497D-FIELD-STABILITY-01-B/validation-evidence.json'
export const registrationPaths = [admissionPath, receiptPath, reviewPath, evidencePath].sort()
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C',
  GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
const bytes = (...args) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
  { env: cleanEnv, timeout: 30000, maxBuffer: 16*1024*1024, stdio: ['ignore', 'pipe', 'pipe'] })
const git = (...args) => bytes(...args).toString().trim()
const paths = (a,b) => bytes('diff','--no-renames','--name-only','-z',a,b).toString().split('\0').filter(Boolean).sort()
const blob = (commit, path) => {
  assert(/^(100644|100755) blob /.test(git('ls-tree',commit,'--',path)), 'Regular file required: '+path)
  return bytes('show',commit+':'+path)
}
export function canonicalOrigin(value) { return [origin, origin.slice(0,-4)].includes(value) }

export function candidateShape({ candidate, tree, changedPaths, deltaCount }) {
  assert.equal(candidate,manifest.candidate); assert.equal(tree,manifest.tree)
  assert.equal(deltaCount,1)
  assert.deepEqual([...changedPaths].sort(),manifest.paths.map(p=>p.path).sort())
}
export const controllerDigest = hashes => sha(Buffer.from(JSON.stringify(controlPaths.map(p=>[p,hashes[p]]))))
export function verifyAuthorization(record, receipt, review, control, now=Date.now()) {
  assert.equal(record.releaseId,manifest.releaseId)
  assert.deepEqual(record.taskIds,[manifest.taskId])
  assert.equal(record.releaseSha,manifest.candidate); assert.equal(record.releaseTree,manifest.tree)
  assert.equal(record.baseProductionSha,manifest.base); assert.equal(record.sourceMainSha,manifest.sourceMainSha)
  assert.equal(record.productionDeployment,manifest.productionDeployment)
  assert.equal(record.control,control); assert.match(control,/^[0-9a-f]{40}$/)
  assert.equal(record.manifestSha256,manifestSha)
  assert.deepEqual(record.includedSourceCommits,manifest.includedSourceCommits)
  const auth=record.founderAuthorization
  assert.equal(auth.approvedBy,'Founder');assert.equal(auth.status,'APPROVED')
  assert.equal(auth.authorizationId,manifest.authorizationId)
  assert.deepEqual(auth.includedSourceCommits,manifest.includedSourceCommits)
  const issued=Date.parse(auth.approvedAt),expires=Date.parse(record.expiresAt)
  assert(Number.isFinite(issued)&&issued<=now&&now<expires,'Final release approval missing, future or expired')
  const earliest=Date.parse(manifest.authorizationWindowStart)
  assert(issued>=earliest&&issued<expires)
  assert.equal(record.expiresAt,manifest.deadlineExclusive)
  assert.equal(expires-earliest,manifest.signatureLifetimeSeconds*1000)
  const decisionLines=receipt.split(String.fromCharCode(10)).filter(line=>line.startsWith('FOUNDER_DECISION_UTC='))
  assert.deepEqual(decisionLines,['FOUNDER_DECISION_UTC='+auth.approvedAt])
  assert.equal(new Date(issued).toISOString(),auth.approvedAt)
  assert(receipt.includes(manifest.authorizationWindowStart),'Signature must cover fixed opening time')
  assert.equal(record.frozenPayloadSha256,manifest.evidenceHashes['frozen-payload.json'])
  assert.equal(record.dispositionSha256,manifest.evidenceHashes['failure-disposition.json'])
  assert.deepEqual(record.rawIntegration,{status:'BLOCKED',expected:22,executed:22,pass:19,fail:3,skip:0})
  assert.equal(record.authorizationReceiptSha256,sha(Buffer.from(receipt)))
  assert.deepEqual(Object.keys(record.controllerSha256).sort(),controlPaths)
  for(const value of Object.values(record.controllerSha256)) assert.match(value,/^[0-9a-f]{64}$/)
  assert.equal(record.controllerDigest,controllerDigest(record.controllerSha256))
  for(const term of [control,manifest.previousControl,manifest.previousRegistration,manifest.projection,record.frozenPayloadSha256,record.dispositionSha256,auth.authorizationId,manifest.candidate,manifest.tree,manifest.base,manifestSha,
    record.controllerDigest,manifest.mainBase,...manifest.includedSourceCommits,
    '批准精确堂食性能登记、一次App签发及受保护release快进部署',manifest.deadlineExclusive])
    assert(receipt.includes(term),'Missing exact final Founder authority: '+term)
  for(const flag of ['issuerInstallationAuthorized','statusPublicationAuthorized','releaseExecutionAuthorized',
    'releaseExecutionRequiresUnexpiredAppStatus']) assert.equal(record[flag],true)
  for(const flag of ['migrationAuthorized','terminalMutationAuthorized','pilotOrFeedMutationAuthorized',
    'defaultSelectiveValidatorChanged']) assert.equal(record[flag],false)
  assert.equal(record.migrationCount,0)
  assert.equal(record.signatureLifetimeSeconds,manifest.signatureLifetimeSeconds)
  assert.equal(record.acceptance,'ACCEPTED_WITH_EXACT_DINING_COVERAGE_AND_CURRENT_FAILURE_DISPOSITION')
  assert.deepEqual(record.rawCORE,{status:'BLOCKED',expected:104,executed:104,pass:100,fail:4,skip:0})
  // Historical complete executions stay bound to their original SHAs; never relabel them as fresh B runs.
  assert.equal(record.rawCORECandidate,'65a23a780d16d607a0f8f818289e96c886eb1a60')
  assert.equal(record.rawIntegrationCandidate,record.rawCORECandidate)
  assert.equal(record.rawProductCORECandidate,'746ead6adb1f01784d7353e73de45cdd79400efb')
  assert.deepEqual(record.rawProductCORE,{status:'BLOCKED',expected:105,executed:105,pass:102,fail:3,skip:0})
  assert.equal(record.coverageSha256,manifest.evidenceHashes['coverage.json'])
  assert.equal(record.currentFailureDispositionAuthorized,true)
  assert.equal(review.verdict,'PASS');assert.equal(review.readOnly,true);assert.equal(review.freshContext,true)
  assert.equal(review.notFounderOrAppSigner,true)
  assert.equal(review.candidate,manifest.candidate);assert.equal(review.tree,manifest.tree)
  assert.equal(review.manifestSha256,manifestSha)
  assert.deepEqual(review.controllerSha256,record.controllerSha256)
  assert.equal(review.evidenceSha256,sha(Buffer.from(review.evidence)))
  assert(review.evidence.length>100)
  assert.equal(record.reviewReceiptSha256,sha(Buffer.from(JSON.stringify(review,null,2)+'\n')))
  assert.equal(record.deploymentId,'PENDING');assert.equal(record.productionSha,'PENDING')
}
// B-only complete coverage: retained PASS inputs and fresh failure rechecks are distinct from a new full run.
export function verifyCoverage(coverage) {
  assert.equal(coverage.status,'COMPLETE_COVERAGE_WITH_CURRENT_FAILURE_DISPOSITION_REQUEST')
  assert.equal(coverage.notANewFullSuiteExecution,true)
  assert.deepEqual(Object.keys(coverage.suites).sort(),Object.keys(manifest.coverageSpecs).sort())
  for(const [name,spec] of Object.entries(manifest.coverageSpecs)) {
    const lane=coverage.suites[name], fixed=JSON.parse(blob(spec.candidate,spec.manifest))
    assert.equal(lane.candidate,spec.candidate);assert.equal(lane.originalRunSha,spec.oldRunSha)
    assert.equal(lane.rawStatus,'BLOCKED');assert.equal(lane.expected,spec.expected)
    assert.equal(fixed.expectedCount,spec.expected)
    for(const key of ['skipped','unknown','uncollected']) assert.equal(lane[key],0)
    assert.equal(lane.entries.length,spec.expected)
    assert.deepEqual(lane.entries.map(x=>x.file).sort(),fixed.tests.map(x=>x.file).sort())
    const counts={REUSED_UNCHANGED_PASS:0,REUSED_EXACT_TREE_PASS:0,FRESH_FAILURE_RECHECK:0},failed=[]
    for(const entry of lane.entries) {
      assert(Object.hasOwn(counts,entry.mode));counts[entry.mode]++
      assert.equal(entry.testFileSha256,sha(blob(spec.candidate,entry.file)))
      if(entry.mode==='FRESH_FAILURE_RECHECK') {
        assert.equal(entry.originalStatus,'FAIL');assert.equal(entry.currentStatus,'FAIL')
        assert.equal(entry.freshExit,1);assert.equal(entry.baselineMatchesCandidate,true);failed.push(entry.file)
        for(const k of ['freshEvidenceSha256','baselineEvidenceSha256']) assert.match(entry[k],/^[a-f0-9]{64}$/)
      } else {
        assert.equal(entry.originalStatus,'PASS');assert.equal(entry.originalExit,0);assert.equal(entry.currentStatus,'PASS')
        if(entry.mode==='REUSED_UNCHANGED_PASS') {
          assert.equal(entry.oldTestFileSha256,sha(blob(spec.oldRunSha,entry.file)))
          assert.equal(entry.oldTestFileSha256,entry.testFileSha256)
          assert.equal(entry.inputAuditSha256,manifest.evidenceHashes['reuse-review.json'])
        } else {
          assert.equal(entry.file,'tests/dine-in-m1-contract.test.ts');assert.equal(entry.assertions,24)
          assert.equal(git('rev-parse',entry.executedOn+'^{tree}'),git('rev-parse',spec.candidate+'^{tree}'))
          assert.equal(entry.executedTree,git('rev-parse',spec.candidate+'^{tree}'))
          assert.equal(entry.testFileSha256,sha(blob(entry.executedOn,entry.file)))
        }
      }
    }
    assert.deepEqual(counts,{REUSED_UNCHANGED_PASS:spec.unchangedPass,REUSED_EXACT_TREE_PASS:spec.b24,FRESH_FAILURE_RECHECK:spec.freshFailureFiles})
    assert.deepEqual(failed.sort(),spec.failureFiles)
    assert.equal(lane.reusedUnchangedPass,spec.unchangedPass);assert.equal(lane.reusedExactTreeB24,spec.b24)
    assert.equal(lane.freshFailureFiles,spec.freshFailureFiles)
  }
}
export function verifyFailureDisposition(value,now=Date.now()) {
  assert.equal(value.schema_version,1);assert.equal(value.status,'REQUEST_ONLY_UNTIL_EXACT_FOUNDER_ACCEPTANCE')
  assert.equal(value.candidate,manifest.candidate);assert.equal(value.product,manifest.mainBase)
  assert.equal(value.source,manifest.includedSourceCommits[0]);assert.equal(value.base,manifest.base)
  assert.equal(value.expiresAt,manifest.deadlineExclusive);assert(now<Date.parse(value.expiresAt),'Failure evidence expired')
  assert.equal(value.raw_status,'BLOCKED');assert.equal(value.oldExpiredAuthorizationInherited,false)
  assert.deepEqual(value.candidateTriggeredFailures,[]);assert.deepEqual(value.newFailures,[])
  assert.equal(value.actualPostRegistrationReadbackRequired,true)
  assert.deepEqual(Object.keys(value.suites).sort(),Object.keys(manifest.coverageSpecs).sort())
  for(const [name,spec] of Object.entries(manifest.coverageSpecs)) {
    assert.deepEqual(value.suites[name].map(x=>x.file).sort(),spec.failureFiles)
    for(const item of value.suites[name]) {
      assert.equal(item.candidate,spec.candidate);assert.equal(item.baselineExit,1);assert.equal(item.candidateExit,1)
      assert.equal(item.baselineMatchesCandidate,true);assert.equal(item.attribution,'baseline_reproduced')
      assert.equal(item.status,'RAW_FAIL_RETAINED_NO_WAIVER');assert.equal(item.unreachedAssertionsStillUnexecuted,true)
      assert(item.assertionSignature.length>0);assert.match(item.assertionFingerprint,/^[a-f0-9]{64}$/)
    }
  }
}
// Literal Workflow V2 known-failure annexes, bound to this finite B evidence set.
export function verifyFailureAnnex(annex,name) {
  const spec=manifest.coverageSpecs[name];assert(spec)
  assert.equal(annex.schema_version,1);assert.equal(annex.status,'REQUEST_ONLY_UNTIL_EXACT_FOUNDER_ACCEPTANCE')
  assert.deepEqual(annex.baseline,{sha:spec.freshBaseline,tree:git('rev-parse',spec.freshBaseline+'^{tree}')})
  assert.deepEqual(annex.candidate,{sha:spec.candidate,tree:git('rev-parse',spec.candidate+'^{tree}')})
  assert.equal(annex.environment_toolchain_config_sha256,manifest.evidenceHashes['toolchain-inputs.json'])
  assert.equal(annex.raw_status,'BLOCKED');assert.match(annex.failure_set_sha256,/^[a-f0-9]{64}$/)
  for(const key of ['baseline_evidence','candidate_evidence']) assert.equal(annex[key].sha256,manifest.evidenceHashes[annex[key].path])
  assert.deepEqual(annex.failures.map(x=>x.assertion).sort(),spec.assertionIds)
  for(const item of annex.failures) {
    assert(spec.failureFiles.includes(item.test_id));assert.equal(item.attribution,'baseline_reproduced')
    assert.equal(item.expires_at,manifest.deadlineExclusive);assert.match(item.fingerprint,/^[a-f0-9]{64}$/)
    assert.equal(item.evidence.sha256,manifest.evidenceHashes[item.evidence.path])
    for(const key of ['expected','actual','diagnostic_or_exit_code']) assert.equal(typeof item[key],'string')
  }
  for(const key of ['failure_set_change','result_change','input_change','candidate_or_baseline_change','expiry','revoked_authority']) assert(annex.invalidate_on.includes(key))
}
export function verifyEvidence(raw) {
  assert.equal(sha(raw),manifest.evidenceBundleSha256)
  const evidence=JSON.parse(raw)
  assert.equal(evidence.status,'PINNED_REUSED_AND_FRESH_EVIDENCE_NOT_NEW_FULL_SUITE_EXECUTION')
  assert.equal(evidence.candidate,manifest.candidate);assert.equal(evidence.tree,manifest.tree)
  assert.equal(evidence.source,manifest.includedSourceCommits[0]);assert.equal(evidence.main,manifest.mainBase)
  assert.equal(evidence.rawIntegrationStatus,'BLOCKED');assert.equal(evidence.base,manifest.base);assert.equal(evidence.rawCoreStatus,'BLOCKED')
  assert.deepEqual(Object.keys(evidence.files).sort(),Object.keys(manifest.evidenceHashes).sort())
  for(const [name,digest] of Object.entries(manifest.evidenceHashes)) {
    assert.equal(evidence.files[name].sha256,digest)
    assert.equal(sha(Buffer.from(evidence.files[name].base64,'base64')),digest)
  }
  verifyCoverage(JSON.parse(Buffer.from(evidence.files['coverage.json'].base64,'base64')))
  verifyFailureDisposition(JSON.parse(Buffer.from(evidence.files['failure-disposition.json'].base64,'base64')))
  for(const [name,spec] of Object.entries(manifest.coverageSpecs)) verifyFailureAnnex(JSON.parse(Buffer.from(evidence.files[spec.annex].base64,'base64')),name)
}
export function verifySource() {
  git('merge-base','--is-ancestor',manifest.sourceMainSha,manifest.mainBase)
  assert.equal(git('replace','-l'),'');assert.equal(git('rev-parse','--is-shallow-repository'),'false')
  const delta=git('rev-list','--reverse','--first-parent',manifest.base+'..'+manifest.candidate).split('\n')
  candidateShape({candidate:manifest.candidate,tree:git('rev-parse',manifest.candidate+'^{tree}'),
    changedPaths:paths(manifest.base,manifest.candidate),deltaCount:delta.length})
  let parent=manifest.base
  for(let i=0;i<delta.length;i++) {
    assert.equal(git('show','-s','--format=%P',delta[i]),parent)
    assert.equal(git('show','-s','--format=%P',manifest.includedSourceCommits[i]).split(' ').length,1)
    git('merge-base','--is-ancestor',manifest.includedSourceCommits[i],manifest.sourceMainSha)
    const mapped=[...git('show','-s','--format=%B',delta[i]).matchAll(/\(cherry picked from commit ([0-9a-f]{40})\)/g)].map(x=>x[1])
    assert.deepEqual(mapped,[manifest.includedSourceCommits[i]])
    parent=delta[i]
  }
  for(const p of manifest.paths) assert.equal(sha(blob(manifest.candidate,p.path)),p.sha256)
  assert(!manifest.paths.some(p=>p.path.startsWith('prisma/')))
  for(const [p,digest] of Object.entries(manifest.trustedEngineering)) {assert.equal(sha(blob(manifest.mainBase,p)),digest);assert.equal(git('ls-tree',manifest.mainBase,'--',p).split(' ')[0],manifest.trustedModes[p])}
}
function readRefs() {
  const refs=['refs/heads/main','refs/heads/release',manifest.productRef,controlRef,manifest.projectionRef]
  const live=new Map(git('ls-remote','--heads',origin,...refs).split('\n').map(line=>line.split('\t').reverse()))
  for(const ref of refs) {
    assert.match(live.get(ref)||'',/^[0-9a-f]{40}$/)
    assert.equal(git('rev-parse','refs/remotes/origin/'+ref.slice(11)),live.get(ref),'Stale checkout ref')
  }
  return live
}
// The original registration and its evidence remain anchored at their reviewed commit.
export function verifyRegistration(main) {
  const original=manifest.previousRegistration
  assert.equal(git('show','-s','--format=%P',original),manifest.mainBase)
  assert.deepEqual(paths(manifest.mainBase,original),registrationPaths)
  assert.deepEqual(git('log','--diff-filter=A','--format=%H',main,'--',admissionPath).split('\n'),[original])
  assert.equal(git('show','-s','--format=%P',main),original,'Require one direct registration successor')
  assert.deepEqual(paths(original,main),[admissionPath,receiptPath,reviewPath].sort())
  assert.deepEqual(paths(manifest.mainBase,main),registrationPaths)
  for(const p of registrationPaths) {
    assert(git('ls-tree',main,'--',p).startsWith('100644 blob '),'Regular registration file required: '+p)
  }
  assert.equal(git('rev-parse',main+':'+evidencePath),git('rev-parse',original+':'+evidencePath))
}
function validated(expectedDigest) {
  assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_EVENT_NAME,'push')
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','Never replay an uncertain signing POST')
  assert.equal(process.env.GITHUB_REPOSITORY,repo);assert.equal(process.env.GITHUB_REF,controlRef)
  const control=process.env.GITHUB_SHA
  assert.equal(git('rev-parse','HEAD'),control);assert.equal(git('remote','get-url','origin'),origin)
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'')
  assert.equal(git('show','-s','--format=%P',control),manifest.previousControl)
  assert.deepEqual(paths(manifest.previousControl,control),controlPaths)
  const refs=readRefs(),main=refs.get('refs/heads/main')
  assert.equal(refs.get(controlRef),control);assert.equal(refs.get('refs/heads/release'),manifest.base)
  assert.equal(refs.get(manifest.productRef),manifest.candidate)
  assert.equal(refs.get(manifest.projectionRef),manifest.projection,'Original tested projection ref drift')
  verifyRegistration(main)
  for(const [p,digest] of Object.entries(manifest.trustedEngineering)) {assert.equal(sha(blob(main,p)),digest,'Trusted engineering input changed: '+p);assert.equal(git('ls-tree',main,'--',p).split(' ')[0],manifest.trustedModes[p])}
  verifySource();verifyEvidence(blob(main,evidencePath))
  // Re-read the actual registered-main operand of the unchanged historical assertion; fixture shape is not authority.
  const frozenPaths=git('diff','--no-renames','--name-only',manifest.registeredFrozenPaths.base,main).split('\n').filter(Boolean)
  assert.equal(frozenPaths.length,manifest.registeredFrozenPaths.actualCount)
  assert.equal(sha(Buffer.from(JSON.stringify(frozenPaths))),manifest.registeredFrozenPaths.actualSha256)
  const raw=blob(main,admissionPath),digest=sha(raw),record=JSON.parse(raw)
  if(expectedDigest!==undefined) assert.equal(digest,expectedDigest)
  const reviewBytes=blob(main,reviewPath)
  assert.equal(sha(reviewBytes),record.reviewReceiptSha256)
  for(const p of controlPaths) {assert.equal(sha(blob(control,p)),record.controllerSha256[p]);assert(git('ls-tree',control,'--',p).startsWith('100644 blob '))}
  verifyAuthorization(record,blob(main,receiptPath).toString(),JSON.parse(reviewBytes),control)
  return {main,digest,record,candidate:manifest.candidate}
}
function defaultSelective(record,main) {
  const dir=realpathSync(mkdtempSync(resolve(tmpdir(),'pos-selective-'))),trusted=resolve(dir,'main'),file=resolve(dir,'record.json')
  try {
    git('worktree','add','--detach',trusted,main)
    // trusted validator is invoked unchanged, against the genuine candidate ref and source map.
    appendFileSync(file,JSON.stringify(record,null,2)+'\n')
    const output=execFileSync('/bin/bash',[resolve(trusted,'scripts/check-selective-release.sh'),
      '--record',file,'--production',manifest.base,'--trusted-ref','origin/main','--release-ref','refs/remotes/origin/'+manifest.productRef.slice(11)],
      {cwd:trusted,env:cleanEnv,timeout:60000,encoding:'utf8'})
    assert(output.includes('AUTHORIZED_SELECTIVE_RELEASE: PASS'))
    return output
  } finally {
    if(existsSync(trusted)) git('worktree','remove','--force',trusted)
    rmSync(dir,{recursive:true,force:true})
  }
}
function preflight() {
  const {main,digest,record}=validated()
  console.log(defaultSelective(record,main).trim())
  console.log('DINING EXACT CANDIDATE + QUALIFIED COVERAGE: PASS; HISTORICAL AND CURRENT RAW FAILURES REMAIN BLOCKED')
  appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\ndigest='+digest+'\n')
}
async function request(path,credential,method='GET',payload) {
  const res=await fetch('https://api.github.com'+path,{method,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+credential,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:payload===undefined?undefined:JSON.stringify(payload)})
  assert(res.ok,method+' failed with '+res.status)
  return res.status===204?null:res.json()
}
export function contextEntries(page) {
  assert(Array.isArray(page)&&page.length<100,'Status history may span multiple pages')
  return page.filter(x=>x.context===context)
}
export async function readIssuedStatus({id,candidate,digest,issuedAt,expiresAt,target,readStatuses,
  wait=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,log=console.log}) {
  assert(Number.isSafeInteger(id)&&id>0)
  assert.equal(candidate,manifest.candidate)
  log(JSON.stringify({event:'status-post-receipt',candidate,recordSha256:digest,statusId:id,issuedAt,expiresAt}))
  for(const delay of [0,500,1500,3000]) {
    if(delay) await wait(delay)
    assert(now()<Date.parse(expiresAt),'Status expired before readback')
    const entries=contextEntries(await readStatuses())
    assert(now()<Date.parse(expiresAt),'Status expired during readback')
    if(!entries.length) continue
    assert.equal(entries.length,1,'Duplicate signing status')
    const [entry]=entries
    assert.equal(entry.id,id,'Readback must be the original POST ID')
    assert.equal(entry.state,'success')
    assert.equal(entry.creator?.id,creatorId)
    assert.equal(entry.creator?.login,'e-shop-release-validator[bot]')
    assert.equal(entry.description,prefix+digest)
    assert.equal(entry.target_url,target)
    const created=Date.parse(entry.created_at)
    assert(created>=Date.parse(issuedAt)&&created<Date.parse(expiresAt)&&now()<Date.parse(expiresAt))
    return
  }
  throw new Error('Original POST returned an ID but remains absent from readback; do not republish')
}

// No POST retries. A missing/uncertain response or readback is HOLD, never permission to republish.
export async function issueOnce({candidate,digest,issuedAt,expiresAt,target,readStatuses,revalidate,postStatus,
  now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}) {
  assert.equal(candidate,manifest.candidate);assert.match(digest,/^[0-9a-f]{64}$/)
  const fresh=()=>assert(Date.parse(issuedAt)>=Date.parse(manifest.authorizationWindowStart)&&Date.parse(issuedAt)<=now()&&now()<Date.parse(expiresAt)&&
    Date.parse(expiresAt)<=Date.parse(manifest.deadlineExclusive)&&
    Date.parse(expiresAt)-Date.parse(issuedAt)<=manifest.signatureLifetimeSeconds*1000,'Expired or excessive status lifetime')
  fresh();assert.equal(contextEntries(await readStatuses()).length,0,'Existing status requires reconciliation; never duplicate POST')
  await revalidate();fresh()
  const sent=await postStatus({state:'success',context,description:prefix+digest,target_url:target})
  await readIssuedStatus({id:sent.id,candidate,digest,issuedAt,expiresAt,target,readStatuses,now,wait,log})
  return sent.id
}
async function publish() {
  assert.match(process.env.ADMISSION_DIGEST||'',/^[0-9a-f]{64}$/)
  const {main,digest,record,candidate}=validated(process.env.ADMISSION_DIGEST)
  assert.equal(process.env.ADMISSION_MAIN,main)
  const pem=Buffer.from(process.env.ESHOP_RELEASE_VALIDATOR_PEM||''); delete process.env.ESHOP_RELEASE_VALIDATOR_PEM
  assert(pem.length>0,'Protected App key unavailable')
  let key
  try { key=createPrivateKey(pem) } finally { pem.fill(0) }
  assert.equal(sha(createPublicKey(key).export({type:'spki',format:'der'})),
    Buffer.from('yhwqkPtVSKmkg3q61U0dLzyUnqhtANv7C32L5q6t01c=','base64').toString('hex'),'Wrong admitted App key')
  const now=Math.floor(Date.now()/1000),enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url')
  const claims=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iat:now-60,exp:now+300,iss:String(appId)})
  const jwt=claims+'.'+sign('RSA-SHA256',Buffer.from(claims),key).toString('base64url')
  const installPath='/app/installations/'+installationId,app=await request(installPath,jwt)
  assert(app.app_id===appId&&app.id===installationId&&app.account?.login==='jasonmino-ops'&&app.suspended_at===null&&
    app.repository_selection==='selected'&&Object.keys(app.permissions||{}).length===2&&app.permissions.metadata==='read'&&app.permissions.statuses==='write','Installation scope changed')
  const {token}=await request(installPath+'/access_tokens',jwt,'POST')
  try {
    const repos=await request('/installation/repositories?per_page=2',token)
    assert(repos.total_count===1&&repos.repositories?.length===1&&repos.repositories[0].full_name===repo)
    const root='/repos/'+repo,info=await request(root+'/commits/'+candidate,token)
    assert.equal(info.sha,candidate); assert.equal(info.commit?.tree?.sha,manifest.tree)
    assert.equal(info.parents?.length,1);assert.equal(info.parents[0].sha,git('show','-s','--format=%P',candidate))
    for(const [id,ref,timestamp,actors] of [
      [26426184,'refs/heads/release','2026-11-03T07:59:36.789Z',[]],
      [27201182,controlRef,'2026-11-13T12:53:32.928Z',[{actor_id:5,actor_type:'RepositoryRole',bypass_mode:'always'}]],
    ]) {
      const policy=await request(root+'/rulesets/'+id,token)
      assert.equal(policy.id,id); assert.equal(policy.enforcement,'active')
      assert.equal(new Date(policy.updated_at).toISOString(),timestamp)
      assert.deepEqual(policy.conditions?.ref_name?.include,[ref]); assert.equal(policy.conditions?.ref_name?.exclude?.length,0)
      if(policy.bypass_actors!==undefined) assert.deepEqual(policy.bypass_actors,actors)
    }
    const rules=await request(root+'/rules/branches/release',token)
    assert(rules.some(r=>r.ruleset_id===26426184&&r.parameters?.required_status_checks?.some(c=>c.context===context&&c.integration_id===appId)))
    const controlRules=await request(root+'/rules/branches/codex%2Frelease-validator-control',token)
    assert(['creation','update','deletion','non_fast_forward'].every(type=>controlRules.some(r=>r.ruleset_id===27201182&&r.type===type)))
    const statusPath=root+'/commits/'+candidate+'/statuses?per_page=100'
    const checked=validated(digest); assert.equal(checked.main,main); assert.equal(checked.candidate,candidate)
    defaultSelective(checked.record,main)
    const issuedAt=new Date(Math.floor(Date.now()/1000)*1000).toISOString()
    const expiresAt=new Date(Math.min(Date.parse(issuedAt)+record.signatureLifetimeSeconds*1000,Date.parse(record.expiresAt))).toISOString()
    const target='https://github.com/'+repo+'/actions/runs/'+process.env.GITHUB_RUN_ID+'#record='+digest+'&expires='+encodeURIComponent(expiresAt)
    await issueOnce({candidate,digest,issuedAt,expiresAt,target,
      readStatuses:()=>request(statusPath+'&page=1',token),
      revalidate:()=>{const final=validated(digest);assert.equal(final.main,main)},
      postStatus:body=>request(root+'/statuses/'+candidate,token,'POST',body)})
    console.log(JSON.stringify({candidate,appId,status:'success',recordSha256:digest,issuedAt,expiresAt}))
  } finally { await request('/installation/token',token,'DELETE') }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===3&&['preflight','publish'].includes(process.argv[2]))
    if(process.argv[2]==='preflight') preflight(); else await publish()
  } catch(error) { console.error('BLOCKED:',error instanceof Error&&!error.cmd?error.message:'Trusted command failed');process.exitCode=1 }
}

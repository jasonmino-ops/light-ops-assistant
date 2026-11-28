import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {manifest,controlPaths,controllerDigest,candidateShape,verifyAuthorization,verifyRegistration,verifyEvidence,verifySource,contextEntries,readIssuedStatus,issueOnce,verifyCoverage,verifyFailureDisposition,verifyFailureAnnex} from './print-device-takeover.mjs'
const sha=x=>createHash('sha256').update(x).digest('hex')
const control='a'.repeat(40),digest='b'.repeat(64)
const at=Date.parse('2026-11-28T17:50:00Z')
export function fixture() {
  const hashes=Object.fromEntries(controlPaths.map(p=>[p,'c'.repeat(64)]))
  const review={verdict:'PASS',candidate:manifest.candidate,tree:manifest.tree,
    manifestSha256:sha(readFileSync(new URL('./print-device-takeover.json',import.meta.url))),
    controllerSha256:hashes,readOnly:true,freshContext:true,notFounderOrAppSigner:true,
    evidence:'ISOLATED SYNTHETIC FIXTURE ONLY. Not Founder approval, formal Acceptance or App status. '.repeat(3)}
  review.evidenceSha256=sha(review.evidence)
  const receipt=['ISOLATED SYNTHETIC FIXTURE NOT ACTUAL AUTHORITY',manifest.authorizationId,control,manifest.previousControl,manifest.previousRegistration,manifest.projection,manifest.candidate,manifest.tree,manifest.base,
    review.manifestSha256,controllerDigest(hashes),manifest.mainBase,...manifest.includedSourceCommits,manifest.authorizationWindowStart,'FOUNDER_DECISION_UTC=2026-11-28T17:47:00.000Z',manifest.evidenceHashes['frozen-payload.json'],manifest.evidenceHashes['failure-disposition.json'],
    '批准精确堂食性能登记、一次App签发及受保护release快进部署',manifest.deadlineExclusive].join('\n')
  const record={releaseId:manifest.releaseId,taskIds:[manifest.taskId],releaseSha:manifest.candidate,releaseTree:manifest.tree,
    baseProductionSha:manifest.base,sourceMainSha:manifest.sourceMainSha,productionDeployment:manifest.productionDeployment,
    control,manifestSha256:review.manifestSha256,includedSourceCommits:manifest.includedSourceCommits,
    founderAuthorization:{approvedBy:'Founder',status:'APPROVED',authorizationId:manifest.authorizationId,approvedAt:'2026-11-28T17:47:00.000Z',includedSourceCommits:manifest.includedSourceCommits},
    expiresAt:manifest.deadlineExclusive,frozenPayloadSha256:manifest.evidenceHashes['frozen-payload.json'],dispositionSha256:manifest.evidenceHashes['failure-disposition.json'],rawIntegration:{status:'BLOCKED',expected:22,executed:22,pass:19,fail:3,skip:0},authorizationReceiptSha256:sha(receipt),controllerSha256:hashes,controllerDigest:controllerDigest(hashes),
    issuerInstallationAuthorized:true,statusPublicationAuthorized:true,releaseExecutionAuthorized:true,releaseExecutionRequiresUnexpiredAppStatus:true,
    migrationAuthorized:false,terminalMutationAuthorized:false,pilotOrFeedMutationAuthorized:false,defaultSelectiveValidatorChanged:false,
    migrationCount:0,signatureLifetimeSeconds:manifest.signatureLifetimeSeconds,acceptance:'ACCEPTED_WITH_EXACT_DINING_COVERAGE_AND_CURRENT_FAILURE_DISPOSITION',
    rawCORE:{status:'BLOCKED',expected:104,executed:104,pass:100,fail:4,skip:0},
    rawCORECandidate:'65a23a780d16d607a0f8f818289e96c886eb1a60',rawIntegrationCandidate:'65a23a780d16d607a0f8f818289e96c886eb1a60',
    rawProductCORECandidate:'746ead6adb1f01784d7353e73de45cdd79400efb',rawProductCORE:{status:'BLOCKED',expected:105,executed:105,pass:102,fail:3,skip:0},
    coverageSha256:manifest.evidenceHashes['coverage.json'],currentFailureDispositionAuthorized:true,
    reviewReceiptSha256:sha(JSON.stringify(review,null,2)+'\n'),deploymentId:'PENDING',productionSha:'PENDING'}
  return {record,review,receipt}
}
test('actual exact B independent source and one-commit release verify',()=>verifySource())
test('candidate shape rejects other candidate/tree/path/count',()=>{
  const good={candidate:manifest.candidate,tree:manifest.tree,changedPaths:manifest.paths.map(p=>p.path),deltaCount:1}
  candidateShape(good)
  for(const bad of [{candidate:control},{tree:control},{deltaCount:2},{changedPaths:[...good.changedPaths,'extra']}]) assert.throws(()=>candidateShape({...good,...bad}))
})
test('synthetic exact release record with bounded qualified RAW BLOCKED verifies',()=>{
  const {record,receipt,review}=fixture();verifyAuthorization(record,receipt,review,control,at)
})
test('prep-only authority, wrong source order, main, base, expiry and expanded permissions reject',()=>{
  const {record,receipt,review}=fixture()
  for(const bad of [{releaseSha:control},{sourceMainSha:control},{baseProductionSha:control},
    {includedSourceCommits:[control]}, {expiresAt:'2026-12-01T00:00:00Z'},
    {rawIntegration:{...record.rawIntegration,status:'PASS'}},{frozenPayloadSha256:digest},{dispositionSha256:digest},{expiresAt:'2026-11-26T02:00:00.001Z'},{migrationAuthorized:true},{migrationCount:1},{terminalMutationAuthorized:true},{pilotOrFeedMutationAuthorized:true},
    {issuerInstallationAuthorized:false},{statusPublicationAuthorized:false},{releaseExecutionAuthorized:false},
    {releaseExecutionRequiresUnexpiredAppStatus:false},{signatureLifetimeSeconds:86400},{defaultSelectiveValidatorChanged:true},
    {rawCORE:{...record.rawCORE,status:'PASS'}},
    {founderAuthorization:{...record.founderAuthorization,status:'PENDING'}},
    {founderAuthorization:{...record.founderAuthorization,approvedAt:'2027-01-01T00:00:00Z'}},
    {controllerSha256:{...record.controllerSha256,'extra.mjs':digest}}, {authorizationReceiptSha256:digest},{reviewReceiptSha256:digest}])
    assert.throws(()=>verifyAuthorization({...record,...bad},receipt,review,control,at))
  assert.throws(()=>verifyAuthorization(record,receipt,review,control,Date.parse(manifest.deadlineExclusive)))
  const missing='Approval for preparation only'
  assert.throws(()=>verifyAuthorization({...record,authorizationReceiptSha256:sha(missing)},missing,review,control,at))
})
test('self review, changed controller and fabricated review content reject',()=>{
  const {record,receipt,review}=fixture()
  for(const bad of [{freshContext:false},{readOnly:false},{notFounderOrAppSigner:false},{verdict:'PARTIAL'},
    {controllerSha256:{}},{evidence:'fabricated'}]) assert.throws(()=>verifyAuthorization(record,receipt,{...review,...bad},control,at))
})
test('unknown, full status pages fail closed',()=>{
  assert.throws(()=>contextEntries(null));assert.throws(()=>contextEntries(Array(100).fill({})))
  assert.deepEqual(contextEntries([{context:'other'}]),[])
})
const issuedAt='2026-11-28T17:50:00.000Z',expiresAt='2026-11-28T19:00:00.000Z',target='https://github.com/example/run'
const entry={id:123,state:'success',context:'eshop/selective-release-validator',description:'Dining performance '+digest,
  creator:{id:351820557,login:'e-shop-release-validator[bot]'},target_url:target,created_at:issuedAt}
const args={candidate:manifest.candidate,digest,issuedAt,expiresAt,target,now:()=>at,wait:async()=>{},log:()=>{}}
test('single synthetic POST then original status-ID readback; no network or key',async()=>{
  let posts=0,reads=0,rechecks=0
  const id=await issueOnce({...args,readStatuses:async()=>++reads<=2?[]:[entry],revalidate:async()=>{rechecks++},
    postStatus:async body=>{posts++;assert.equal(body.context,entry.context);assert.equal(body.description,entry.description);return {id:123}}})
  assert.equal(id,123);assert.equal(posts,1);assert.equal(rechecks,1);assert.equal(reads,3)
})
test('existing/duplicate status or drift stops before POST',async()=>{
  for(const entries of [[entry],[entry,entry]]) {let posts=0
    await assert.rejects(issueOnce({...args,readStatuses:async()=>entries,revalidate:async()=>{},postStatus:async()=>{posts++;return {id:123}}}))
    assert.equal(posts,0)
  }
  let posts=0
  await assert.rejects(issueOnce({...args,readStatuses:async()=>[],revalidate:async()=>{throw Error('ref drift')},postStatus:async()=>{posts++;return {id:123}}}))
  assert.equal(posts,0)
})
test('ambiguous POST failure is never retried',async()=>{
  let posts=0
  await assert.rejects(issueOnce({...args,readStatuses:async()=>[],revalidate:async()=>{},postStatus:async()=>{posts++;throw Error('response lost')}}))
  assert.equal(posts,1)
})
test('wrong App/ID/state/digest/target/time, duplicates and absent readback never republish',async()=>{
  for(const bad of [{id:124},{state:'failure'},{creator:{id:1,login:'human'}},{description:'other '+digest},
    {target_url:'https://evil.example'},{created_at:'2026-11-25T23:00:00Z'}]) {
    let reads=0,posts=0
    await assert.rejects(issueOnce({...args,readStatuses:async()=>++reads===1?[]:[{...entry,...bad}],revalidate:async()=>{},postStatus:async()=>{posts++;return {id:123}}}))
    assert.equal(posts,1)
  }
  for(const result of [[],[entry,entry]]) {let reads=0,posts=0
    await assert.rejects(issueOnce({...args,readStatuses:async()=>++reads===1?[]:result,revalidate:async()=>{},postStatus:async()=>{posts++;return {id:123}}}))
    assert.equal(posts,1)
  }
})
test('expired, evidence-boundary and excessive status lifetime reject before POST',async()=>{
  for(const bad of [{now:()=>Date.parse(expiresAt)},{expiresAt:'2026-11-28T20:50:01Z'},
    {issuedAt:'2026-11-26T12:00:00Z',expiresAt:'2026-11-26T13:00:00Z',now:()=>Date.parse('2026-11-26T12:00:00Z')}]) {
    let posts=0
    await assert.rejects(issueOnce({...args,...bad,readStatuses:async()=>[],revalidate:async()=>{},postStatus:async()=>{posts++;return {id:123}}}))
    assert.equal(posts,0)
  }
})
test('readback retains original ID through eventual consistency, never a second POST',async()=>{
  let reads=0
  await readIssuedStatus({...args,id:123,readStatuses:async()=>++reads<3?[]:[entry]})
  assert.equal(reads,3)
})
test('actual pinned evidence verifies and altered RAW status/content rejects',()=>{
  assert(process.env.PRINT_TAKEOVER_EVIDENCE_BUNDLE,'Provide existing immutable validation-evidence.json fixture')
  const raw=readFileSync(process.env.PRINT_TAKEOVER_EVIDENCE_BUNDLE);verifyEvidence(raw)
  const changed=JSON.parse(raw);changed.rawCoreStatus='PASS'
  assert.throws(()=>verifyEvidence(Buffer.from(JSON.stringify(changed))))
  assert.throws(()=>verifyEvidence(Buffer.concat([raw,Buffer.from(' ')])))
})

test('identical receipt cannot shift start and expiry as a pair, or move the personal decision timestamp',()=>{
  const {record,receipt,review}=fixture()
  const later={...record.founderAuthorization,approvedAt:'2026-11-28T17:48:00.000Z'}
  for(const changed of [
    {...record,founderAuthorization:{...record.founderAuthorization,approvedAt:manifest.authorizationWindowStart}},
    {...record,founderAuthorization:later},
    {...record,founderAuthorization:later,expiresAt:'2026-11-28T19:46:00.000Z'},
    {...record,expiresAt:'2026-11-28T19:00:00.001Z'}
  ]) assert.throws(()=>verifyAuthorization(changed,receipt,review,control,at))
})

const boundEvidence=()=>JSON.parse(readFileSync(process.env.PRINT_TAKEOVER_EVIDENCE_BUNDLE))
const part=name=>JSON.parse(Buffer.from(boundEvidence().files[name].base64,'base64'))
test('B complete audited coverage rejects omissions, duplicates, skips, changed inputs and relabeled failure',()=>{
  const good=part('coverage.json');verifyCoverage(good)
  for(const change of [
    x=>{x.suites.releaseCore.entries.pop()},
    x=>{x.suites.releaseCore.entries[1]=x.suites.releaseCore.entries[0]},
    x=>{x.suites.releaseCore.skipped=1},
    x=>{x.suites.releaseCore.unknown=1},
    x=>{x.suites.releaseCore.entries[0].mode='UNKNOWN'},
    x=>{x.suites.releaseCore.entries[0].testFileSha256='0'.repeat(64)},
    x=>{x.suites.releaseCore.entries.find(e=>e.mode==='FRESH_FAILURE_RECHECK').currentStatus='PASS'},
    x=>{x.suites.releaseCore.originalRunSha=manifest.candidate},
    x=>{x.suites.releaseCore.entries.find(e=>e.mode==='REUSED_EXACT_TREE_PASS').executedOn=manifest.base},
  ]) {const value=structuredClone(good);change(value);assert.throws(()=>verifyCoverage(value))}
})
test('B failure disposition rejects inherited authority, new/missing/changed failures, expiry and false PASS',()=>{
  const good=part('failure-disposition.json');verifyFailureDisposition(good,at)
  for(const change of [
    x=>{x.oldExpiredAuthorizationInherited=true},x=>{x.raw_status='PASS'},
    x=>{x.newFailures=['unexpected']},x=>{x.candidateTriggeredFailures=['unexpected']},
    x=>{x.suites.releaseCore.pop()},x=>{x.suites.releaseCore[0].candidateExit=0},
    x=>{x.suites.releaseCore[0].baselineMatchesCandidate=false},
    x=>{x.suites.releaseCore[0].unreachedAssertionsStillUnexecuted=false},
    x=>{x.expiresAt='2027-01-01T00:00:00.000Z'},
  ]) {const value=structuredClone(good);change(value);assert.throws(()=>verifyFailureDisposition(value,at))}
  assert.throws(()=>verifyFailureDisposition(good,Date.parse(manifest.deadlineExclusive)))
})
test('B cannot reuse historical task authority, false current-run counts or omit exact disposition approval',()=>{
  const {record,receipt,review}=fixture()
  for(const bad of [{releaseId:'ES-V3-REPORT-STALE-ACK-01'},
    {rawCORECandidate:manifest.candidate},{rawIntegrationCandidate:manifest.candidate},
    {rawProductCORECandidate:manifest.mainBase},{coverageSha256:'0'.repeat(64)},
    {currentFailureDispositionAuthorized:false}])
    assert.throws(()=>verifyAuthorization({...record,...bad},receipt,review,control,at))
})

test('literal V2 failure annexes reject missing environment identity, changed source, failure IDs and evidence',()=>{
  for(const [name,spec] of Object.entries(manifest.coverageSpecs)) {
    const good=part(spec.annex);verifyFailureAnnex(good,name)
    for(const change of [x=>{delete x.environment_toolchain_config_sha256},x=>{x.candidate.sha=manifest.base},
      x=>{x.raw_status='PASS'},x=>{x.failures.pop()},x=>{x.failures[0].attribution='UNKNOWN'},
      x=>{x.failures[0].expires_at='2027-01-01T00:00:00.000Z'},x=>{x.failures[0].evidence.sha256='0'.repeat(64)},
      x=>{x.invalidate_on=[]}]) {const value=structuredClone(good);change(value);assert.throws(()=>verifyFailureAnnex(value,name))}
  }
})

test('the original registration and the first decision cannot authorize the successor',()=>{
  assert.throws(()=>verifyRegistration(manifest.previousRegistration))
  const {record,receipt,review}=fixture()
  assert.throws(()=>verifyAuthorization({...record,founderAuthorization:{...record.founderAuthorization,
    authorizationId:'ES-STD9E5497D-FIELD-STABILITY-01-B-RELEASE-20261129'}},receipt,review,control,at))
  for(const term of [control,manifest.previousRegistration,manifest.previousControl,manifest.projection]){
    const wrong=receipt.replace(term,'missing')
    assert.throws(()=>verifyAuthorization({...record,authorizationReceiptSha256:sha(wrong)},wrong,review,control,at))
  }
})

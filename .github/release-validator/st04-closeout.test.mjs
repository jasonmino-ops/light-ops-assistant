import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readIssuedStatus, requireFirstAttempt, signingContextEntries, verifyAuthorization, verifySources } from './st04-closeout.mjs'

const raw = readFileSync(new URL('./st04-closeout.json',import.meta.url))
const manifest = JSON.parse(raw)
const h = bytes => createHash('sha256').update(bytes).digest('hex')
// Synthetic clock and control: these objects never leave this process or reach a signer.
function fixture() {
  const control = 'a'.repeat(40)
  const approvedAt = '2026-11-24T03:00:00.000Z', expiresAt = '2026-11-24T04:00:00.000Z'
  const includedSourceCommits = manifest.orderedProjection.map(x=>x.source)
  const authorizationId = manifest.releaseId + '-PROTECTED-RELEASE'
  const disposition = manifest.trustedEvidence['docs/change-gates/evidence/ES-V3-NEW-STORE-PRINT-CLOSEOUT/candidate-scoped-disposition.request.json']
  const verbatimAnswer = '本人签认 ST04 同树候选 d1ffbaea，并批准其通过受保护校验后发布到 Production，零迁移'
  const common = { acceptedSuccessorAdmissionSha256:manifest.receiptRecovery.successorAdmissionSha256, postAdmissionCoreSha256:manifest.postAdmissionCore.evidenceSha256, control, releaseSha:manifest.candidate,releaseTree:manifest.tree,sourceMainSha:manifest.mainBase,
    baseProductionSha:manifest.base, productionDeployment:manifest.deployment, acceptedReleaseDispositionSha256:disposition, expiresAt }
  const record = { ...common, taskIds:[...manifest.taskIds], releaseId:manifest.releaseId, includedSourceCommits:[...includedSourceCommits],
    deploymentId:'PENDING', productionSha:'PENDING',storeCode:manifest.storeCode,migrationCount:0, authorizationQuote:verbatimAnswer,
    manifestSha256:h(raw), issuedAt:approvedAt, founderAuthorization:{approvedAt, approvedBy:'Founder', status:'APPROVED', authorizationId, includedSourceCommits:[...includedSourceCommits]} }
  const receipt = {...common,successorAdmissionPayload:JSON.stringify(manifest.receiptRecovery.successorAdmission,null,2)+'\n',requestReference:'SYNTHETIC-NONAUTHORITATIVE',verbatimAnswer,verbatimQuestion:['Production',manifest.candidate,manifest.tree,control,disposition,manifest.postAdmissionCore.evidenceSha256,manifest.receiptRecovery.failureEvidenceSha256,manifest.receiptRecovery.successorAdmissionSha256].join(' '),
    decision:'APPROVE_EXACT_SELECTIVE_PRODUCTION_RELEASE',approvedBy:'Founder',authorizationId,approvedAt,includedSourceCommits:[...includedSourceCommits]}
  const evidence = [control, manifest.candidate, manifest.tree, h(raw)].join(' ')
  const review = {verdict:'PASS',control,candidate:manifest.candidate,tree:manifest.tree,manifestSha256:h(raw),evidence,evidenceSha256:h(evidence)}
  return {record,receipt,review,control,now:Date.parse('2026-11-24T03:10:00.000Z')}
}

test('admitted sources, four release commits and guard blobs match the immutable Git objects',verifySources)
test('a complete synthetic future authorization is representable without secrets',()=>verifyAuthorization(fixture()))
for (const [description,mutate] of [
  ['pending release approval', x=>{x.record.founderAuthorization.status='PENDING'}],
  ['current main admission cannot authorize production', x=>{x.receipt.verbatimAnswer=x.record.authorizationQuote='批准精确处置、main 登记及校验器准备'}],
  ['previous release grant cannot authorize the new projection', x=>{x.receipt.verbatimAnswer=x.record.authorizationQuote='本人批准 ST04 精确候选通过受保护校验后发布到 Production，零迁移'}],
  ['predecessor evidence cannot replace the new frozen and failure disposition payload',x=>{x.receipt.successorAdmissionPayload='{}'}],
  ['frozen successor approval cannot authorize production', x=>{x.receipt.verbatimAnswer=x.record.authorizationQuote='本人正式签认上述精确冻结后继'}],
  ['denial is not an affirmative decision',x=>{x.receipt.verbatimAnswer=x.record.authorizationQuote='拒绝发布'}],
  ['wrong Production decision',x=>{x.receipt.decision='MAIN_ADMISSION_ONLY'}],
  ['wrong task',x=>{x.record.taskIds.shift()}],
  ['another store',x=>{x.record.storeCode='OTHER'}],
  ['late signing',x=>{x.now=Date.parse(x.record.expiresAt)}],
  ['grant issued in the future',x=>{x.now=Date.parse(x.record.issuedAt)-1}],
  ['window over two hours',x=>{x.record.expiresAt=x.receipt.expiresAt='2026-11-24T05:01:00.000Z'}],
  ['underlying disposition expired',x=>{x.record.founderAuthorization.approvedAt=x.record.issuedAt=x.receipt.approvedAt='2026-11-24T18:30:00.000Z';x.now=Date.parse(x.record.issuedAt);x.record.expiresAt=x.receipt.expiresAt='2026-11-24T20:00:00.000Z'}],
  ['incorrect release tree',x=>{x.receipt.releaseTree='b'.repeat(40)}],
  ['source omitted in grant',x=>{x.record.founderAuthorization.includedSourceCommits.pop()}],
  ['source order changed',x=>{x.record.includedSourceCommits.reverse()}],
  ['deployment ID changed',x=>{x.record.productionDeployment='dpl_other'}],
  ['different disposition',x=>{x.receipt.acceptedReleaseDispositionSha256='b'.repeat(64)}],
  ['missing post-admission CORE receipt',x=>{delete x.receipt.postAdmissionCoreSha256}],
  ['post-admission scope altered',x=>{x.record.postAdmissionCoreSha256='f'.repeat(64)}],
  ['migration requested',x=>{x.record.migrationCount=1}],
  ['unreviewed control',x=>{x.review.verdict='UNKNOWN'}],
  ['review evidence drift',x=>{x.review.evidence+='different'}],
  ['unbound production question',x=>{x.receipt.verbatimQuestion='Production'}],
]) test(description,()=>{const input=fixture();mutate(input);assert.throws(()=>verifyAuthorization(input))})

for (const phase of ['preflight','publish']) test('local '+phase+' stops without authority',()=>{
  const script=fileURLToPath(new URL('./st04-closeout.mjs',import.meta.url))
  const result=spawnSync(process.execPath,[script,phase],{env:{PATH:process.env.PATH},encoding:'utf8'})
  assert.equal(result.status,1)
  assert.match(result.stderr,/BLOCKED:/)
})

function statusFixture() {
  const issuedAt = '2026-11-24T03:00:00.000Z'
  const expiresAt = '2026-11-24T03:10:00.000Z'
  const digest = 'f'.repeat(64)
  const id = 12345
  const entry = { id, context:'eshop/selective-release-validator', state:'success',
    creator:{ id:351820557, login:'e-shop-release-validator[bot]' },
    description:'ST04 exact release '+digest, created_at:'2026-11-24T03:01:00Z' }
  let reads = 0
  const logged = []
  const delays = []
  const params = { id, digest, candidate:manifest.candidate, issuedAt, expiresAt,
    now:() => Date.parse('2026-11-24T03:02:00Z'),
    log:value => logged.push(JSON.parse(value)), wait:async ms => { delays.push(ms) },
    readStatuses:async () => { ++reads; return [entry] } }
  return { entry, params, logged, delays, reads:() => reads }
}

test('automatic or manual workflow retries cannot enter either signing phase', () => {
  requireFirstAttempt('1')
  for (const value of [undefined, '0', '2', '01', '']) assert.throws(() => requireFirstAttempt(value))
})
test('a full first page cannot establish uniqueness before or after a POST', () => {
  assert.throws(() => signingContextEntries(Array(100).fill({context:'elsewhere'})))
  assert.deepEqual(signingContextEntries([]),[])
})

test('original POST ID is logged before the first read and verified after an empty response', async () => {
  const x=statusFixture()
  let n=0
  x.params.readStatuses=async () => {
    assert.deepEqual(x.logged,[{event:'status-post-receipt',candidate:manifest.candidate,recordSha256:x.params.digest,statusId:x.params.id}])
    return ++n===1 ? [] : [x.entry]
  }
  await readIssuedStatus(x.params)
  assert.equal(n,2)
  assert.deepEqual(x.delays,[500])
})

test('absence is bounded and stays a failure', async () => {
  const x=statusFixture()
  let reads=0
  x.params.readStatuses=async () => { ++reads; return [] }
  await assert.rejects(readIssuedStatus(x.params),/still absent/)
  assert.equal(reads,4)
  assert.equal(x.logged.length,1)
  assert.deepEqual(x.delays,[500,1500,3000])
})

for (const [name,patch] of [
  ['different ID',{id:12346}], ['non-success',{state:'failure'}],
  ['wrong creator ID',{creator:{id:1,login:'e-shop-release-validator[bot]'}}],
  ['wrong creator login',{creator:{id:351820557,login:'another-bot'}}],
  ['different digest',{description:'another record'}],
  ['early issuance',{created_at:'2026-11-24T02:59:59Z'}],
  ['late issuance',{created_at:'2026-11-24T03:10:00Z'}],
]) test(name+' fails on the first read',async () => {
  const x=statusFixture()
  Object.assign(x.entry,patch)
  await assert.rejects(readIssuedStatus(x.params))
  assert.equal(x.reads(),1)
  assert.deepEqual(x.delays,[])
})
test('duplicate issuance or GET error never retries',async () => {
  for (const readStatuses of [async x=>[x.entry,x.entry],async()=>{throw new Error('network error')}]) {
    const x=statusFixture()
    x.params.readStatuses=() => readStatuses(x)
    await assert.rejects(readIssuedStatus(x.params))
    assert.deepEqual(x.delays,[])
  }
})
test('invalid POST ID never produces a receipt',async () => {
  const x=statusFixture()
  x.params.id=null
  await assert.rejects(readIssuedStatus(x.params),/original POST response/)
  assert.equal(x.reads(),0)
  assert.deepEqual(x.logged,[])
})
test('grant expiry during readback fails closed',async () => {
  const x=statusFixture()
  let clock=0
  x.params.now=() => ++clock===1 ? Date.parse(x.params.issuedAt)+1000 : Date.parse(x.params.expiresAt)
  await assert.rejects(readIssuedStatus(x.params),/authorization window/)
})

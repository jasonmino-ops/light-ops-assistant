import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyAuthorization, verifySources } from './st04-closeout.mjs'

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
  const verbatimAnswer = '本人批准 ST04 精确候选通过受保护校验后发布到 Production，零迁移'
  const common = { postAdmissionCoreSha256:manifest.postAdmissionCore.evidenceSha256, control, releaseSha:manifest.candidate,releaseTree:manifest.tree,sourceMainSha:manifest.mainBase,
    baseProductionSha:manifest.base, productionDeployment:manifest.deployment, acceptedReleaseDispositionSha256:disposition, expiresAt }
  const record = { ...common, taskIds:[...manifest.taskIds], releaseId:manifest.releaseId, includedSourceCommits:[...includedSourceCommits],
    deploymentId:'PENDING', productionSha:'PENDING',storeCode:manifest.storeCode,migrationCount:0, authorizationQuote:verbatimAnswer,
    manifestSha256:h(raw), issuedAt:approvedAt, founderAuthorization:{approvedAt, approvedBy:'Founder', status:'APPROVED', authorizationId, includedSourceCommits:[...includedSourceCommits]} }
  const receipt = {...common,requestReference:'SYNTHETIC-NONAUTHORITATIVE',verbatimAnswer,verbatimQuestion:['Production',manifest.candidate,control,disposition,manifest.postAdmissionCore.evidenceSha256].join(' '),
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

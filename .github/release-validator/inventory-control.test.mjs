import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {manifest,controlPaths,canonicalOrigin,candidateShape,verifyAuthorization,verifySource,contextEntries,readIssuedStatus} from './inventory-control.mjs'
const sha=x=>createHash('sha256').update(x).digest('hex')
const control='a'.repeat(40),digest='b'.repeat(64)
const receipt=[manifest.candidate,manifest.tree,'批准现有受保护签发器针对本候选的最小适配',
  '不擅自修改 Pilot 绑定及 Feed 状态','擅自开启 Diamond 自动扣减'].join('\n')
function fixture() {
  const review={verdict:'PASS',control,candidate:manifest.candidate,tree:manifest.tree,
    manifestSha256:sha(readFileSync(new URL('./inventory-control.json',import.meta.url))),readOnly:true,freshContext:true,
    notFounderOrAppSigner:true,evidence:'Independent technical review evidence for exact immutable product and controller. '.repeat(3)}
  review.evidenceSha256=sha(review.evidence)
  const record={releaseId:manifest.releaseId,taskId:manifest.taskId,status:'FOUNDER_APPROVED_EXACT_PRODUCTION_SUCCESSOR',approvedBy:'Founder',
    releaseSha:manifest.candidate,releaseTree:manifest.tree,baseProductionSha:manifest.base,productionDeployment:manifest.productionDeployment,
    sourceMainSha:manifest.mainBase,control,manifestSha256:review.manifestSha256,migrationPath:manifest.migration,migrationSha256:manifest.migrationSha256,
    migrationCount:1,migrationFrom:80,migrationTo:81,storeCode:manifest.storeCode,diamondSalesMustRemainOff:true,pilotAndFeedMutationAuthorized:false,
    h5RefundRestock:false,defaultSelectiveValidatorChanged:false,signatureLifetimeSeconds:7200,releaseExecutionRequiresUnexpiredAppStatus:true,
    issuedAt:'2026-11-26T00:00:00.000Z',expiresAt:manifest.coreDispositionExpiresAt,
    authorizationReceiptSha256:sha(receipt),reviewReceiptSha256:sha(JSON.stringify(review,null,2)+'\n'),
    controllerSha256:Object.fromEntries(controlPaths.map(p=>[p,'c'.repeat(64)])),
    engineeringGuardSha256:manifest.trustedEngineering['scripts/governance/verify-inventory-control-admission.cjs']}
  return {record,review}
}
const at=Date.parse('2026-11-26T01:00:00.000Z')
test('actual immutable 11-path Production overlay, one migration and source hashes verify',()=>verifySource())
test('only canonical repository forms are allowed',()=>{
  assert(canonicalOrigin('https://github.com/jasonmino-ops/light-ops-assistant.git'))
  assert(canonicalOrigin('https://github.com/jasonmino-ops/light-ops-assistant'))
  for(const p of ['https://evil.example/jasonmino-ops/light-ops-assistant.git','https://github.com/other/light-ops-assistant.git',
    'https://github.com/jasonmino-ops/light-ops-assistant.git/','https://github.com@evil.example/jasonmino-ops/light-ops-assistant']) assert(!canonicalOrigin(p))
})
test('wrong candidate/tree, extra path and wrong/multiple parents reject',()=>{
  const f={candidate:manifest.candidate,tree:manifest.tree,parents:[manifest.base],changedPaths:manifest.paths.map(p=>p.path)}
  candidateShape(f)
  for(const bad of [{candidate:'0'.repeat(40)},{tree:'0'.repeat(40)},{parents:[manifest.base,control]},{parents:[control]},
    {changedPaths:[...f.changedPaths,'unapproved.ts']}]) assert.throws(()=>candidateShape({...f,...bad}))
})
test('exact Production receipt, independent review and OFF-only boundary verify',()=>{
  const {record,review}=fixture();verifyAuthorization(record,receipt,review,control,at)
})
test('expired/future, different migration, other store, flag/Feed or H5 expansion reject',()=>{
  const {record,review}=fixture()
  for(const bad of [{issuedAt:'2027-01-01T00:00:00.000Z'},{expiresAt:'2026-11-25T00:00:00.000Z'},
    {releaseSha:control},{migrationCount:2},{migrationSha256:digest},{storeCode:'OTHER'},{diamondSalesMustRemainOff:false},
    {pilotAndFeedMutationAuthorized:true},{h5RefundRestock:true},{defaultSelectiveValidatorChanged:true},{signatureLifetimeSeconds:86400},
    {releaseExecutionRequiresUnexpiredAppStatus:false}])
    assert.throws(()=>verifyAuthorization({...record,...bad},receipt,review,control,at))
})
test('missing authority, changed executor, absent review and widened controller paths reject',()=>{
  const {record,review}=fixture()
  for(const bad of [{authorizationReceiptSha256:digest},{reviewReceiptSha256:digest},
    {engineeringGuardSha256:digest},{controllerSha256:{...record.controllerSha256,'extra.mjs':digest}}])
    assert.throws(()=>verifyAuthorization({...record,...bad},receipt,review,control,at))
  assert.throws(()=>verifyAuthorization({...record,authorizationReceiptSha256:sha('invented')},'invented',review,control,at))
  assert.throws(()=>verifyAuthorization(record,receipt,{...review,freshContext:false},control,at))
})
test('unknown status pages and duplicate context are never hidden',()=>{
  assert.throws(()=>contextEntries(Array(100).fill({})))
  assert.deepEqual(contextEntries([{context:'other'}]),[])
})
const issuedAt='2026-11-26T01:00:00.000Z',expiresAt='2026-11-26T03:00:00.000Z',target='https://github.com/example/run'
const entry={id:123,state:'success',context:'eshop/selective-release-validator',description:'Inventory control '+digest,
  creator:{id:351820557,login:'e-shop-release-validator[bot]'},target_url:target,created_at:issuedAt}
const args={id:123,candidate:manifest.candidate,digest,issuedAt,expiresAt,target,now:()=>at,wait:async()=>{},log:()=>{}}
test('original status ID survives initial absent readback without any new POST',async()=>{
  let reads=0
  await readIssuedStatus({...args,readStatuses:async()=>++reads===1?[]:[entry]})
  assert.equal(reads,2)
})
test('wrong issuer, old status ID, failed status, digest, target, duplicates and expired grants reject',async()=>{
  for(const bad of [{id:124},{state:'failure'},{creator:{id:1,login:'human'}},{description:'Inventory control '+control},
    {target_url:'https://evil.example'},{created_at:'2026-11-25T23:00:00.000Z'}])
    await assert.rejects(readIssuedStatus({...args,readStatuses:async()=>[{...entry,...bad}]}))
  await assert.rejects(readIssuedStatus({...args,readStatuses:async()=>[entry,entry]}))
  await assert.rejects(readIssuedStatus({...args,now:()=>Date.parse(expiresAt),readStatuses:async()=>[entry]}))
})
test('absent original POST status stays uncertain and cannot be fabricated',async()=>{
  let reads=0
  await assert.rejects(readIssuedStatus({...args,readStatuses:async()=>{reads++;return []}}),/do not republish/)
  assert.equal(reads,4)
})
test('a GET that crosses expiry must reject even if it returns the original successful status',async()=>{
  let current=at
  await assert.rejects(readIssuedStatus({...args,now:()=>current,readStatuses:async()=>{
    current=Date.parse(expiresAt);return [entry]
  }}),/expired during readback/)
})

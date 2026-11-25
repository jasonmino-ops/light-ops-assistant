// One exact successor inside the existing protected App workflow. Not a generic signer.
import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, appendFileSync, mkdtempSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repo = 'jasonmino-ops/light-ops-assistant', origin = 'https://github.com/' + repo + '.git'
const controlRef = 'refs/heads/codex/release-validator-control'
const appId = 5590705, installationId = 178077967, creatorId = 351820557
const context = 'eshop/selective-release-validator'
const prefix = 'Inventory control '
const manifestPath = '.github/release-validator/inventory-control.json'
const manifestSha = '46f9c41a8da9014d416d89981d3667facd08ac564cbf39a0a6e0c7993d5fa03b'
const rawManifest = readFileSync(new URL('./inventory-control.json', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(rawManifest), manifestSha)
export const manifest = JSON.parse(rawManifest)
export const controlPaths = [manifestPath, '.github/release-validator/inventory-control.mjs',
  '.github/release-validator/inventory-control.test.mjs', '.github/workflows/selective-release-validator.yml'].sort()
const admissionPath = 'docs/releases/ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01.json'
const receiptPath = 'docs/releases/evidence/ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01/founder-release.md'
const reviewPath = 'docs/releases/evidence/ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01/controller-review.json'
export const registrationPaths = [admissionPath, receiptPath, reviewPath].sort()
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C',
  GIT_NO_REPLACE_OBJECTS: '1', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }
const bytes = (...args) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
  { env: cleanEnv, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
const git = (...args) => bytes(...args).toString().trim()
const paths = (a,b) => bytes('diff','--no-renames','--name-only','-z',a,b).toString().split('\0').filter(Boolean).sort()
const blob = (commit, path) => {
  assert(git('ls-tree',commit,'--',path).startsWith('100644 blob '), 'Regular file required: '+path)
  return bytes('show',commit+':'+path)
}
export function canonicalOrigin(value) { return [origin, origin.slice(0,-4)].includes(value) }
export function candidateShape({ candidate, tree, parents, changedPaths }) {
  assert.equal(candidate, manifest.candidate)
  assert.equal(tree, manifest.tree)
  assert.deepEqual(parents,[manifest.base])
  assert.deepEqual([...changedPaths].sort(),manifest.paths.map(p=>p.path).sort())
}
export function verifyAuthorization(record, receipt, review, control, now = Date.now()) {
  assert.equal(record.releaseId, manifest.releaseId)
  assert.equal(record.taskId, manifest.taskId)
  assert.equal(record.status,'FOUNDER_APPROVED_EXACT_PRODUCTION_SUCCESSOR')
  assert.equal(record.approvedBy,'Founder')
  assert.equal(record.releaseSha,manifest.candidate)
  assert.equal(record.releaseTree,manifest.tree)
  assert.equal(record.baseProductionSha,manifest.base)
  assert.equal(record.productionDeployment,manifest.productionDeployment)
  assert.equal(record.sourceMainSha,manifest.mainBase)
  assert.equal(record.control,control)
  assert.equal(record.manifestSha256,manifestSha)
  assert.equal(record.migrationPath,manifest.migration)
  assert.equal(record.migrationSha256,manifest.migrationSha256)
  assert.equal(record.migrationCount,1)
  assert.equal(record.migrationFrom,80); assert.equal(record.migrationTo,81)
  assert.equal(record.storeCode,manifest.storeCode)
  assert.equal(record.diamondSalesMustRemainOff,true)
  assert.equal(record.pilotAndFeedMutationAuthorized,false)
  assert.equal(record.h5RefundRestock,false)
  assert.equal(record.defaultSelectiveValidatorChanged,false)
  assert.equal(record.signatureLifetimeSeconds,manifest.signatureLifetimeSeconds)
  assert.equal(record.releaseExecutionRequiresUnexpiredAppStatus,true)
  assert.equal(record.expiresAt,manifest.coreDispositionExpiresAt)
  const issued = Date.parse(record.issuedAt), expires = Date.parse(record.expiresAt)
  assert(Number.isFinite(issued) && issued <= now && now < expires,'Admission not issued or expired')
  assert.equal(record.authorizationReceiptSha256,sha(Buffer.from(receipt)))
  for (const term of [manifest.candidate,manifest.tree,'批准现有受保护签发器针对本候选的最小适配',
    '不擅自修改 Pilot 绑定及 Feed 状态','擅自开启 Diamond 自动扣减']) assert(receipt.includes(term),'Missing actual Founder authority: '+term)
  assert.equal(review.verdict,'PASS')
  assert.equal(review.control,control)
  assert.equal(review.candidate,manifest.candidate)
  assert.equal(review.tree,manifest.tree)
  assert.equal(review.manifestSha256,manifestSha)
  assert.equal(review.readOnly,true); assert.equal(review.freshContext,true)
  assert.equal(review.notFounderOrAppSigner,true)
  assert.equal(typeof review.evidence,'string')
  assert(review.evidence.length>100)
  assert.equal(sha(Buffer.from(review.evidence)),review.evidenceSha256)
  assert.equal(record.reviewReceiptSha256,sha(Buffer.from(JSON.stringify(review,null,2)+'\n')))
  assert.deepEqual(Object.keys(record.controllerSha256).sort(),controlPaths)
  assert.equal(record.engineeringGuardSha256,manifest.trustedEngineering['scripts/governance/verify-inventory-control-admission.cjs'])
}
export function verifySource() {
  candidateShape({ candidate:manifest.candidate,tree:git('rev-parse',manifest.candidate+'^{tree}'),
    parents:git('show','-s','--format=%P',manifest.candidate).split(' '),changedPaths:paths(manifest.base,manifest.candidate) })
  assert.equal(sha(bytes('diff','--binary',manifest.base+'^{tree}',manifest.tree)),manifest.patchSha256)
  for (const p of manifest.paths) {
    assert.equal(sha(blob(manifest.candidate,p.path)),p.sha256)
    if(p.beforeSha256===null) assert.equal(git('ls-tree',manifest.base,'--',p.path),'')
    else assert.equal(sha(blob(manifest.base,p.path)),p.beforeSha256)
  }
  assert.deepEqual(manifest.paths.filter(p=>p.path.startsWith('prisma/')).map(p=>p.path),[manifest.migration])
  assert.equal(sha(blob(manifest.candidate,manifest.migration)),manifest.migrationSha256)
}
function readRefs() {
  const refs=['refs/heads/main','refs/heads/release',manifest.productRef,controlRef]
  const live=new Map(git('ls-remote','--heads',origin,...refs).split('\n').map(line=>line.split('\t').reverse()))
  for(const ref of refs) {
    assert.match(live.get(ref)||'',/^[0-9a-f]{40}$/)
    assert.equal(git('rev-parse','refs/remotes/origin/'+ref.slice(11)),live.get(ref),'Stale checkout ref')
  }
  return live
}
function validated(expectedDigest) {
  assert.equal(process.env.GITHUB_ACTIONS,'true')
  assert.equal(process.env.GITHUB_EVENT_NAME,'push')
  assert.equal(process.env.GITHUB_RUN_ATTEMPT,'1','Never replay an uncertain signing POST')
  assert.equal(process.env.GITHUB_REPOSITORY,repo)
  assert.equal(process.env.GITHUB_REF,controlRef)
  const control=process.env.GITHUB_SHA
  assert.equal(git('rev-parse','HEAD'),control)
  assert.equal(git('remote','get-url','origin'),origin)
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'')
  assert.equal(git('show','-s','--format=%P',control),manifest.previousControl)
  assert.deepEqual(paths(manifest.previousControl,control),controlPaths)
  const refs=readRefs(),main=refs.get('refs/heads/main')
  assert.equal(refs.get(controlRef),control)
  assert.equal(refs.get('refs/heads/release'),manifest.base)
  assert.equal(refs.get(manifest.productRef),manifest.candidate)
  git('merge-base','--is-ancestor',manifest.mainBase,main)
  // One real governance-only addition admits the exact controller. Unrelated later main
  // commits may exist, but cannot replace the original receipt or any trusted safety byte.
  const registrations=git('log','--diff-filter=A','--format=%H',main,'--',admissionPath).split('\n').filter(Boolean)
  assert.equal(registrations.length,1)
  const registration=registrations[0]
  assert.equal(git('show','-s','--format=%P',registration),manifest.mainBase)
  assert.deepEqual(paths(manifest.mainBase,registration),registrationPaths)
  for(const p of registrationPaths) assert.equal(sha(blob(registration,p)),sha(blob(main,p)))
  for(const [p,digest] of Object.entries(manifest.trustedEngineering)) assert.equal(sha(blob(main,p)),digest,'Trusted engineering input changed: '+p)
  verifySource()
  const raw=blob(main,admissionPath),digest=sha(raw),record=JSON.parse(raw)
  if(expectedDigest!==undefined) assert.equal(digest,expectedDigest)
  const reviewBytes=blob(main,reviewPath)
  assert.equal(sha(reviewBytes),record.reviewReceiptSha256)
  for(const p of controlPaths) assert.equal(sha(blob(control,p)),record.controllerSha256[p])
  verifyAuthorization(record,blob(main,receiptPath).toString(),JSON.parse(reviewBytes),control)
  const ci=JSON.parse(execFileSync('gh',['api','repos/'+repo+'/actions/runs/'+manifest.cloudRun],{encoding:'utf8',timeout:20000}))
  assert.equal(ci.head_sha,manifest.candidate)
  assert.equal(ci.status,'completed'); assert.equal(ci.conclusion,'success')
  assert.equal(ci.path,'.github/workflows/cloud-ci.yml')
  return { main,digest,record,candidate:manifest.candidate }
}
function preflight() {
  const {main,digest}=validated()
  const dir=mkdtempSync(resolve(tmpdir(),'inventory-control-')),trusted=resolve(dir,'main'),candidate=resolve(dir,'candidate')
  try {
    git('worktree','add','--detach',trusted,main)
    git('worktree','add','-b',manifest.productBranch,candidate,manifest.candidate)
    // Real unmodified Scope Guard + existing exact Frozen/lineage successor, with
    // only the read-only CI GitHub token. App PEM is not available in this phase.
    const output=execFileSync(process.execPath,[resolve(trusted,'scripts/governance/verify-inventory-control-admission.cjs'),
      '--root',candidate,'--candidate',manifest.candidate],{cwd:candidate,env:{...cleanEnv,GH_TOKEN:process.env.GH_TOKEN},
      timeout:60000,encoding:'utf8'})
    assert(output.includes('TASK FROZEN SUCCESSOR: PASS') && output.includes('TASK COMMIT LINEAGE: PASS'))
    console.log(output.trim())
    console.log('EXACT PRODUCTION OVERLAY SUCCESSOR: PASS (default selective validator unchanged)')
    appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\ndigest='+digest+'\n')
  } finally {
    if(existsSync(candidate)) git('worktree','remove','--force',candidate)
    if(existsSync(trusted)) git('worktree','remove','--force',trusted)
    rmSync(dir,{recursive:true,force:true})
  }
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
    assert.deepEqual(info.parents?.map(p=>p.sha),[manifest.base])
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
    assert.equal(contextEntries(await request(statusPath,token)).length,0,'Existing status requires reconciliation; never duplicate POST')
    const checked=validated(digest); assert.equal(checked.main,main); assert.equal(checked.candidate,candidate)
    const issuedAt=new Date(Math.floor(Date.now()/1000)*1000).toISOString()
    const expiresAt=new Date(Math.min(Date.parse(issuedAt)+record.signatureLifetimeSeconds*1000,Date.parse(record.expiresAt))).toISOString()
    const target='https://github.com/'+repo+'/actions/runs/'+process.env.GITHUB_RUN_ID+'#record='+digest+'&expires='+encodeURIComponent(expiresAt)
    const sent=await request(root+'/statuses/'+candidate,token,'POST',{state:'success',context,description:prefix+digest,target_url:target})
    await readIssuedStatus({id:sent.id,candidate,digest,issuedAt,expiresAt,target,readStatuses:()=>request(statusPath+'&page=1',token)})
    console.log(JSON.stringify({candidate,appId,status:'success',recordSha256:digest,statusId:sent.id,issuedAt,expiresAt}))
  } finally { await request('/installation/token',token,'DELETE') }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length===3&&['preflight','publish'].includes(process.argv[2]))
    if(process.argv[2]==='preflight') preflight(); else await publish()
  } catch(error) { console.error('BLOCKED:',error instanceof Error&&!error.cmd?error.message:'Trusted command failed');process.exitCode=1 }
}

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
const prefix = 'Print takeover '
const manifestPath = '.github/release-validator/print-device-takeover.json'
const manifestSha = '22a0b48b2e45972240eba96a47218a655c450c959b87e0bc36ba9715b46f6876'
const rawManifest = readFileSync(new URL('./print-device-takeover.json', import.meta.url))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
assert.equal(sha(rawManifest), manifestSha)
export const manifest = JSON.parse(rawManifest)
export const controlPaths = [manifestPath, '.github/release-validator/print-device-takeover.mjs',
  '.github/release-validator/print-device-takeover.test.mjs', '.github/workflows/selective-release-validator.yml'].sort()
const admissionPath = 'docs/releases/ES-PRINT-DEVICE-TAKEOVER.json'
const receiptPath = 'docs/releases/evidence/ES-PRINT-DEVICE-TAKEOVER/founder-release.md'
const reviewPath = 'docs/releases/evidence/ES-PRINT-DEVICE-TAKEOVER/controller-review.json'
const evidencePath = 'docs/releases/evidence/ES-PRINT-DEVICE-TAKEOVER/validation-evidence.json'
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
  assert.equal(typeof auth.authorizationId,'string'); assert(auth.authorizationId.length>0)
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
  for(const term of [record.frozenPayloadSha256,record.dispositionSha256,auth.authorizationId,manifest.candidate,manifest.tree,manifest.base,manifestSha,
    record.controllerDigest,...manifest.includedSourceCommits,
    '批准精确换机签发器接入、一次App签发及受保护release快进部署',manifest.deadlineExclusive])
    assert(receipt.includes(term),'Missing exact final Founder authority: '+term)
  for(const flag of ['issuerInstallationAuthorized','statusPublicationAuthorized','releaseExecutionAuthorized',
    'releaseExecutionRequiresUnexpiredAppStatus']) assert.equal(record[flag],true)
  for(const flag of ['migrationAuthorized','terminalMutationAuthorized','pilotOrFeedMutationAuthorized',
    'defaultSelectiveValidatorChanged']) assert.equal(record[flag],false)
  assert.equal(record.migrationCount,0)
  assert.equal(record.signatureLifetimeSeconds,manifest.signatureLifetimeSeconds)
  assert.equal(record.acceptance,'ACCEPTED_WITH_EXACT_PRINT_COMPAT_CORE_AND_INTEGRATION_DISPOSITION')
  assert.deepEqual(record.rawCORE,{status:'BLOCKED',expected:104,executed:104,pass:100,fail:4,skip:0})
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
export function verifyEvidence(raw) {
  assert.equal(sha(raw),manifest.evidenceBundleSha256)
  const evidence=JSON.parse(raw)
  assert.equal(evidence.status,'EXISTING_IMMUTABLE_EVIDENCE_NOT_NEW_TEST_EXECUTION')
  assert.equal(evidence.candidate,manifest.candidate);assert.equal(evidence.tree,manifest.tree)
  assert.equal(evidence.rawIntegrationStatus,'BLOCKED');assert.equal(evidence.base,manifest.base);assert.equal(evidence.rawCoreStatus,'BLOCKED')
  assert.deepEqual(Object.keys(evidence.files).sort(),Object.keys(manifest.evidenceHashes).sort())
  for(const [name,digest] of Object.entries(manifest.evidenceHashes)) {
    assert.equal(evidence.files[name].sha256,digest)
    assert.equal(sha(Buffer.from(evidence.files[name].base64,'base64')),digest)
  }
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
  const refs=['refs/heads/main','refs/heads/release',manifest.productRef,controlRef]
  const live=new Map(git('ls-remote','--heads',origin,...refs).split('\n').map(line=>line.split('\t').reverse()))
  for(const ref of refs) {
    assert.match(live.get(ref)||'',/^[0-9a-f]{40}$/)
    assert.equal(git('rev-parse','refs/remotes/origin/'+ref.slice(11)),live.get(ref),'Stale checkout ref')
  }
  return live
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
  git('merge-base','--is-ancestor',manifest.mainBase,main)
  // Only our own four-file governance registration may advance the live main binding.
  assert.deepEqual(paths(manifest.mainBase,main),registrationPaths)
  const additions=git('log','--diff-filter=A','--format=%H',main,'--',admissionPath).split('\n').filter(Boolean)
  assert.equal(additions.length,1)
  const registration=additions[0]
  assert.equal(git('show','-s','--format=%P',registration),manifest.mainBase)
  assert.deepEqual(paths(manifest.mainBase,registration),registrationPaths)
  assert.equal(git('rev-parse',main+'^{tree}'),git('rev-parse',registration+'^{tree}'))
  for(const p of registrationPaths) assert.equal(sha(blob(registration,p)),sha(blob(main,p)))
  for(const [p,digest] of Object.entries(manifest.trustedEngineering)) {assert.equal(sha(blob(main,p)),digest,'Trusted engineering input changed: '+p);assert.equal(git('ls-tree',main,'--',p).split(' ')[0],manifest.trustedModes[p])}
  verifySource();verifyEvidence(blob(main,evidencePath))
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
  console.log('PRINT EXACT CANDIDATE + QUALIFIED ACCEPTANCE: PASS; RAW CORE AND INTEGRATION REMAIN BLOCKED')
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

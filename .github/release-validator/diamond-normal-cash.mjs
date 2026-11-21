// Exact single-task binding. No deployment, permit activation, financial call, or printing capability.
// The existing protected App publisher below is retained; local/PENDING invocations fail before secrets.
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
const repo='jasonmino-ops/light-ops-assistant'
const url='https://github.com/'+repo+'.git'
const appId=5590705, installationId=178077967, creatorId=351820557
const context='eshop/selective-release-validator'
const controlRef='refs/heads/codex/release-validator-control'
const productRef='refs/heads/codex/es-diamond-normal-cash-release'
const previousControl='58fba893445a6042f30a51beeb8a5db7f142057f'
const base='b0aa38a1d1bf4d1aa0f375f1c42da6e4436dc481', mainBase='1ae54880cc2b78f3d6ccdd09952241455e2ab927', tree='636e1d0b37bd9bb8adcc5df9a94b5ced926acd3c'
const task='ES-DIAMOND-NORMAL-CASH-QUERY-FIX-01'
const manifestPath='.github/release-validator/diamond-normal-cash.paths.json', manifestSha='4b0cd607dd4375c04d0e7337c4a49145848d9ace219f7e266af12448f70dc2a7'
const scopePath='docs/change-gates/exceptions/'+task+'.json'
const admissionPath='docs/releases/'+task+'.json'
const controlPaths=[manifestPath,'.github/release-validator/diamond-normal-cash.mjs','.github/workflows/selective-release-validator.yml'].sort()
const assert=(value,reason)=>{if(!value)throw Error(reason)}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const cleanEnv={PATH:process.env.PATH,HOME:process.env.HOME,LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}
const bytes=(...args)=>execFileSync('git',['--no-replace-objects','-c','core.fsmonitor=false',...args],{env:cleanEnv,timeout:15000,stdio:['ignore','pipe','pipe']})
const git=(...args)=>bytes(...args).toString().trim()
const names=(a,b)=>bytes('diff','--name-only','-z','--no-renames',a,b).toString().split('\0').filter(Boolean).sort()
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const ancestor=(a,b)=>{execFileSync('git',['merge-base','--is-ancestor',a,b],{env:cleanEnv,timeout:15000,stdio:['ignore','pipe','pipe']})}
function verifyCandidate(candidate,manifest){
 assert(/^[0-9a-f]{40}$/.test(candidate),'Invalid candidate SHA')
 assert(git('show','-s','--format=%P',candidate)===base&&git('rev-parse',candidate+'^{tree}')===tree,'Exact runtime parent/tree drift')
 const paths=Object.keys(manifest.paths).sort()
 assert(equal(paths,['app/api/cashier/sales/route.ts','tests/cashier-large-cart-query.test.cjs'])&&equal(paths,names(base,candidate)),'Only the normal query fix and its focused test may ship')
 for(const path of paths){
  const check=manifest.paths[path],previous=git('ls-tree',base,'--',path)
  if(check.before===null)assert(!previous,'Unexpected original path')
  else assert(previous.startsWith('100644 blob ')&&sha(bytes('show',base+':'+path))===check.before,'Original source drift')
  assert(git('ls-tree',candidate,'--',path).startsWith('100644 blob ')&&sha(bytes('show',candidate+':'+path))===check.after,'Approved bytes/mode drift')
 }
 return paths
}
function validated(expectedDigest){
 const control=process.env.GITHUB_SHA
 assert(process.env.GITHUB_REPOSITORY===repo&&process.env.GITHUB_REF===controlRef&&git('rev-parse','HEAD')===control&&!git('status','--porcelain=v1','--untracked-files=all'),'Exact clean protected workflow required')
 const refs=new Map(git('ls-remote','--heads',url,'refs/heads/main','refs/heads/release',productRef,controlRef).split('\n').map(line=>line.split('\t').reverse()))
 const main=refs.get('refs/heads/main'),candidate=refs.get(productRef)
 assert(refs.get('refs/heads/release')===base&&refs.get(controlRef)===control&&main&&candidate&&git('rev-parse','origin/main')===main&&git('rev-parse','origin/'+productRef.slice('refs/heads/'.length))===candidate,'Live/fetched refs drift')
 assert(git('show','-s','--format=%P',control)===previousControl&&equal(names(previousControl,control),controlPaths),'Unexpected control lineage/paths')
 ancestor(mainBase,main)
 const mb=bytes('show',control+':'+manifestPath);assert(sha(mb)===manifestSha,'Sealed manifest drift')
 const manifest=JSON.parse(mb);assert(manifest.taskId===task&&manifest.base===base&&manifest.mainBase===mainBase&&manifest.tree===tree,'Manifest identity drift')
 const recordBytes=bytes('show',main+':'+admissionPath),digest=sha(recordBytes),record=JSON.parse(recordBytes)
 assert(expectedDigest===undefined||digest===expectedDigest,'Admission changed since preflight')
 const auth=record.founderAuthorization,now=Date.now(),issued=Date.parse(record.issuedAt),expires=Date.parse(record.expiresAt)
 assert(record.releaseId===task&&equal(record.taskIds,[task])&&auth?.approvedBy==='Founder'&&auth.status==='APPROVED'&&typeof auth.authorizationId==='string'&&auth.authorizationId.length>0&&typeof auth.approvedAt==='string'&&Number.isFinite(Date.parse(auth.approvedAt)),'Real Founder authorization required')
 assert(record.baseProductionSha===base&&record.releaseSha===candidate&&record.productionSha==='PENDING'&&record.deploymentId==='PENDING'&&record.control===control&&record.manifestSha256===manifestSha&&record.productionDeployment===manifest.productionDeployment,'Exact pending release binding required')
 assert(issued<=now&&now<expires&&expires-issued<=7200000&&record.storeCode==='ST883DC00C'&&record.newPhysicalCashCents===0&&record.shiftStart===manifest.shiftStart,'Invalid execution bounds/cash truth')
 const paths=verifyCandidate(candidate,manifest)
 assert(Array.isArray(record.includedSourceCommits)&&record.includedSourceCommits.length===1&&equal(auth.includedSourceCommits,record.includedSourceCommits),'Exact single projected source required')
 const source=record.includedSourceCommits[0];verifyCandidate(source,manifest)
 assert(/^[0-9a-f]{40}$/.test(record.sourceImplementationSha??''),'Original main implementation identity missing');ancestor(record.sourceImplementationSha,record.sourceMainSha)
 assert(git('rev-parse',record.sourceImplementationSha+'^{tree}')==='109d94c6771d0ed0791ed4d9b3e27b363259c45d','Reviewed main implementation tree changed')
 ancestor(source,record.sourceMainSha);ancestor(record.sourceMainSha,main)
 const trailers=git('show','-s','--format=%B',candidate).split('\n').filter(line=>/^\(cherry picked from commit [0-9a-f]{40}\)$/.test(line))
 assert(equal(trailers,['(cherry picked from commit '+source+')']),'Exactly one genuine source mapping required')
 const allowedMain=[...paths,scopePath,admissionPath,manifest.receiptPath,'scripts/lib/release-provenance.mjs'].sort()
 assert(names(mainBase,main).every(path=>allowedMain.includes(path)),'Unrelated main admission')
 assert(sha(bytes('show',main+':scripts/lib/release-provenance.mjs'))===manifest.trustedReleaseValidatorSha256,'Reviewed deployment-ID metadata correction missing or changed')
 assert(sha(bytes('show',main+':app/api/cashier/sales/route.ts'))===manifest.mainRouteSha256&&sha(bytes('show',main+':tests/cashier-large-cart-query.test.cjs'))===manifest.paths['tests/cashier-large-cart-query.test.cjs'].after,'Main variant changed')
 const scopeBytes=bytes('show',main+':'+scopePath),scope=JSON.parse(scopeBytes)
 assert(scope.taskId===task&&scope.status==='ACTIVE'&&scope.approvedBy==='Founder'&&scope.featureBranch===productRef.slice('refs/heads/'.length)&&equal(scope.authorizedPaths,['app/api/cashier/sales/route.ts'])&&scope.authorizedPathSha256?.['app/api/cashier/sales/route.ts']===manifest.paths['app/api/cashier/sales/route.ts'].after,'Exact active runtime Scope required')
 assert(scope.additionalAuthorizations?.length===2,'Exactly two reviewed source-admission contexts required')
 for(const grant of scope.additionalAuthorizations){
  const expected=grant.featureBranch==='codex/es-diamond-normal-cash-query-fix'?manifest.mainRouteSha256:grant.featureBranch==='codex/es-diamond-normal-cash-runtime-candidate'?manifest.paths['app/api/cashier/sales/route.ts'].after:null
  assert(expected&&grant.status==='CLOSED'&&grant.approvedBy==='Founder'&&equal(grant.authorizedPaths,['app/api/cashier/sales/route.ts'])&&grant.authorizedPathSha256?.['app/api/cashier/sales/route.ts']===expected,'Source Scope closure/bytes drift');ancestor(grant.featureMergeCommitSha,main)
 }
 assert(record.scopeHash===sha(scopeBytes),'Current approved Scope record drift')
 assert(equal(Object.keys(record.controllerSha256??{}).sort(),controlPaths)&&controlPaths.every(path=>sha(bytes('show',control+':'+path))===record.controllerSha256[path]),'Controller byte registration missing')
 const receipt=bytes('show',main+':'+manifest.receiptPath)
 assert(typeof record.authorizationQuote==='string'&&record.authorizationQuote.trim().length>0&&receipt.includes(Buffer.from(record.authorizationQuote))&&sha(receipt)===record.authorizationReceiptSha256,'Actual Founder receipt missing')
 assert(equal(record.testEvidence,manifest.evidence),'Sealed test/build evidence binding missing')
 const review=record.review
 assert(review?.verdict==='PASS'&&review.control===control&&review.candidateTree===tree&&review.manifestSha256===manifestSha&&typeof review.evidence==='string'&&sha(Buffer.from(review.evidence))===review.sha256&&[tree,control,manifestSha,manifest.mainRouteSha256].every(value=>review.evidence.includes(value)),'Exact independent review missing')
 return{main,digest,record,paths,candidate,scopeBytes}
}
function preflight(){
 const {main,digest,paths,candidate,scopeBytes}=validated()
 const dir=mkdtempSync(resolve(tmpdir(),'diamond-normal54-sign-')),trusted=resolve(dir,'main'),release=resolve(dir,'candidate')
 try{
  git('worktree','add','--detach',trusted,main);git('worktree','add','-b',productRef.slice('refs/heads/'.length),release,candidate)
  const scopeFile=resolve(release,scopePath);mkdirSync(dirname(scopeFile),{recursive:true});appendFileSync(scopeFile,scopeBytes)
  const env={PATH:cleanEnv.PATH,HOME:dir,LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',GH_TOKEN:process.env.GH_TOKEN}
  const guard='scripts/guards/check-change-scope.js'
  assert(sha(bytes('show',main+':'+guard))===sha(bytes('show',candidate+':'+guard)),'Trusted Scope Guard changed')
  const scope=execFileSync(process.execPath,[resolve(release,guard),'--files',paths.join(','),'--task-id',task],{cwd:release,env,timeout:45000,stdio:['ignore','pipe','pipe']}).toString().trim()
  assert(scope.endsWith('\nPASS'),'Scope Guard failed')
  execFileSync('bash',[resolve(trusted,'scripts/check-selective-release.sh'),'--record',resolve(trusted,admissionPath),'--production',base,'--trusted-ref','origin/main','--release-ref',candidate],{cwd:trusted,env,timeout:45000,stdio:['ignore','pipe','pipe']})
  appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\ndigest='+digest+'\n')
 }finally{
  if(existsSync(release))git('worktree','remove','--force',release)
  if(existsSync(trusted))git('worktree','remove','--force',trusted)
  rmSync(dir,{recursive:true,force:true})
 }
}

async function request(path, credential, method='GET', payload) {
  const res = await fetch('https://api.github.com'+path, {
    method, redirect:'error', signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+credential,Accept:'application/vnd.github+json',
      'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
    body:payload===undefined ? undefined : JSON.stringify(payload),
  })
  assert(res.ok, method+' failed with '+res.status)
  return res.status===204 ? null : res.json()
}

async function publish() {
  assert(/^[0-9a-f]{64}$/.test(process.env.ADMISSION_DIGEST??''),'No-secret preflight did not authorize this record')
  const {main,digest,record,candidate}=validated(process.env.ADMISSION_DIGEST)
  assert(process.env.ADMISSION_MAIN===main, 'Preflight trusted main changed')
  const desc='Diamond normal54 '+digest
  const pem=Buffer.from(process.env.ESHOP_RELEASE_VALIDATOR_PEM??'')
  delete process.env.ESHOP_RELEASE_VALIDATOR_PEM
  assert(pem.length>0,'Protected App key is unavailable')
  let key
  try { key=createPrivateKey(pem) } finally { pem.fill(0) }
  assert(createHash('sha256').update(createPublicKey(key).export({type:'spki',format:'der'})).digest('base64')
    ==='yhwqkPtVSKmkg3q61U0dLzyUnqhtANv7C32L5q6t01c=', 'Not the previously admitted App key')
  const now=Math.floor(Date.now()/1000)
  const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url')
  const claims=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iat:now-60,exp:now+300,iss:String(appId)})
  const jwt=claims+'.'+sign('RSA-SHA256',Buffer.from(claims),key).toString('base64url')
  const installPath='/app/installations/'+installationId
  const app=await request(installPath,jwt)
  assert(app.app_id===appId && app.id===installationId && app.account?.login==='jasonmino-ops' &&
    app.suspended_at===null && app.repository_selection==='selected' &&
    Object.keys(app.permissions??{}).length===2 && app.permissions.metadata==='read' &&
    app.permissions.statuses==='write','Unexpected installation scope')
  const {token}=await request(installPath+'/access_tokens',jwt,'POST')
  try {
    const repos=await request('/installation/repositories?per_page=2',token)
    assert(repos.total_count===1 && repos.repositories?.length===1 && repos.repositories[0].full_name===repo,
      'Installation scope must be exactly one repository')
    const root='/repos/'+repo
    const candidateInfo=await request(root+'/commits/'+candidate,token)
    assert(candidateInfo.sha===candidate && candidateInfo.commit?.tree?.sha===tree &&
      candidateInfo.parents?.length===1 && candidateInfo.parents[0].sha===base,'GitHub candidate drifted')
    const rules=await request(root+'/rules/branches/release',token)
    assert(rules.some(rule=> rule.ruleset_id===26426184 &&
      rule.parameters?.required_status_checks?.some(check=>check.context===context && check.integration_id===appId)),
      'Required App binding changed')
    const control=await request(root+'/rules/branches/codex%2Frelease-validator-control',token)
    assert(['creation','update','deletion','non_fast_forward'].every(type =>
      control.some(rule=>rule.ruleset_id===27201182 && rule.type===type)), 'Protected control rules changed')
    for (const [id, ref, timestamp, actors] of [
      [26426184,'refs/heads/release','2026-11-03T07:59:36.789Z',[]],
      [27201182,controlRef,'2026-11-13T12:53:32.928Z',[{actor_id:5,actor_type:'RepositoryRole',bypass_mode:'always'}]],
    ]) {
      const policy=await request(root+'/rulesets/'+id,token)
      assert(policy.id===id && policy.enforcement==='active' &&
        new Date(policy.updated_at).toISOString()===timestamp &&
        JSON.stringify(policy.conditions?.ref_name?.include)===JSON.stringify([ref]) &&
        policy.conditions?.ref_name?.exclude?.length===0 &&
        (policy.bypass_actors===undefined || JSON.stringify(policy.bypass_actors)===JSON.stringify(actors)),
        'Approved ruleset revision or bypass actors changed')
    }
    const statusPath=root+'/commits/'+candidate+'/statuses?per_page=100'
    const old=(await request(statusPath,token)).find(entry=>entry.context===context)
    assert(!old,'Existing status on this candidate requires manual reconciliation')
    const checked = validated(digest)
    assert(checked.main===main && checked.candidate===candidate,'Refs changed while preparing App signature')
    const sent=await request(root+'/statuses/'+candidate,token,'POST',{state:'success',context,description:desc})
    const latest=(await request(statusPath,token)).find(entry=>entry.context===context)
    assert(Number.isSafeInteger(sent.id) && latest?.id===sent.id && latest.state==='success' &&
      latest.creator?.id===creatorId && latest.creator.login==='e-shop-release-validator[bot]' &&
      latest.description===desc && Date.parse(latest.created_at)>=Date.parse(record.issuedAt) &&
      Date.parse(latest.created_at)<Date.parse(record.expiresAt),'Exact App signature failed readback')
    console.log(JSON.stringify({candidate,appId,status:'success',recordSha256:digest,expiresAt:record.expiresAt}))
  } finally {
    await request('/installation/token',token,'DELETE')
  }
}

if (process.argv.length !== 3 || !['preflight','publish'].includes(process.argv[2])) {
  console.error('BLOCKED: explicit protected workflow phase required')
  process.exitCode=1
} else {
  try {
    if (process.argv[2]==='preflight') preflight()
    else await publish()
  } catch (error) {
    console.error(error instanceof Error && !error.cmd ? 'BLOCKED: '+error.message : 'BLOCKED: trusted verifier command failed')
    process.exitCode=1
  }
}

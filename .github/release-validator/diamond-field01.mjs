import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repo = 'jasonmino-ops/light-ops-assistant'
const url = 'https://github.com/' + repo + '.git'
const appId = 5590705
const installationId = 178077967
const creatorId = 351820557
const controlRef = 'refs/heads/codex/release-validator-control'
const productRef = 'refs/heads/codex/diamond-field-fix-01-exact'
const sourceRef = 'refs/heads/codex/diamond-field-fix-01-source'
const base = 'cf3960dc953eb58c48dd50edefe605aa4327abd8'
const candidate = 'fd4b626ba6381743edde1449fc269cda7ab0a936'
const parent = base
const source = '91c67aab00abe80f14d1929021fc8d79c5277e6c'
const mainBase = '8873afe3efe4e0ff8c2238c7c38251da0c0ab4f0'
const previousControl = 'be2cb36a8535abaf17bfc0dcc9ade00ad4fd18cc'
const tree = '4bcf8d18190aa7b270ef4c9424243f0e9b681187'
const admissionPath = 'docs/change-gates/ES-NATIVE-INVENTORY-DIAMOND-FIELD-FIX-01.json'
const manifestPath = '.github/release-validator/diamond-field01.paths.json'
const manifestSha = '12875ecfde2922d6e7a1157d60db8a1d14f05be31368c3b5a63f91670fdca607'
const approvalQuote = '目标：尽快将返回商品中心、未建档商品搜索和桌面授权入口三项 L2 修复发布到 Production。'
const controlPaths = [manifestPath, '.github/release-validator/diamond-field01.mjs', '.github/workflows/selective-release-validator.yml'].sort()
const context = 'eshop/selective-release-validator'
const assert = (check, reason) => { if (!check) throw new Error(reason) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const cleanEnv = {
  PATH:process.env.PATH, HOME:process.env.HOME, LC_ALL:'C',
  GIT_NO_REPLACE_OBJECTS:'1', GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null',
}
const git = (...args) => execFileSync('git',['-c','core.fsmonitor=false',...args],
  {env:cleanEnv, timeout:15000,stdio:['ignore','pipe','pipe']}).toString().trim()
const remote = () => new Map(git('ls-remote','--heads',url,'refs/heads/main','refs/heads/release',productRef,sourceRef,controlRef)
  .split('\n').map(line => line.split('\t').reverse()))

function verifiedRefs() {
  assert(process.env.GITHUB_REPOSITORY === repo && process.env.GITHUB_REF === controlRef &&
    git('rev-parse','HEAD') === process.env.GITHUB_SHA &&
    !git('status','--porcelain=v1','--untracked-files=all'), 'Must run a clean, exact protected workflow')
  const refs = remote()
  assert(refs.get('refs/heads/release') === base && refs.get(productRef) === candidate &&
    refs.get(sourceRef) === source && refs.get(controlRef) === process.env.GITHUB_SHA, 'Live source, release, product or protected control ref drifted')
  const main = refs.get('refs/heads/main')
  assert(/^[0-9a-f]{40}$/.test(main ?? '') && git('rev-parse','origin/main') === main,
    'Checkout has stale or invalid trusted main')
  assert(git('show','-s','--format=%P',candidate) === parent &&
    git('show','-s','--format=%P',source) === mainBase &&
    git('rev-parse',candidate+'^{tree}') === tree, 'Exact candidate lineage changed')
  return main
}

const bytes = (...args) => execFileSync('git',['--no-replace-objects',...args],{
  env:cleanEnv,timeout:15000,stdio:['ignore','pipe','pipe'],
})
const names = (a,b) => bytes('diff','--name-only','-z','--no-renames',a,b).toString().split('\0').filter(Boolean).sort()
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b)
const hashFields = ['sourceBefore','sourceAfter','releaseBefore','releaseAfter']
const refParents = ref => git('show','-s','--format=%P',ref)

function verifyFiles(manifest) {
  const paths=manifest.files.map(f=>f.path).sort()
  assert(paths.length===10 && new Set(paths).size===10 &&
    equal(paths,names(mainBase,source)) && equal(paths,names(base,candidate)), 'Extra or missing path')
  assert(git('show','-s','--format=%B',candidate).split('\n').filter(
    line=>line.startsWith('(cherry picked from commit ')).join('')==='(cherry picked from commit '+source+')','Exact source trailer missing')
  function verifyBlob(ref,path,mode,hash) {
    const entry=git('ls-tree',ref,'--',path)
    if (mode==='000000') {
      assert(entry==='' && hash===sha(Buffer.alloc(0)),'Unexpected addition base '+path)
      return
    }
    assert(entry.startsWith(mode+' blob ') && sha(bytes('show',ref+':'+path))===hash,'File hash mismatch '+path)
  }
  for (const f of manifest.files) {
    assert(['000000','100644'].includes(f.oldMode) && f.newMode==='100644' &&
      hashFields.every(k=>/^[a-f0-9]{64}$/.test(f[k])), 'Invalid file attestation')
    verifyBlob(mainBase,f.path,f.oldMode,f.sourceBefore)
    verifyBlob(source,f.path,f.newMode,f.sourceAfter)
    verifyBlob(base,f.path,f.oldMode,f.releaseBefore)
    verifyBlob(candidate,f.path,f.newMode,f.releaseAfter)
  }
  const different=manifest.files.filter(f=>f.sourceBefore!==f.releaseBefore || f.sourceAfter!==f.releaseAfter).map(f=>f.path).sort()
  assert(different.length===8 && equal(different,Object.keys(manifest.adaptations).sort()), 'Unapproved baseline difference')
}

function validRecord(main, expectedDigest) {
  const control=process.env.GITHUB_SHA
  assert(refParents(main)===mainBase && equal(names(mainBase,main),[admissionPath]),'Unexpected trusted main changes')
  assert(refParents(control)===previousControl && equal(names(previousControl,control),controlPaths),'Unexpected control changes')
  const body=bytes('show',main+':'+admissionPath)
  const digest=sha(body)
  if(expectedDigest!==undefined) assert(digest===expectedDigest,'Preflight digest changed')
  const record=JSON.parse(body)
  const manifestBytes=bytes('show',control+':'+manifestPath)
  const manifest=JSON.parse(manifestBytes)
  const now=Date.now()
  const issued=Date.parse(record.issuedAt)
  const expires=Date.parse(record.expiresAt)
  assert(record.status==='APPROVED' && record.approvedBy==='Founder' &&
    record.kind==='EXACT_L2_BASELINE_ADAPTATION' && record.store==='ST883DC00C' &&
    record.approvalSource==='Diamond FIELD FIX 01 最终发布收口' && record.approvalQuote===approvalQuote &&
    record.source===source && record.sourceBase===mainBase && record.candidate===candidate &&
    record.releaseBase===base && record.candidateTree===tree && record.signingControlSha===control &&
    record.manifestSha256===manifestSha && sha(manifestBytes)===manifestSha &&
    record.productionDeployment==='dpl_4PkKC2eKKTSNTS9zssD5BEBb924X' &&
    issued<=now && now<expires && expires-issued<=7200000,'Invalid exact L2 admission')
  assert(equal(Object.keys(record.controlPathsSha256).sort(),controlPaths) && controlPaths.every(path=>
    sha(bytes('show',control+':'+path))===record.controlPathsSha256[path]),'Reviewed control bytes drifted')
  assert(equal(record.adaptations,manifest.adaptations),'Adaptation evidence changed')
  const review=record.independentReview
  assert(review?.verdict==='PASS' && review.releaseCandidate===candidate && review.control===control &&
    review.manifestSha256===manifestSha && typeof review.evidence==='string' &&
    review.evidence.includes('Control review: PASS') && review.evidence.includes(control) &&
    sha(Buffer.from(review.evidence))===record.independentReviewSha256,'Independent review evidence missing')
  const frozen=manifest.files.filter(f=>f.frozen)
  assert(frozen.length===6 && record.frozenSuccessor?.kind==='EXACT_RELEASE_ONLY' &&
    record.frozenSuccessor?.approvedBy==='Founder' &&
    equal(Object.keys(record.frozenSuccessor.files).sort(),frozen.map(f=>f.path).sort()) &&
    frozen.every(f=>record.frozenSuccessor.files[f.path]?.before===f.releaseBefore &&
      record.frozenSuccessor.files[f.path]?.after===f.releaseAfter),'Unapproved frozen change')
  verifyFiles(manifest)
  return {digest,record,paths:manifest.files.map(f=>f.path)}
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

function preflight() {
  const main=verifiedRefs()
  const {digest,paths}=validRecord(main)
  const dir=mkdtempSync(resolve(tmpdir(),'field01-sign-preflight-'))
  const trusted=resolve(dir,'main')
  try {
    git('worktree','add','--detach',trusted,main)
    const env={PATH:cleanEnv.PATH,HOME:dir,LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',
      GH_TOKEN:process.env.GH_TOKEN}
    function check(script, args, expected) {
      const result=execFileSync(process.execPath,[script,...args],{
        cwd:trusted,env,timeout:45000,stdio:['ignore','pipe','pipe'],
      }).toString().trim()
      assert(expected(result),'Trusted Scope or Frozen check failed')
    }
    check('scripts/guards/check-change-scope.js',['--files',paths.join(',')], result=>result.endsWith('\nPASS'))
    check('scripts/governance/es-native-inventory-m1-successor.cjs',[],
      result=>result.startsWith('REMOTE AUTHORITY PASS: non-production M1 Frozen Successor'))
    appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\ndigest='+digest+'\n')
  } finally {
    try { git('worktree','remove','--force',trusted) } finally { rmSync(dir,{recursive:true,force:true}) }
  }
}

async function publish() {
  const main=verifiedRefs()
  assert(process.env.ADMISSION_MAIN===main && /^[0-9a-f]{64}$/.test(process.env.ADMISSION_DIGEST??''),
    'Exact no-secret preflight did not authorize this record')
  const {digest,record}=validRecord(main,process.env.ADMISSION_DIGEST)
  const desc='Diamond FIELD 01 '+digest
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
      candidateInfo.parents?.length===1 && candidateInfo.parents[0].sha===parent,'GitHub candidate drifted')
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
    assert(verifiedRefs()===main,'Refs changed while preparing App signature')
    validRecord(main,digest)
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

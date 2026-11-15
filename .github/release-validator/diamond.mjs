import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readOriginCorrection } from './diamond-origin-correction.mjs'

const repo = 'jasonmino-ops/light-ops-assistant'
const url = 'https://github.com/' + repo + '.git'
const appId = 5590705
const installationId = 178077967
const creatorId = 351820557
const controlRef = 'refs/heads/codex/release-validator-control'
const productRef = 'refs/heads/codex/es-native-inventory-diamond-phase1'
const base = '1f33d03bcba0bc5d2173be7afe0e3cb0694345c8'
const candidate = 'cf3960dc953eb58c48dd50edefe605aa4327abd8'
const parent = '50d47a1e9555e1919f7b0017a860132e8ba66930'
const tree = '923ed8b4aa864e8ad7e929545355263ac6ce2889'
const sourceVerifier = 'scripts/governance/verify-diamond-phase1-b.mjs'
const context = 'eshop/selective-release-validator'
const assert = (check, reason) => { if (!check) throw new Error(reason) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const cleanEnv = {
  PATH:process.env.PATH, HOME:process.env.HOME, LC_ALL:'C',
  GIT_NO_REPLACE_OBJECTS:'1', GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null',
}
const git = (...args) => execFileSync('git',['-c','core.fsmonitor=false',...args],
  {env:cleanEnv, timeout:15000,stdio:['ignore','pipe','pipe']}).toString().trim()
const remote = () => new Map(git('ls-remote','--heads',url,'refs/heads/main','refs/heads/release',productRef,controlRef)
  .split('\n').map(line => line.split('\t').reverse()))

function verifiedRefs() {
  assert(process.env.GITHUB_REPOSITORY === repo && process.env.GITHUB_REF === controlRef &&
    git('rev-parse','HEAD') === process.env.GITHUB_SHA &&
    !git('status','--porcelain=v1','--untracked-files=all'), 'Must run a clean, exact protected workflow')
  const refs = remote()
  assert(refs.get('refs/heads/release') === base && refs.get(productRef) === candidate &&
    refs.get(controlRef) === process.env.GITHUB_SHA, 'Live release, product or protected control ref drifted')
  const main = refs.get('refs/heads/main')
  assert(/^[0-9a-f]{40}$/.test(main ?? '') && git('rev-parse','origin/main') === main,
    'Checkout has stale or invalid trusted main')
  assert(git('show','-s','--format=%P',candidate) === parent &&
    git('show','-s','--format=%P',parent) === base &&
    git('rev-parse',candidate+'^{tree}') === tree, 'Exact candidate lineage changed')
  return main
}

function validRecord(main, expectedDigest) {
  const exactGit=(...args)=>execFileSync('git',['--no-replace-objects',...args],
    {env:cleanEnv,timeout:10000,stdio:['ignore','pipe','pipe']})
  const control=remote().get(controlRef)
  assert(control===process.env.GITHUB_SHA && control===git('rev-parse','HEAD'),'Live protected control ref drifted')
  const {record,recordSha256:digest}=readOriginCorrection(exactGit,main,control)
  if (expectedDigest !== undefined) assert(digest === expectedDigest,'Preflight digest changed')
  const now = Date.now()
  assert(record.status === 'APPROVED' && record.approvedBy === 'Founder' &&
    record.path === 'B' && record.runtime === 'R2' && record.candidate === candidate &&
    record.releaseBase === base && record.candidateTree === tree &&
    Date.parse(record.issuedAt) <= now && now < Date.parse(record.expiresAt), 'Invalid or expired admission record')
  return {digest,record}
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
  // This step has no App secret. Execute only the control-pinned verifier.
  const main = verifiedRefs()
  const {digest} = validRecord(main)
  const verifier = git('show',main+':'+sourceVerifier)
  const bytes = execFileSync('git',['show',main+':'+sourceVerifier],{env:cleanEnv,stdio:['ignore','pipe','pipe'],timeout:10000})
  assert(sha(bytes)==='ac5cce37343405922149cdf3dd9a16948fb60021c50707555e307e6e1c9d8a7e' && verifier.length > 0,'Unexpected trusted verifier bytes')
  const dir = mkdtempSync(resolve(tmpdir(),'diamond-sign-preflight-'))
  const product = resolve(dir,'product')
  const trusted = resolve(dir,'main')
  try {
    git('worktree','add','--detach',product,candidate)
    git('worktree','add','--detach',trusted,main)
    const manifest = resolve(dirname(fileURLToPath(import.meta.url)),'diamond.paths.sha256')
    const env = {PATH:cleanEnv.PATH, HOME:dir, LC_ALL:cleanEnv.LC_ALL,
      GIT_NO_REPLACE_OBJECTS:cleanEnv.GIT_NO_REPLACE_OBJECTS, GH_TOKEN:process.env.GH_TOKEN}
    const correctedVerifier=resolve(dirname(fileURLToPath(import.meta.url)),'diamond-corrected-verifier.mjs')
    const result=JSON.parse(execFileSync(process.execPath,[correctedVerifier,
      product,candidate,manifest,'--verify-for-app',trusted],{env,timeout:90000,stdio:['ignore','pipe','pipe']}).toString())
    assert(result.state==='VERIFIED_FOR_SIGNING' && result.main===main && result.candidate===candidate &&
      result.recordSha256===digest,'Scoped admission did not pass')
    appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\ndigest='+digest+'\n')
  } finally {
    for (const path of [product,trusted]) {
      try { git('worktree','remove','--force',path) } catch {}
    }
    rmSync(dir,{recursive:true,force:true})
  }
}

async function publish() {
  const main=verifiedRefs()
  assert(process.env.ADMISSION_MAIN===main && /^[0-9a-f]{64}$/.test(process.env.ADMISSION_DIGEST??''),
    'Exact no-secret preflight did not authorize this record')
  const {digest,record}=validRecord(main,process.env.ADMISSION_DIGEST)
  const desc='Diamond B/R2 '+digest
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

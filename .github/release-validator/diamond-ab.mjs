import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { appendFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repo = 'jasonmino-ops/light-ops-assistant'
const url = 'https://github.com/' + repo + '.git'
const appId = 5590705
const installationId = 178077967
const creatorId = 351820557
const controlRef = 'refs/heads/codex/release-validator-control'
const productRef = 'refs/heads/codex/es-diamond-native-inventory-combined'
const base = 'fd4b626ba6381743edde1449fc269cda7ab0a936'
const previousControl = '2c1482c4a1da33e6c90e7c3e49ef3a8d5427c266'
const mainBase = '7c2e306133106ee5836ea8ca7c0d4ff902711fb9'
const tree = '7e7a429d032573e77238d27af0cc8000e2d216ab'
const task = 'ES-NATIVE-INVENTORY-DIAMOND-AB'
const scopePath = 'docs/change-gates/exceptions/' + task + '.json'
const approvalSource = 'Diamond A+B 最终发布准入'
const approvalQuote = '批准为已封存的 A+B 合并候选完成一次精确 Scope/Frozen 登记及 Release Lineage 后继。'
const admissionPath = 'docs/change-gates/' + task + '.json'
const manifestPath = '.github/release-validator/diamond-ab.paths.json'
const manifestSha = 'e78fed82d3e2338d51e46ce299715d2a261028bf8cf82eacbf8cb46fa3e0b14a'
const controlPaths = [manifestPath, '.github/release-validator/diamond-ab.mjs', '.github/workflows/selective-release-validator.yml'].sort()
const context = 'eshop/selective-release-validator'
const assert = (check, reason) => { if (!check) throw new Error(reason) }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const cleanEnv = {
  PATH:process.env.PATH, HOME:process.env.HOME, LC_ALL:'C',
  GIT_NO_REPLACE_OBJECTS:'1', GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null',
}
const git = (...args) => execFileSync('git',['-c','core.fsmonitor=false',...args],
  {env:cleanEnv, timeout:15000,stdio:['ignore','pipe','pipe']}).toString().trim()
const bytes = (...args) => execFileSync('git',['--no-replace-objects',...args],{
  env:cleanEnv,timeout:15000,stdio:['ignore','pipe','pipe'],
})
const names = (a,b) => bytes('diff','--name-only','-z','--no-renames',a,b).toString().split('\0').filter(Boolean).sort()
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b)

function verifyCandidate(candidate, manifest) {
  assert(git('show','-s','--format=%P',candidate) === base && git('rev-parse',candidate+'^{tree}') === tree, 'Exact parent or tree mismatch')
  const paths = Object.keys(manifest.paths).sort()
  assert(paths.length === 15 && equal(paths,names(base,candidate)), 'Unexpected release paths')
  const migrations = paths.filter(file => file.startsWith('prisma/migrations/'))
  assert(equal(migrations,[manifest.migrationPath]) && manifest.paths[manifest.migrationPath].after===manifest.migrationSha256,
    'Unexpected migration or bytes')
  assert(sha(bytes('diff','--no-ext-diff','--binary','--full-index',base,candidate)) === manifest.patchSha256, 'Sealed patch mismatch')
  for (const path of paths) {
    const check = manifest.paths[path]
    const previous = git('ls-tree',base,'--',path)
    if (check.before === null) assert(!previous, 'Unexpected previous path: '+path)
    else assert(previous.startsWith('100644 blob ') && sha(bytes('show',base+':'+path)) === check.before,'Previous bytes or mode changed: '+path)
    assert(git('ls-tree',candidate,'--',path).startsWith('100644 blob ') &&
      sha(bytes('show',candidate+':'+path)) === check.after,'Candidate bytes or mode changed: '+path)
  }
  return paths
}

function validated(expectedDigest) {
  const control = process.env.GITHUB_SHA
  assert(process.env.GITHUB_REPOSITORY === repo && process.env.GITHUB_REF === controlRef &&
    git('rev-parse','HEAD') === control && !git('status','--porcelain=v1','--untracked-files=all'),
    'Must run a clean, exact protected workflow')
  const refs = new Map(git('ls-remote','--heads',url,'refs/heads/main','refs/heads/release',productRef,controlRef)
    .split('\n').map(line=>line.split('\t').reverse()))
  const main = refs.get('refs/heads/main')
  const candidate = refs.get(productRef)
  assert(refs.get('refs/heads/release') === base && refs.get(controlRef) === control &&
    main && candidate && git('rev-parse','origin/main') === main &&
    git('rev-parse','origin/codex/es-diamond-native-inventory-combined') === candidate, 'Live or fetched refs drifted')
  assert(git('show','-s','--format=%P',control) === previousControl &&
    equal(names(previousControl,control),controlPaths),'Unexpected control parent or paths')
  const scopeCommit = git('show','-s','--format=%P',main)
  assert(git('show','-s','--format=%P',scopeCommit) === mainBase &&
    equal(names(mainBase,scopeCommit),[scopePath]) && equal(names(scopeCommit,main),[admissionPath]), 'Unexpected trusted main parent or paths')

  const manifestBytes = bytes('show',control+':'+manifestPath)
  assert(sha(manifestBytes) === manifestSha, 'Sealed manifest drifted')
  const manifest = JSON.parse(manifestBytes)
  const scopeBytes = bytes('show',main+':'+scopePath)
  const scope = JSON.parse(scopeBytes)
  assert(sha(scopeBytes) === manifest.scopeHash && scope.status === 'ACTIVE' && scope.approvedBy === 'Founder' &&
    scope.taskId===task && scope.featureBranch===productRef.slice('refs/heads/'.length) && scope.authorizedPaths.length===5 &&
    scope.authorizedPaths.every(p=>scope.authorizedPathSha256[p]===manifest.paths[p]?.after), 'Scope binding changed')
  const recordBytes = bytes('show',main+':'+admissionPath)
  const digest = sha(recordBytes)
  assert(expectedDigest === undefined || digest === expectedDigest, 'Preflight digest changed')
  const record = JSON.parse(recordBytes)
  const now = Date.now()
  const issued = Date.parse(record.issuedAt)
  const expires = Date.parse(record.expiresAt)
  assert(record.taskId===task && record.status==='APPROVED' && record.approvedBy==='Founder' &&
    record.authorizationType==='EXACT_DIAMOND_AB_SCOPE_FROZEN_LINEAGE_SUCCESSOR' &&
    record.approvalSource===approvalSource && record.approvalQuote===approvalQuote &&
    record.candidate===candidate && record.base===base && record.tree===tree &&
    record.sourceA===manifest.sourceA && record.sourceBTree===manifest.sourceBTree &&
    record.scopeCommit===scopeCommit && record.scopeHash===manifest.scopeHash &&
    record.control===control && record.manifestSha256===manifestSha &&
    record.storeCode==='ST883DC00C' && record.productionDeployment===manifest.productionDeployment &&
    record.migrationSha256===manifest.migrationSha256 &&
    record.executionGate==='FOUNDER_PRODUCTION_GATE_PENDING' &&
    issued<=now && now<expires && expires-issued<=7200000, 'Invalid or expired admission')
  assert(equal(Object.keys(record.controllerSha256).sort(),controlPaths) && controlPaths.every(p=>
    sha(bytes('show',control+':'+p))===record.controllerSha256[p]), 'Controller bytes not registered')
  assert(equal(record.frozenAndLineage,manifest.paths),'Frozen or Lineage file binding differs')
  const review=record.review
  assert(review?.verdict==='PASS' && review.control===control && review.candidateTree===tree && review.candidate===candidate &&
    review.manifestSha256===manifestSha && review.scopeHash===manifest.scopeHash &&
    typeof review.evidence==='string' && review.evidence.includes('Technical review: PASS') &&
    [candidate,control,manifestSha,manifest.scopeHash].every(value=>review.evidence.includes(value)) &&
    sha(Buffer.from(review.evidence))===review.sha256,
    'Exact independent review evidence missing')
  assert(equal(record.testEvidence,manifest.evidence),'Test evidence binding differs')
  const paths = verifyCandidate(candidate,manifest)
  return {main, digest, record, paths, candidate, scopeBytes}
}

function preflight() {
  const {main,digest,paths,candidate,scopeBytes} = validated()
  const dir = mkdtempSync(resolve(tmpdir(),'diamond-ab-sign-'))
  const trusted = resolve(dir,'main')
  const release = resolve(dir,'candidate')
  try {
    git('worktree','add','--detach',trusted,main)
    git('worktree','add','-b','codex/es-diamond-native-inventory-combined',release,candidate)
    const env = {PATH:cleanEnv.PATH,HOME:dir,LC_ALL:'C',GIT_NO_REPLACE_OBJECTS:'1',GH_TOKEN:process.env.GH_TOKEN}
    const scopeFile = resolve(release,scopePath)
    appendFileSync(scopeFile,scopeBytes)
    const guard = resolve(release,'scripts/guards/check-change-scope.js')
    assert(sha(bytes('show',main+':scripts/guards/check-change-scope.js'))===sha(bytes('show',candidate+':scripts/guards/check-change-scope.js')), 'Guard bytes differ')
    const scope = execFileSync(process.execPath,[guard,'--files',paths.join(','),'--task-id',task],{
      cwd:release,env,timeout:45000,stdio:['ignore','pipe','pipe'],
    }).toString().trim()
    assert(scope.endsWith('\nPASS'),'Scope Guard did not pass')
    const frozen = execFileSync(process.execPath,['scripts/governance/es-native-inventory-m1-successor.cjs'],{
      cwd:trusted,env,timeout:45000,stdio:['ignore','pipe','pipe'],
    }).toString().trim()
    assert(frozen.startsWith('REMOTE AUTHORITY PASS: non-production M1 Frozen Successor'),'Trusted main Frozen check failed')
    appendFileSync(process.env.GITHUB_OUTPUT,'main='+main+'\ndigest='+digest+'\n')
  } finally {
    if (existsSync(release)) git('worktree','remove','--force',release)
    if (existsSync(trusted)) git('worktree','remove','--force',trusted)
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
  const desc='Diamond A+B '+digest
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

// Exact ST04 selective-release control. Only the protected publish phase can issue an App status.
import assert from 'node:assert/strict'
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = 'jasonmino-ops/light-ops-assistant'
const url = 'https://github.com/' + repo + '.git'
const appId = 5590705, installationId = 178077967, creatorId = 351820557
const context = 'eshop/selective-release-validator'
const controlRef = 'refs/heads/codex/release-validator-control'
const manifestPath = '.github/release-validator/st04-closeout.json'
const manifestSha = 'fcb15707ab655540a507735f28fdee7792f34c6835698843053e3f439e911df6'
const controlPaths = [
  '.github/release-validator/st04-closeout.mjs', manifestPath,
  '.github/release-validator/st04-closeout.test.mjs', '.github/workflows/selective-release-validator.yml',
].sort()
const admissionPath = 'docs/releases/ES-V3-NEW-STORE-PRINT-CLOSEOUT.json'
const receiptDir = 'docs/releases/evidence/ES-V3-NEW-STORE-PRINT-CLOSEOUT/'
const receiptPath = receiptDir + 'founder-release.json'
const reviewPath = receiptDir + 'controller-review.json'
const previousApprovalPath = receiptDir + 'main-admission.json'
const newMainPaths = [admissionPath, receiptPath, reviewPath, previousApprovalPath].sort()
const evidenceDir = 'docs/change-gates/evidence/ES-V3-NEW-STORE-PRINT-CLOSEOUT/'
const cleanEnv = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', GIT_NO_REPLACE_OBJECTS: '1',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }

const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const rawManifest = readFileSync(new URL('./st04-closeout.json', import.meta.url))
assert.equal(sha(rawManifest), manifestSha, 'Sealed ST04 manifest changed')
const manifest = JSON.parse(rawManifest)
const tree = manifest.tree
const bytes = (...args) => execFileSync('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args],
  { env: cleanEnv, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] })
const git = (...args) => bytes(...args).toString().trim()
const pathsChanged = (from, to) => bytes('diff', '--no-renames', '--name-only', '-z', from, to).toString().split('\0').filter(Boolean).sort()
function blob(commit, path, mode = '100644') {
  assert(git('ls-tree', commit, '--', path).startsWith(mode + ' blob '), 'Expected regular file: ' + path)
  return bytes('show', commit + ':' + path)
}
function readRefs() {
  const refs = ['refs/heads/main', 'refs/heads/release', manifest.productRef, controlRef]
  const lines = git('ls-remote', '--heads', url, ...refs).split('\n')
  const result = new Map(lines.map(line => line.split('\t').reverse()))
  for (const ref of refs) assert.match(result.get(ref) || '', /^[0-9a-f]{40}$/, 'Missing live ref: ' + ref)
  return result
}

function verifyCashierOperand(paths, count, digest) {
  assert.equal(paths.length, count, 'Cashier assertion path count changed')
  assert.equal(sha(Buffer.from(paths.join('\0') + '\0')), digest, 'Cashier assertion operand changed')
}

export function verifySources() {
  assert.equal(git('rev-parse', manifest.mainBase + '^{tree}'), manifest.mainTree)
  assert.equal(git('rev-parse', manifest.candidate + '^{tree}'), tree)
  git('merge-base', '--is-ancestor', manifest.product, manifest.mainBase)
  const post = manifest.postAdmissionCore
  assert.deepEqual(newMainPaths, post.additionalGovernancePaths)
  const current = pathsChanged(post.historicalBase, manifest.mainBase)
  verifyCashierOperand(current, post.currentPathCount, post.currentOperandSha256)
  verifyCashierOperand([...new Set([...current, ...newMainPaths])].sort(), post.nextPathCount, post.nextOperandSha256)
  const commits = git('rev-list', '--reverse', manifest.base + '..' + manifest.candidate).split('\n')
  assert.deepEqual(commits, manifest.orderedProjection.map(pair => pair.release))
  let parent = manifest.base
  for (const pair of manifest.orderedProjection) {
    assert.equal(git('show', '-s', '--format=%P', pair.release), parent)
    const sources = [...git('show', '-s', '--format=%B', pair.release).matchAll(/\(cherry picked from commit ([0-9a-f]{40})\)/g)]
    assert.deepEqual(sources.map(match => match[1]), [pair.source])
    git('merge-base', '--is-ancestor', pair.source, manifest.mainBase)
    assert.equal(git('rev-parse', pair.source + '^{tree}'), git('rev-parse', pair.release + '^{tree}'))
    parent = pair.release
  }
  assert.deepEqual(pathsChanged(manifest.base, manifest.candidate), [...manifest.scopePaths].sort())
  for (const [path, digest] of Object.entries(manifest.trustedEvidence)) {
    assert.equal(sha(blob(manifest.mainBase, path)), digest, 'Admitted evidence changed: ' + path)
  }
  for (const [path, digest] of Object.entries(manifest.guards)) {
    assert.equal(sha(blob(manifest.mainBase, path, digest.mainMode)), digest.main)
    assert.equal(sha(blob(manifest.candidate, path, digest.candidateMode)), digest.candidate)
  }
}

function validTime(value) {
  assert.equal(typeof value, 'string', 'Timestamp required')
  const ms = Date.parse(value)
  assert(Number.isFinite(ms) && new Date(ms).toISOString() === value, 'Canonical UTC timestamp required')
  return ms
}

export function verifyAuthorization({ record, receipt, review, control, now }) {
  const ordered = manifest.orderedProjection.map(pair => pair.source)
  assert.equal(record.releaseId, manifest.releaseId)
  assert.deepEqual(record.taskIds, manifest.taskIds)
  assert.equal(record.sourceMainSha, manifest.mainBase)
  assert.equal(record.baseProductionSha, manifest.base)
  assert.equal(record.releaseSha, manifest.candidate)
  assert.equal(record.releaseTree, tree)
  assert.equal(record.productionDeployment, manifest.deployment)
  assert.equal(record.deploymentId, 'PENDING')
  assert.equal(record.productionSha, 'PENDING')
  assert.equal(record.storeCode, manifest.storeCode)
  assert.equal(record.migrationCount, 0)
  assert.equal(record.control, control)
  assert.equal(record.manifestSha256, manifestSha)
  assert.deepEqual(record.includedSourceCommits, ordered)
  const auth = record.founderAuthorization
  assert.equal(auth?.approvedBy, 'Founder')
  assert.equal(auth.status, 'APPROVED')
  assert.equal(auth.authorizationId, manifest.releaseId + '-PROTECTED-RELEASE')
  assert.deepEqual(auth.includedSourceCommits, ordered)
  const approved = validTime(auth.approvedAt), issued = validTime(record.issuedAt), expires = validTime(record.expiresAt)
  assert(approved <= issued && issued <= now && now < expires && expires - approved <= 7200000, 'Release grant expired or outside two-hour window')
  assert(expires <= Date.parse(manifest.expiresNoLaterThan), 'Failure disposition expired')
  const disposition = manifest.trustedEvidence[evidenceDir + 'candidate-scoped-disposition.request.json']
  assert.equal(receipt.decision, 'APPROVE_EXACT_SELECTIVE_PRODUCTION_RELEASE')
  assert.equal(receipt.approvedBy, 'Founder')
  assert.equal(receipt.authorizationId, auth.authorizationId)
  assert.equal(receipt.approvedAt, auth.approvedAt)
  assert.equal(receipt.expiresAt, record.expiresAt)
  assert.equal(receipt.releaseSha, manifest.candidate)
  assert.equal(receipt.releaseTree, tree)
  assert.equal(receipt.sourceMainSha, manifest.mainBase)
  assert.equal(receipt.baseProductionSha, manifest.base)
  assert.equal(receipt.productionDeployment, manifest.deployment)
  assert.equal(receipt.control, control)
  assert.deepEqual(receipt.includedSourceCommits, ordered)
  assert.equal(receipt.acceptedReleaseDispositionSha256, disposition)
  assert.equal(record.acceptedReleaseDispositionSha256, disposition)
  assert.equal(record.postAdmissionCoreSha256, manifest.postAdmissionCore.evidenceSha256)
  assert.equal(receipt.postAdmissionCoreSha256, manifest.postAdmissionCore.evidenceSha256)
  assert.equal(receipt.verbatimAnswer, record.authorizationQuote)
  assert.equal(typeof receipt.requestReference, 'string')
  assert(receipt.requestReference.trim().length > 0)
  assert.equal(typeof receipt.verbatimAnswer, 'string')
  assert.equal(receipt.verbatimAnswer, '本人批准 ST04 精确候选通过受保护校验后发布到 Production，零迁移')
  // The independently registered production request must explicitly identify this action.
  for (const term of ['Production', manifest.candidate, control, disposition, manifest.postAdmissionCore.evidenceSha256]) assert(receipt.verbatimQuestion.includes(term))
  assert.equal(review.verdict, 'PASS')
  assert.equal(review.control, control)
  assert.equal(review.candidate, manifest.candidate)
  assert.equal(review.tree, tree)
  assert.equal(review.manifestSha256, manifestSha)
  assert.equal(typeof review.evidence, 'string')
  assert([control, tree, manifestSha, manifest.candidate].every(term => review.evidence.includes(term)))
  assert.equal(sha(Buffer.from(review.evidence)), review.evidenceSha256)
}

function validated(expectedDigest) {
  const control = process.env.GITHUB_SHA
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push')
  assert.equal(process.env.GITHUB_REPOSITORY, repo)
  assert.equal(process.env.GITHUB_REF, controlRef)
  assert.equal(git('rev-parse','HEAD'), control)
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'), '')
  assert.equal(git('remote','get-url','origin'), url)
  assert.equal(git('show','-s','--format=%P',control), manifest.previousControl)
  assert.deepEqual(pathsChanged(manifest.previousControl, control), controlPaths)
  assert.equal(sha(blob(control, manifestPath)), manifestSha)
  const live = readRefs(), main = live.get('refs/heads/main'), candidate = live.get(manifest.productRef)
  assert.equal(live.get(controlRef), control)
  assert.equal(live.get('refs/heads/release'), manifest.base)
  assert.equal(candidate, manifest.candidate)
  for (const [ref, value] of live) assert.equal(git('rev-parse','refs/remotes/origin/' + ref.slice('refs/heads/'.length)), value)
  verifySources()
  // Only a new, exact governance commit can admit the production decision.
  assert.equal(git('show','-s','--format=%P',main), manifest.mainBase)
  assert.deepEqual(pathsChanged(manifest.mainBase,main), newMainPaths)
  const post = manifest.postAdmissionCore
  verifyCashierOperand(pathsChanged(post.historicalBase, main), post.nextPathCount, post.nextOperandSha256)
  for (const path of newMainPaths) assert.equal(git('ls-tree', manifest.mainBase, '--', path), '')
  assert.equal(sha(blob(main, previousApprovalPath)), manifest.mainAdmissionReceiptSha256)
  const recordBytes = blob(main, admissionPath), digest = sha(recordBytes), record = JSON.parse(recordBytes)
  if (expectedDigest !== undefined) assert.equal(digest, expectedDigest)
  const receipt = blob(main, receiptPath), review = blob(main, reviewPath)
  assert.equal(sha(receipt), record.authorizationReceiptSha256)
  assert.equal(sha(review), record.reviewReceiptSha256)
  assert.deepEqual(Object.keys(record.controllerSha256 || {}).sort(), controlPaths)
  for (const path of controlPaths) assert.equal(sha(blob(control,path)), record.controllerSha256[path], 'Controller bytes changed: ' + path)
  verifyAuthorization({record, receipt: JSON.parse(receipt), review: JSON.parse(review), control, now:Date.now()})
  return { main, digest, record, candidate }
}

function preflight() {
  const { main, digest, candidate } = validated()
  const dir = mkdtempSync(resolve(tmpdir(),'st04-control-')), trusted = resolve(dir,'main'), release = resolve(dir,'candidate')
  try {
    git('worktree','add','--detach',trusted,main)
    git('worktree','add','--detach',release,candidate)
    const guard = 'scripts/guards/check-change-scope.js'
    assert.equal(sha(blob(main,guard)), sha(blob(candidate,guard)))
    const scope = execFileSync(process.execPath,[resolve(release,guard),'--files',manifest.scopePaths.join(',')],
      {cwd:release,env:cleanEnv,timeout:45000,encoding:'utf8'})
    assert(scope.trim().endsWith('\nPASS'), 'Scope Guard failed')
    execFileSync('bash',[resolve(trusted,'scripts/check-selective-release.sh'),'--record',resolve(trusted,admissionPath),
      '--production',manifest.base,'--trusted-ref','origin/main','--release-ref',candidate],
      {cwd:trusted,env:cleanEnv,timeout:45000,stdio:['ignore','pipe','pipe']})
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
  const desc='ST04 exact release '+digest
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
      candidateInfo.parents?.length===1 && candidateInfo.parents[0].sha===manifest.orderedProjection.at(-2).release,'GitHub candidate drifted')
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert(process.argv.length === 3 && ['preflight','publish'].includes(process.argv[2]), 'Explicit protected phase required')
    if (process.argv[2] === 'preflight') preflight()
    else await publish()
  } catch (error) {
    console.error('BLOCKED:', error instanceof Error && !error.cmd ? error.message : 'Trusted command failed')
    process.exitCode = 1
  }
}

import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appId = 5590705
const installationId = 178077967
const repository = 'jasonmino-ops/light-ops-assistant'
const creatorId = 351820557

async function request(path, credential, method = 'GET', payload) {
  const response = await fetch(new URL(path, 'https://api.github.com'), {
    method,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    headers: {
      ...(credential ? {Authorization: 'Bearer ' + credential} : {}),
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(method + ' ' + path + ' returned HTTP ' + response.status)
  return response.status === 204 ? null : response.json()
}


const evidence = fileURLToPath(new URL('.', import.meta.url))
const candidateWorktree = process.cwd()
const base = "dd02c7d49c824798f13c4901124bd6d84763f434"
const candidate = "1f33d03bcba0bc5d2173be7afe0e3cb0694345c8"
const main = "24528f1e346b2c83913bdfa0a841b5e0ca6a6fd4"
const approvedTree = "5e114059d42bad6013854c1d2b1ba0d6160e0da7"
const staging = "refs/heads/codex/es-inventory-merchant-production-ui-01-release"
const release = "refs/heads/release"
const previousDeployment = "dpl_AXvQyPsbGk3nXvARQG3GWLsKABBu"
const controlRef = 'refs/heads/codex/release-validator-control'
const context = "eshop/selective-release-validator"
const expectedOrigin = 'https://github.com/' + repository + '.git'
const approvedContent = {
  "app/components/InventoryEntry.tsx": "9b9d0286d378d25d98e39f2b99afd28be6c71bcd5644e5bd93048d61a652690f",
  "app/products/page.tsx": "c9979cd99885987f8580307d8f3f11e2a2852ff5a37bde26d0d4640e23241990",
  "tests/inventory-profit-ui.test.ts": "146389fdc9262cc5d08b72f5e77c61afac6d42a88f09247131030940ed913858"
}
const approvedPaths = [
  "app/components/InventoryEntry.tsx",
  "app/products/page.tsx",
  "tests/inventory-profit-ui.test.ts"
]
const trustedFiles = {
  "scripts/check-selective-release.sh": "21a2e097d8abee173abd4ca21304d5450a81429ce7ce54c4b31fcb5639d43b6d",
  "scripts/lib/release-provenance.mjs": "079e8031d4f2f2a57c153ac9b786eb2dc98a54090684f372a4eccaaab5693dc2",
  "scripts/guards/check-change-scope.js": "5081a836751f7bdcc0272e28e099e3a31ed9960b7a9254cb65c5108a1d502283",
  "docs/change-gates/gate-config.json": "0410ac1629d87ea99d4089ef38184617a657e866282c0cc5c5048ce607fabd9f",
  "vercel.json": "eb54ee01c62b86da2b1ac33d3f7126b0340b646abc9a553ee54c4470c2add7ba"
}
const evidenceDigests = {
  "SELECTIVE-RELEASE.APPROVED.json": "6355c0813bd27b0c729c18ba5412b6f8fa256f94117571a4de379e21f4ef0974",
  "founder-receipt.md": "a3d490be1f574b16566b2c38cb75abbe57def4c2b722135940f7d8660fe10ca8",
  "CORE-BASELINE-EXCEPTION.json": "94214b03594e6f4e05cee2a63b9e89cf6f6ed6fbc9443b20f3436eefa02bace5",
  "core-environment.json": "b60b518719f364bc3749e28e704fc463460328139e2fd3520381376e34bc06b1",
  "core-failure-set.json": "4ee15b4a29517609ac1532dd173d897cf4197a2e27a4306341c35fef158e3f54",
  "baseline-core.json": "f7ee56e06a18a379e7e45baae667d850c9f44ba67c365b5dbeae4ccec94ce508",
  "release-core.json": "ec60f6f3e46209f2510f55aff3d241741cc586df593b6971a1b68b4792da8070"
}

function command(program, args, cwd) {
  const env = {
    PATH: process.env.PATH,
    LC_ALL: 'C',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false',
  }
  return execFileSync(program, args, {cwd, encoding: 'utf8', timeout: 60_000,
    env, stdio: ['ignore', 'pipe', 'pipe']}).trim()
}
function git(...args) {
  return command('git', ['-c', 'core.fsmonitor=false', ...args], candidateWorktree)
}
function gitAt(cwd, ...args) {
  return command('git', ['-c', 'core.fsmonitor=false', ...args], cwd)
}
function assert(condition, message) {
  if (!condition) throw new Error(message)
}
function requireDigest(file, digest) {
  assert(createHash('sha256').update(readFileSync(file)).digest('hex') === digest,
    'Pinned evidence changed: ' + file)
}

function evidenceText(name) {
  const bytes = readFileSync(resolve(evidence, name))
  assert(createHash('sha256').update(bytes).digest('hex') === evidenceDigests[name],
    'Pinned evidence changed: ' + name)
  return bytes.toString('utf8')
}



function verifyLocal() {
  const controlHead = git('rev-parse','HEAD')
  assert(git('rev-parse','origin/main') === main && git('rev-parse','origin/release') === base &&
    git('rev-parse',candidate+'^{tree}') === approvedTree &&
    git('show','-s','--format=%P',candidate) === base &&
    git('status','--porcelain','--untracked-files=all') === '', 'Local sealed binding changed')
  if (process.argv[2] !== 'offline') {
    assert(process.env.GITHUB_REPOSITORY === repository && process.env.GITHUB_REF === controlRef &&
      process.env.GITHUB_SHA === controlHead, 'Not running from the protected control branch')
  }

  const paths = git('diff','--name-only',base,candidate).split('\n').sort()
  assert(JSON.stringify(paths) === JSON.stringify(approvedPaths), 'Unexpected release paths')
  for (const [path,digest] of Object.entries(trustedFiles)) requireDigest(resolve(candidateWorktree,path),digest)
  for (const [path,digest] of Object.entries(approvedContent)) requireDigest(resolve(candidateWorktree,path),digest)
  for (const name of Object.keys(evidenceDigests)) evidenceText(name)
  const record = JSON.parse(evidenceText('SELECTIVE-RELEASE.APPROVED.json'))
  const receipt = record.founderAuthorization
  assert(record.releaseSha === candidate && record.baseProductionSha === base && record.sourceMainSha === main &&
    JSON.stringify(record.includedSourceCommits) === JSON.stringify([main]) &&
    receipt?.approvedBy === 'Founder' && receipt?.status === 'APPROVED' &&
    receipt?.authorizedCandidateSha === candidate && receipt?.authorizedProductionSha === base &&
    receipt?.authorizationReceiptSha256 === evidenceDigests['founder-receipt.md'], 'Founder binding changed')
  const core = JSON.parse(evidenceText('CORE-BASELINE-EXCEPTION.json'))
  assert(core.baseline.sha === base && core.candidate.sha === candidate && core.candidate.tree === approvedTree &&
    core.raw_status === 'BLOCKED' && core.failures.length === 4 &&
    core.failures.every(x => x.attribution === 'baseline_reproduced' && Date.now() < Date.parse(x.expires_at)),
    'Bounded CORE evidence changed or expired')
  assert(core.failure_set_sha256 === evidenceDigests['core-failure-set.json'] &&
    core.environment_toolchain_config_sha256 === evidenceDigests['core-environment.json'], 'CORE evidence hashes changed')
  const baseline = JSON.parse(evidenceText('baseline-core.json'))
  const release = JSON.parse(evidenceText('release-core.json'))
  const failureSet = JSON.parse(evidenceText('core-failure-set.json'))
  assert(JSON.stringify(baseline.outcomes) === JSON.stringify(release.outcomes), 'CORE outcomes differ')
  for (const [run, sha] of [[baseline, base], [release, candidate]]) {
    assert(run.head === sha && run.status === 'BLOCKED' && run.counts.executed === 103 &&
      run.counts.passed === 99 && run.counts.failed === 4 && run.counts.skipped === 0 &&
      Object.keys(run.outcomes).length === 103, 'CORE outcome shape changed')
    const failed = Object.keys(run.outcomes).filter(path => run.outcomes[path][0] === 'FAIL')
    assert(JSON.stringify(failed) === JSON.stringify(core.failures.map(x => x.test_id)), 'CORE failure set changed')
  }
  assert(JSON.stringify(failureSet.map(x => [x.test_id,x.assertion])) ===
    JSON.stringify(core.failures.map(x => [x.test_id,x.assertion])), 'CORE assertions changed')
  const v = command('/bin/bash',['scripts/check-selective-release.sh','--record',
    resolve(evidence,'SELECTIVE-RELEASE.APPROVED.json'),'--production',base,'--trusted-ref','origin/main',
    '--release-ref',candidate],candidateWorktree)
  assert(v.startsWith('AUTHORIZED_SELECTIVE_RELEASE: PASS\n'), 'Selective release validator failed')
  const s = command(process.execPath,['scripts/guards/check-change-scope.js',
    '--files',approvedPaths.join(',')],candidateWorktree)
  assert(s.endsWith('\nPASS'), 'Scope Guard failed')
  const config = JSON.parse(readFileSync(resolve(candidateWorktree,'vercel.json'),'utf8'))
  const deployment = config.git?.deploymentEnabled
  assert(deployment?.['**'] === false && deployment?.main === false && deployment?.release === true &&
    Object.keys(deployment).length === 3, 'Nondeploy staging policy changed')
}

async function verifyPull(token) {
  // This authorized line uses exact fast-forwards, not a PR.
  const remote = await request('/repos/' + repository + '/commits/' + candidate, token)
  assert(remote.sha === candidate && remote.commit?.tree?.sha === approvedTree &&
    JSON.stringify(remote.parents?.map(p => p.sha)) === JSON.stringify([base]), 'GitHub staged object drifted')
}
function verifyLive(expectStaging) {
  const refs = git('ls-remote',expectedOrigin,'refs/heads/main',release,staging,controlRef).split('\n').sort()
  const expected = [candidate+'\t'+staging,main+'\trefs/heads/main',base+'\t'+release,
    git('rev-parse','HEAD')+'\t'+controlRef].sort()
  assert(expectStaging && JSON.stringify(refs) === JSON.stringify(expected), 'Remote exact control, staging, main or release drifted')
}

async function verifyRuleset(token) {
  const rule = await request('/repos/' + repository + '/rulesets/26426184', token)
  const checks = rule.rules?.find(item => item.type === 'required_status_checks')?.parameters?.required_status_checks
  // The public API omits bypass_actors. Bind the revision to the owner UI
  // verification of the empty bypass list before the preceding save.
  assert(rule.enforcement === 'active' && new Date(rule.updated_at).toISOString() === '2026-11-03T07:59:36.789Z' &&
    (rule.bypass_actors === undefined || rule.bypass_actors?.length === 0) &&
    JSON.stringify(rule.conditions?.ref_name?.include) === JSON.stringify([release]) &&
    (rule.conditions?.ref_name?.exclude?.length ?? 0) === 0 &&
    rule.rules.some(item => item.type === 'deletion') &&
    rule.rules.some(item => item.type === 'non_fast_forward') &&
    checks?.length === 1 && checks[0].context === context && checks[0].integration_id === appId,
    'Release protection or App binding differs from verified ruleset')
}

async function verify() {
  assert(process.argv.length === 3, 'No candidate or other overrides are accepted')
  const mode = process.argv[2]
  assert(['offline', 'preflight', 'publish', 'confirm'].includes(mode), 'Expected an explicit release gate operation')
  verifyLocal()
  if (mode === 'offline') {
    console.log(JSON.stringify({mode, candidate, tree: approvedTree, local: 'PASS'}))
    return
  }
  verifyLive(true)
  if (mode === 'preflight') {
    await verifyRuleset()
    await verifyPull()
    console.log(JSON.stringify({mode, candidate, tree: approvedTree, liveRefs: 'MATCH',
      productionDeployment: previousDeployment, productionState: 'READY'}))
    return
  }
  let key
  assert(process.env.ESHOP_RELEASE_VALIDATOR_PEM, 'Protected environment Secret is unavailable')
  const pem = Buffer.from(process.env.ESHOP_RELEASE_VALIDATOR_PEM)
  delete process.env.ESHOP_RELEASE_VALIDATOR_PEM
  try {
    key = createPrivateKey(pem)
  } catch {
    throw new Error('Expected the App private key on standard input')
  } finally {
    pem.fill(0)
  }
  const fingerprint = createHash('sha256').update(createPublicKey(key).export({type:'spki',format:'der'})).digest('base64')
  assert(fingerprint === 'yhwqkPtVSKmkg3q61U0dLzyUnqhtANv7C32L5q6t01c=', 'GitHub App key fingerprint mismatch')
  const now = Math.floor(Date.now() / 1000)
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const message = encode({ alg: 'RS256', typ: 'JWT' }) + '.' +
    encode({ iat: now - 60, exp: now + 300, iss: String(appId) })
  const jwt = message + '.' + sign('RSA-SHA256', Buffer.from(message), key).toString('base64url')
  const installationPath = '/app/installations/' + installationId
  const installation = await request(installationPath, jwt)
  const permissions = installation.permissions ?? {}
  if (installation.app_id !== appId || installation.id !== installationId ||
      installation.account?.login !== 'jasonmino-ops' || installation.suspended_at !== null ||
      installation.repository_selection !== 'selected' ||
      Object.keys(permissions).length !== 2 || permissions.metadata !== 'read' ||
      permissions.statuses !== 'write') {
    throw new Error('Installation identity, scope or permissions differ from the authorization')
  }

  // Query the full installation grant. Narrowing the token first would hide extra repositories.
  const { token } = await request(installationPath + '/access_tokens', jwt, 'POST')
  try {
    const { total_count, repositories } = await request('/installation/repositories?per_page=2', token)
    if (total_count !== 1 || repositories?.length !== 1 || repositories[0].full_name !== repository) {
      throw new Error('Installation does not grant access to exactly the authorized repository')
    }
    const control = await request('/repos/' + repository + '/rules/branches/codex%2Frelease-validator-control', token)
    const controlRules = control.filter(rule => rule.ruleset_source === repository)
    const expected = ['creation','update','deletion','non_fast_forward']
    const ids = new Set(controlRules.map(rule => rule.ruleset_id))
    assert(ids.size === 1 && expected.every(type => controlRules.some(rule => rule.type === type)),
      'Control branch write protection missing')
    const controlRuleset = await request('/repos/' + repository + '/rulesets/' + [...ids][0], token)
    assert(controlRuleset.enforcement === 'active' &&
      JSON.stringify(controlRuleset.conditions.ref_name.include) === JSON.stringify([controlRef]) &&
      (controlRuleset.conditions.ref_name.exclude?.length ?? 0) === 0, 'Unexpected control branch ruleset')
    await verifyRuleset(token)
    await verifyPull()
    const before = await request('/repos/' + repository + '/commits/' + candidate + '/statuses?per_page=30', token)
    if (mode === 'publish') {
      assert(!before.some(status => status.context === context),
        'Existing release validator status requires manual review')
    }
    if (mode === 'publish') {
      verifyLocal()
      verifyLive(true)
      await verifyRuleset(token)
      await verifyPull()
      const published = await request('/repos/' + repository + '/statuses/' + candidate, token, 'POST', {
        state: 'success', context, description: 'Pinned selective candidate and bounded evidence verified',
      })
      assert(Number.isSafeInteger(published.id) && published.state === 'success' && published.context === context &&
        published.creator?.login === 'e-shop-release-validator[bot]' && published.creator?.id === 351820557,
        'Status POST requires readback')
    }
    const statuses = await request('/repos/' + repository + '/commits/' + candidate + '/statuses?per_page=30', token)
    const appStatus = statuses.find(status => status.context === context &&
      status.creator?.login === 'e-shop-release-validator[bot]' && status.creator?.id === 351820557)
    assert(appStatus?.state === 'success' && Number.isSafeInteger(appStatus.id), 'Exact candidate lacks successful status from the dedicated App')
    process.stdout.write(JSON.stringify({sha: candidate, state: appStatus.state, context,
      creator: appStatus.creator.login, creatorId: appStatus.creator.id, statusId: appStatus.id}) + '\n')
  } finally {
    await request('/installation/token', token, 'DELETE')
  }
  process.stdout.write(JSON.stringify({ appId, installationId, repository, permissions, status: 'PASS' }) + '\n')
}

verify().catch((error) => {
  process.stderr.write('BLOCKED: ' + error.message + '\n')
  process.exitCode = 1
})

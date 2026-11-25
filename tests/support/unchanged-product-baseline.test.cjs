'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, dirname, resolve } = require('node:path')
const { execFileSync } = require('node:child_process')
const { BASELINE, readUnchangedProductBaseline } = require('./unchanged-product-baseline.cjs')

const source = process.env.ES_FROZEN_PROPOSAL_SOURCE || resolve(__dirname, '../..')
const OWN_OBSERVATION='docs/change-gates/evidence/ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01/observation.json'
const OTHER_OBSERVATION='docs/change-gates/evidence/ES-PRINT-DEVICE-TAKEOVER/observation.json'
const observation = taskId => JSON.stringify({recordType:'OBSERVATION_ONLY',taskId,observation:'isolated test fixture; no authorization effect'})+'\n'
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'es-frozen-inputs-'))
  execFileSync('git', ['clone', '--shared', '--quiet', '--no-checkout', source, dir])
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
  git('checkout', '--quiet', '--detach', BASELINE)
  git('update-ref', 'refs/remotes/origin/main', BASELINE)
  git('config', 'user.email', 'fixture@example.invalid')
  git('config', 'user.name', 'Isolated Fixture')
  return { dir, git, write(path, text) { mkdirSync(dirname(join(dir,path)), { recursive:true }); writeFileSync(join(dir,path), text) }, cleanup() { rmSync(dir, { recursive:true, force:true }) } }
}
function check(name, callback) {
  test(name, () => { const f=fixture(); try { callback(f) } finally { f.cleanup() } })
}
check('fixed product remains valid when unrelated documentary main and own record advance', f => {
  const before = readUnchangedProductBaseline(f.dir)
  assert.ok(before)
  f.write(OWN_OBSERVATION,observation('ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01'))
  f.git('add','.'); f.git('commit','--quiet','-m','documentary self registration')
  f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
  const own = readUnchangedProductBaseline(f.dir)
  assert.ok(own);assert.equal(own.cashierHash,before.cashierHash);assert.equal(own.recordsHash,before.recordsHash)
  f.write(OTHER_OBSERVATION,observation('ES-PRINT-DEVICE-TAKEOVER'))
  f.git('add','.'); f.git('commit','--quiet','-m','other task document')
  f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
  assert.ok(readUnchangedProductBaseline(f.dir))
})
check('runtime worktree and committed edits are never admitted', f => {
  const path='app/cashier/page.tsx';const original=readFileSync(join(f.dir,path))
  f.write(path,Buffer.concat([original,Buffer.from('\n// fixture unauthorized edit\n')]))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  f.git('add',path);f.git('commit','--quiet','-m','runtime mutation')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('restored worktree cannot conceal a staged runtime edit', f => {
  const path='app/records/page.tsx';const original=readFileSync(join(f.dir,path))
  f.write(path,Buffer.concat([original,Buffer.from('\n// staged mutation\n')]))
  f.git('add',path);f.write(path,original)
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('untracked runtime additions and mode changes are rejected', f => {
  f.write('lib/new-unauthorized-runtime.ts','export const bad=true\n')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  rmSync(join(f.dir,'lib/new-unauthorized-runtime.ts'))
  f.git('update-index','--chmod=+x','app/cashier/page.tsx')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('actual checkout runtime, KTF and Guard changes reject the fixed-input proof', f => {
  for(const path of ['app/cashier/page.tsx','docs/change-gates/gate-config.json','docs/change-gates/ES-PRINT-RC7-KNOWN-TEST-FAILURES.md']){
    f.git('reset','--hard',BASELINE)
    f.write(path,readFileSync(join(f.dir,path)).toString()+'\n')
    f.git('add',path);f.git('commit','--quiet','-m','non documentary change')
    f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
    assert.equal(readUnchangedProductBaseline(f.dir),null,path)
  }
})
check('rule and dependency changes reject the fixed-input proof', f => {
  for(const path of ['AGENTS.md','package-lock.json','docs/workflows/E_SHOP_FOUNDER_GATED_AGENT_DEVELOPMENT_WORKFLOW_V1.md']){
    f.git('reset','--hard',BASELINE)
    f.write(path,readFileSync(join(f.dir,path)).toString()+'\n')
    f.git('add',path);f.git('commit','--quiet','-m','authority/dependency change')
    f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
    assert.equal(readUnchangedProductBaseline(f.dir),null,path)
  }
})
check('history replacement and index concealment reject input proof', f => {
  f.git('update-index','--assume-unchanged','app/cashier/page.tsx')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  f.git('update-index','--no-assume-unchanged','app/cashier/page.tsx')
  f.git('replace',BASELINE,f.git('rev-parse',BASELINE+'^'))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('out-of-scope test/tool addition and documentary symlink fail closed', f => {
  f.write('tests/unrelated-assertion-edit.test.ts','// not authorized by this exact successor\n')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  rmSync(join(f.dir,'tests/unrelated-assertion-edit.test.ts'))
  mkdirSync(dirname(join(f.dir,OWN_OBSERVATION)),{recursive:true})
  symlinkSync(join(f.dir,'package.json'),join(f.dir,OWN_OBSERVATION))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})

check('actual checkout documentary mode, binary bytes and invalid JSON are rejected', f => {
  for(const value of [Buffer.from([0,1,2]),'{not-json']){
    f.git('reset','--hard',BASELINE)
    f.write(OWN_OBSERVATION,value)
    f.git('add','.');f.git('commit','--quiet','-m','invalid documentary payload')
    f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
    assert.equal(readUnchangedProductBaseline(f.dir),null)
  }
  f.git('reset','--hard',BASELINE)
  mkdirSync(dirname(join(f.dir,OWN_OBSERVATION)),{recursive:true})
  symlinkSync(join(f.dir,'package.json'),join(f.dir,OWN_OBSERVATION))
  f.git('add','.');f.git('commit','--quiet','-m','documentary symlink')
  f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('clean-filter configuration and info attributes cannot conceal changed runtime bytes', f => {
  const path='lib/cashier-realtime-client.ts'
  const original=readFileSync(join(f.dir,path))
  const external=mkdtempSync(join(tmpdir(),'es-filter-command-'))
  const marker=join(external,'unexpected-filter-execution')
  try {
    // Self-authored fixture only. Rejection must occur before this command runs.
    const program=join(external,'filter.cjs')
    writeFileSync(program,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');process.stdout.write(Buffer.from(${JSON.stringify(original.toString('base64'))},'base64'))`)
    f.git('config','filter.fixture.clean',`${JSON.stringify(process.execPath)} ${JSON.stringify(program)}`)
    writeFileSync(join(f.dir,'.git/info/attributes'),path+' filter=fixture\n')
    f.write(path,Buffer.concat([original,Buffer.from('\n// never executed\n')]))
    assert.equal(readUnchangedProductBaseline(f.dir),null)
    assert.equal(require('node:fs').existsSync(marker),false)
  } finally { rmSync(external,{recursive:true,force:true}) }
})
check('attributes override, include, partial clone and custom diff are unsupported', f => {
  const attributes=join(f.dir,'.git/fixture-attributes')
  writeFileSync(attributes,'lib/* -diff\n')
  f.git('config','core.attributesFile',attributes)
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  f.git('config','--unset','core.attributesFile')
  writeFileSync(join(f.dir,'.git/info/attributes'),'lib/* -diff\n')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  rmSync(join(f.dir,'.git/info/attributes'))
  for(const [key,value] of [['include.path',join(f.dir,'.git/fixture-include')],['extensions.partialclone','origin'],['remote.origin.promisor','true'],['diff.fixture.textconv','must-not-execute']]){
    writeFileSync(join(f.dir,'.git/fixture-include'),'[fixture]\nvalue=true\n')
    f.git('config',key,value)
    assert.equal(readUnchangedProductBaseline(f.dir),null,key)
    f.git('config','--unset',key)
  }
})
check('Git environment config injection is stripped and cannot mask runtime changes', f => {
  const previous={}
  const injected={GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.attributesFile',GIT_CONFIG_VALUE_0:join(f.dir,'.git/injected-attributes')}
  writeFileSync(injected.GIT_CONFIG_VALUE_0,'lib/* -diff\n')
  try {
    for(const [key,value] of Object.entries(injected)){previous[key]=process.env[key];process.env[key]=value}
    assert.ok(readUnchangedProductBaseline(f.dir),'environment-only Git configuration must not replace the isolated config')
    f.write('lib/cashier-realtime-client.ts','// isolated mutation, never imported\n')
    assert.equal(readUnchangedProductBaseline(f.dir),null)
  } finally { for(const key of Object.keys(injected)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]} }
})
check('raw file hashing rejects stat-cache concealment independently of diff visibility', f => {
  const path='lib/cashier-realtime-client.ts'
  const fs=require('node:fs')
  const original=fs.readFileSync(join(f.dir,path));const stat=fs.statSync(join(f.dir,path))
  f.git('config','core.trustctime','false');f.git('config','core.checkStat','minimal')
  f.git('status','--porcelain')
  const changed=Buffer.from(original);changed[0]=changed[0]===47?32:47
  f.write(path,changed);fs.utimesSync(join(f.dir,path),stat.atime,stat.mtime)
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('local excludes and core.excludesFile cannot hide new runtime or hidden files', f => {
  const fs=require('node:fs')
  f.write('app/api/hidden-fixture/route.ts','// isolated fixture, never executed\n')
  writeFileSync(join(f.dir,'.git/info/exclude'),'app/api/hidden-fixture/\n')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  fs.rmSync(join(f.dir,'app/api/hidden-fixture'),{recursive:true,force:true})
  f.write('lib/hidden-fixture.ts','// isolated fixture, never executed\n')
  const excludes=join(f.dir,'.git/fixture-excludes')
  writeFileSync(excludes,'lib/hidden-fixture.ts\n.runtime-fixture\n')
  f.git('config','core.excludesFile',excludes)
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  fs.rmSync(join(f.dir,'lib/hidden-fixture.ts'))
  f.write('.runtime-fixture','hidden source must not be called cache\n')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('only explicit root non-input caches are excluded from new-file enumeration', f => {
  for(const path of ['node_modules/fixture/index.js','.next/cache/fixture','.task-state/fixture.md']) f.write(path,'isolated cache\n')
  assert.ok(readUnchangedProductBaseline(f.dir))
  f.write('lib/.next/new-runtime.js','nested names are not root caches\n')
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('own grant, existing authorization and unlisted documentary records are rejected', f => {
  const fs=require('node:fs')
  const own='docs/change-gates/exceptions/ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01.json'
  f.write(own,JSON.stringify({approvedBy:'Founder',status:'ACTIVE'}))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  fs.rmSync(join(f.dir,own))
  const prior='docs/change-gates/exceptions/ES-POS-CHECKOUT-LATENCY-01.json'
  const bytes=readFileSync(join(f.dir,prior))
  f.write(prior,Buffer.concat([bytes,Buffer.from('\n')]))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  f.write(prior,bytes)
  f.write('docs/change-gates/evidence/unlisted-observation.json',observation('OTHER'))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})
check('actual checkout observation fixture cannot become a grant in worktree, index or HEAD', f => {
  const valid=observation('ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01')
  const grant=JSON.stringify({recordType:'OBSERVATION_ONLY',taskId:'ES-ENGINEERING-GOVERNANCE-EFFECTIVENESS-01',observation:'fixture',approvedBy:'Founder'})
  f.write(OWN_OBSERVATION,valid);f.git('add','.');f.git('commit','--quiet','-m','observation only')
  assert.ok(readUnchangedProductBaseline(f.dir))
  f.write(OWN_OBSERVATION,grant)
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  f.git('add',OWN_OBSERVATION);f.write(OWN_OBSERVATION,valid)
  assert.equal(readUnchangedProductBaseline(f.dir),null)
  f.write(OWN_OBSERVATION,grant);f.git('add','.');f.git('commit','--quiet','-m','not an observation')
  f.git('update-ref','refs/remotes/origin/main',f.git('rev-parse','HEAD'))
  assert.equal(readUnchangedProductBaseline(f.dir),null)
})

check('actual main833 to ff four-record advance leaves only the fixed local product fact', f => {
  const observed='ff1e8696860c2d9c2f3285d066d0cd56e1054691'
  const before=readUnchangedProductBaseline(f.dir)
  const paths=f.git('diff','--name-only',BASELINE,observed).split('\n').filter(Boolean)
  assert.equal(paths.length,4,'exact observed Diamond registration advance')
  f.git('update-ref','refs/remotes/origin/main',observed)
  const after=readUnchangedProductBaseline(f.dir)
  assert.ok(after)
  assert.equal(after.cashierHash,before.cashierHash)
  assert.equal(after.recordsHash,before.recordsHash)
  assert.equal(after.governanceHead,observed)
  assert.equal(after.productInputStatus,'UNCHANGED_PINNED_SNAPSHOT')
  assert.equal(after.governanceStatus,'NOT_ASSESSED')
  assert.equal(after.authorizationStatus,'NOT_ASSESSED')
})
check('a changed latest-main runtime cannot grant integration or alter the old local product fact', f => {
  f.write('lib/cashier-realtime-client.ts','// isolated new-main input, never executed\n')
  f.git('add','.');f.git('commit','--quiet','-m','new main product differs')
  const newer=f.git('rev-parse','HEAD')
  f.git('reset','--hard',BASELINE)
  f.git('update-ref','refs/remotes/origin/main',newer)
  const proof=readUnchangedProductBaseline(f.dir)
  assert.ok(proof)
  assert.equal(proof.baseline,BASELINE)
  assert.equal(proof.governanceHead,newer)
  assert.equal(proof.governanceStatus,'NOT_ASSESSED')
  assert.equal(proof.authorizationStatus,'NOT_ASSESSED')
  assert.equal(Object.hasOwn(proof,'integrationReady'),false)
  assert.equal(Object.hasOwn(proof,'approved'),false)
})

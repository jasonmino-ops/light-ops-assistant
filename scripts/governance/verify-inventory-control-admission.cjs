'use strict'

// Exact, engineering-only successor to the existing task-scoped B admission.
// Does not alter the default validator, old frozen assertions, App or release.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { gunzipSync } = require('node:zlib')
const TASK = 'ES-NATIVE-INVENTORY-AUTO-DEDUCTION-CONTROL-01'
const TREE = 'bf43fa367ea658d024d2cc8a7da07091076f523b'
const BASE = 'd1ffbaea3d01c219bfb45a99ea360c511f27cf36'
const REQUEST = 'ce9fa0d2d900a91f47c98f701b042a5695f6639db683c9524afc6803d6ee28a6'
const PATCH = '1b03533ff9f2657c960a0f0d5febf00b2a8311dae0bd145a27fafb00673cbe6f'
const RECORD = `docs/change-gates/${TASK}.json`
const SCOPE = `docs/change-gates/exceptions/${TASK}.json`
const FROZEN = `docs/freezes/${TASK}.json`
const EVIDENCE = `docs/change-gates/evidence/${TASK}/`
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const same = (a, b) => assert.deepEqual([...a].sort(), [...b].sort())
const canonical = value => Array.isArray(value) ? '['+value.map(canonical).join(', ')+']'
  : value && typeof value === 'object' ? '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+': '+canonical(value[k])).join(', ')+'}'
    : JSON.stringify(value)

function canonicalOrigin(url) {
  return ['git@github.com:jasonmino-ops/light-ops-assistant.git',
    'https://github.com/jasonmino-ops/light-ops-assistant.git',
    'https://github.com/jasonmino-ops/light-ops-assistant'].includes(url)
}
function candidateShape(tree, parents) {
  assert.equal(tree,TREE)
  assert.deepEqual(parents,[BASE],'Candidate must be one direct child of Production')
}
function normalizeDiagnostic(output) {
  return output.replace(/\x1b\[[0-9;]*m/g,'')
    .replaceAll('/private/tmp/es-inventory-control-production-candidate','<ROOT>')
    .replaceAll('/private/tmp/es-inventory-control-core-baseline','<ROOT>')
    .replace(/\(node:\d+\)/g,'(node:<PID>)').replace(/\d+(?:\.\d+)?ms/g,'<MS>')
    .replace(/duration_ms: [0-9.]+/g,'duration_ms: <MS>')
    .replace(/(duration_ms[: ]+)\d+(?:\.\d+)?/g,'$1<MS>').trim()
}
function verifyRecord(record, read, now = Date.now()) {
  assert.equal(record.taskId, TASK)
  assert.equal(record.status, 'APPROVED_ENGINEERING_ONLY')
  assert.equal(record.approvedBy, 'Founder')
  assert.equal(record.productionAuthorized, false)
  assert.equal(record.candidateTree, TREE)
  assert.equal(record.productionBase, BASE)
  assert.equal(record.sealedRequestSha256, REQUEST)
  assert.equal(record.sealedPatchSha256, PATCH)
  assert.equal(record.executorPath,'scripts/governance/verify-inventory-control-admission.cjs')
  assert.equal(sha(read(record.executorPath)),record.executorSha256)
  assert.equal(sha(read(record.executorTestPath)),record.executorTestSha256)
  assert.equal(record.scopePath, SCOPE)
  assert.equal(record.frozenPath, FROZEN)
  assert(Date.parse(record.issuedAt) <= now && now < Date.parse(record.expiresAt), 'Engineering disposition expired/not issued')
  for (const [name, digest] of Object.entries(record.evidenceSha256)) {
    assert(name.startsWith(EVIDENCE) && !name.split('/').includes('..'), 'Unexpected evidence path')
    assert.equal(sha(read(name)), digest, `Evidence changed: ${name}`)
  }
  const requestBytes = read(EVIDENCE + 'sealed-request.json')
  assert.equal(sha(requestBytes), REQUEST)
  const request = JSON.parse(requestBytes)
  assert.equal(request.candidateTree, TREE)
  assert.equal(request.productionBaseline, BASE)
  assert.equal(request.patchSha256, PATCH)
  assert.equal(request.paths.length, 11)
  assert.equal(new Set(request.paths.map(p => p.path)).size, 11)
  assert.equal(sha(read(SCOPE)), record.scopeSha256)
  assert.equal(sha(read(FROZEN)), record.frozenSha256)
  const scope = JSON.parse(read(SCOPE)), frozen = JSON.parse(read(FROZEN))
  assert.equal(scope.taskId, TASK)
  assert.equal(scope.status, 'ACTIVE')
  assert.equal(scope.approvedBy, 'Founder')
  assert.equal(scope.featureBranch, record.candidateBranch)
  assert.equal(scope.lineageMode, 'PRE_COMMIT_CONTENT_SHA256')
  same(scope.authorizedPaths, ['prisma/migrations/20261125120000_diamond_sales_control/migration.sql'])
  for (const p of scope.authorizedPaths) assert.equal(scope.authorizedPathSha256[p], request.paths.find(x => x.path === p).sha256)
  assert.equal(frozen.status, 'FOUNDER_APPROVED_ENGINEERING_ONLY_EXACT_SUCCESSOR')
  assert.equal(frozen.approvedBy, 'Founder')
  assert.equal(frozen.productionAuthorized, false)
  assert.equal(frozen.priorProduction, BASE)
  assert.equal(frozen.productTree, TREE)
  same(Object.keys(frozen.paths), request.frozenSuccessorPaths)
  for (const [name, hashes] of Object.entries(frozen.paths)) {
    const entry = request.paths.find(p => p.path === name)
    assert.equal(hashes.before, entry.beforeSha256)
    assert.equal(hashes.after, entry.sha256)
  }
  const authorityBytes = read(EVIDENCE + 'founder-authorization.md')
  assert.equal(sha(authorityBytes), frozen.sourceAuthorizationSha256)
  const authority = authorityBytes.toString()
  assert(authority.includes(TREE) && authority.includes('完成精确封存包的 Scope/Frozen 签认'))
  assert(authority.includes('等待正式生产发布授权'))
  const disposition = JSON.parse(read(EVIDENCE + 'core-disposition.json'))
  assert.equal(disposition.taskId, TASK)
  assert.equal(disposition.approvedBy, 'Founder')
  assert.equal(disposition.productionAuthorized, false)
  assert.equal(disposition.candidate.tree, TREE)
  assert.equal(disposition.baseline.sha, BASE)
  assert.equal(disposition.authorizationReceiptSha256, sha(authorityBytes))
  assert.equal(disposition.raw_status, 'BLOCKED')
  assert.deepEqual(disposition.raw_counts, { expected: 103, executed: 103, pass: 99, fail: 4, skip: 0 })
  assert.equal(disposition.failures.length, 7)
  assert.equal(new Set(disposition.failures.map(f => f.testId.split('.test.ts')[0])).size, 4)
  assert(now < Date.parse(disposition.expires_at))
  assert.equal(sha(Buffer.from(canonical(disposition.failures))),disposition.failure_set_sha256)
  assert.equal(sha(Buffer.from(canonical(disposition.environment))),disposition.environment_toolchain_config_sha256)
  assert.equal(disposition.comparison.length, 4)
  const rawCore=gunzipSync(read(EVIDENCE+'candidate-core.log.gz')).toString()
  for (const item of disposition.comparison) {
    assert.equal(item.baseline_exit, 1)
    assert.equal(item.candidate_exit, 1)
    assert(item.normalized_output_equal || item.identical_env_normalized_output_equal, 'Unproved baseline attribution')
    const start='TEST_START\t'+item.file+'\n', end='TEST_RESULT\tFAIL\t'+item.file
    assert.equal(rawCore.split(start).length,2)
    const candidateRaw=rawCore.split(start)[1].split(end)[0]
    assert(rawCore.includes(end))
    const baselineRaw=gunzipSync(read(EVIDENCE+path.basename(item.file,'.test.ts')+'.baseline.log.gz')).toString()
    assert.equal(sha(Buffer.from(candidateRaw)),item.candidate_sha256)
    assert.equal(sha(Buffer.from(baselineRaw)),item.baseline_sha256)
    if(item.normalized_output_equal) assert.equal(normalizeDiagnostic(candidateRaw),normalizeDiagnostic(baselineRaw))
    else {
      assert.equal(item.file,'tests/customer-order-recovery.test.ts')
      const c=gunzipSync(read(EVIDENCE+'candidate-customer-recovery-identical-env.log.gz'))
      const b=gunzipSync(read(EVIDENCE+'customer-recovery-identical-env.baseline.log.gz'))
      assert.equal(sha(c),item.candidate_identical_env_sha256)
      assert.equal(sha(b),item.baseline_identical_env_sha256)
      assert.equal(normalizeDiagnostic(c.toString()),normalizeDiagnostic(b.toString()))
    }
  }
  return { request, scope, frozen, disposition }
}

function productGit(root, ...args) {
  return execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
}
function verifyProduct(root, record, details, candidate, precommit = false) {
  const text = (...args) => productGit(root, ...args).toString().trim()
  const blob = (ref, file) => productGit(root, 'show', `${ref}:${file}`)
  assert(canonicalOrigin(text('remote', 'get-url', 'origin')), 'Noncanonical repository')
  const expected = details.request.paths.map(p => p.path)
  const candidateTree = candidate ? text('rev-parse', `${candidate}^{tree}`) : TREE
  assert.equal(candidateTree, TREE)
  same(text('diff-tree', '--no-commit-id', '--no-renames', '--name-only', '-r', BASE+'^{tree}', candidateTree).split('\n').filter(Boolean), expected)
  assert.equal(sha(productGit(root, 'diff', '--binary', BASE+'^{tree}', TREE)), PATCH)
  if (candidate) candidateShape(candidateTree,text('show','-s','--format=%P',candidate).split(' ').filter(Boolean))
  else assert.equal(text('rev-parse', 'HEAD'), BASE)
  for (const entry of details.request.paths) {
    assert(text('ls-tree', TREE, '--', entry.path).startsWith('100644 blob '), 'Only regular 100644 files')
    assert.equal(sha(blob(TREE, entry.path)), entry.sha256)
    if (entry.beforeSha256 !== null) assert.equal(sha(blob(BASE, entry.path)), entry.beforeSha256)
    else assert.equal(text('ls-tree',BASE,'--',entry.path),'')
    if (!candidate || text('rev-parse', candidate) === text('rev-parse', 'HEAD')) {
      const file = path.join(root, entry.path)
      assert(fs.lstatSync(file).isFile(), 'No symlink product paths')
      assert.equal(sha(fs.readFileSync(file)), entry.sha256, `Working bytes differ: ${entry.path}`)
    }
  }
  for (const [name, digest] of Object.entries(details.frozen.nonAffectedSafetyPathsSha256)) {
    assert.equal(sha(blob(BASE, name)), digest)
    assert.equal(sha(blob(TREE, name)), digest, `Safety surface changed: ${name}`)
  }
  if (precommit) {
    assert.equal(text('branch', '--show-current'), record.candidateBranch)
    assert.equal(text('write-tree'), TREE, 'Staged tree is not the approved product')
    const untracked = text('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean)
    assert(untracked.every(p => p === SCOPE), 'Unexpected untracked product path')
    assert.equal(text('diff', '--name-only'), '', 'Unstaged content exists')
  }
  if (candidate && text('rev-parse',candidate) === text('rev-parse','HEAD')) {
    assert.equal(text('diff','--name-only'),'','Unstaged tracked changes')
    assert.equal(text('diff','--cached','--name-only'),'','Staged changes after commit')
    assert(text('ls-files','--others','--exclude-standard').split('\n').filter(Boolean).every(p=>p===SCOPE),'Unexpected untracked path')
  }
  return true
}

function main(argv) {
  const value = name => { const index = argv.indexOf(name); return index < 0 ? undefined : argv[index+1] }
  const root = path.resolve(value('--root') || process.cwd())
  const registrationRoot = path.resolve(value('--registration-root') || process.cwd())
  const draft = argv.includes('--draft-integrity-only')
  const precommit = argv.includes('--precommit')
  const candidate = value('--candidate')
  if (!draft) {
    assert(precommit !== Boolean(candidate),'Choose exactly --precommit or --candidate')
    if (candidate) {
      assert(/^[0-9a-f]{40}$/.test(candidate),'Full Candidate Commit SHA required')
      assert.equal(productGit(root,'rev-parse','HEAD').toString().trim(),candidate,'Postcommit proof requires the exact Candidate checkout')
    }
  }
  for (const name of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_COMMON_DIR','GIT_NAMESPACE','GIT_GRAFT_FILE']) assert(!process.env[name], 'No Git authority overrides')
  let record, read
  if (draft) {
    read = name => fs.readFileSync(path.join(registrationRoot, name))
    record = JSON.parse(read(RECORD))
  } else {
    const text = (...a) => productGit(root, ...a).toString().trim()
    const trusted = text('rev-parse', 'origin/main')
    assert(canonicalOrigin(text('remote','get-url','origin')))
    const live = execFileSync('gh',['api','repos/jasonmino-ops/light-ops-assistant/git/ref/heads/main','--jq','.object.sha'],{encoding:'utf8',timeout:15000}).trim()
    assert.equal(trusted,live,'Trusted main must equal actual GitHub main')
    read = name => productGit(root,'show',trusted+':'+name)
    record = JSON.parse(read(RECORD))
    assert.equal(spawnSync('git',['-C',root,'merge-base','--is-ancestor',record.mainBefore,trusted]).status,0)
    const installed = productGit(root,'show',trusted+':scripts/governance/verify-inventory-control-admission.cjs')
    assert.equal(sha(fs.readFileSync(__filename)),sha(installed),'Executor is not the trusted installed successor')
  }
  const details = verifyRecord(record,read)
  verifyProduct(root,record,details,candidate,precommit)
  if (draft) {
    console.log('DRAFT INTEGRITY: PASS; trusted Scope/Frozen admission is NOT activated')
    return
  }
  const scopeFile = path.join(root,SCOPE), scopeBytes = read(SCOPE)
  const guard = 'scripts/guards/check-change-scope.js'
  for (const name of [guard,'docs/change-gates/gate-config.json']) {
    assert.equal(sha(fs.readFileSync(path.join(root,name))),sha(read(name)),'Guard/config must be trusted and unchanged')
    assert.equal(sha(productGit(root,'show',BASE+':'+name)),sha(read(name)),'This task cannot change Guard/config')
  }
  const missing = !fs.existsSync(scopeFile)
  if (missing) { fs.mkdirSync(path.dirname(scopeFile),{recursive:true}); fs.writeFileSync(scopeFile,scopeBytes,{flag:'wx'}); console.log('CONTROL COPY: trusted Scope file installed temporarily, excluded from product tree') }
  else assert.equal(sha(fs.readFileSync(scopeFile)),sha(scopeBytes))
  try {
    const output = execFileSync(process.execPath,[path.join(root,guard),'--task-id',TASK,'--files',details.request.paths.map(p=>p.path).join(',')],{cwd:root,encoding:'utf8'})
    assert(output.trim().endsWith('\nPASS'),'Actual Scope Guard must pass')
    console.log(output.trim())
  } finally { if (missing) fs.unlinkSync(scopeFile) }
  console.log('TASK FROZEN SUCCESSOR: PASS (exact engineering-only successor)')
  console.log(precommit ? 'TASK PRECOMMIT LINEAGE: PASS (sealed staged tree; Candidate Commit does not yet exist)' : 'TASK COMMIT LINEAGE: PASS (exact Production parent / sealed tree / 11 paths)')
  console.log('CORE DISPOSITION: ACCEPTED BASELINE NON-REGRESSION; RAW CORE REMAINS 99/103, FAIL/BLOCKED')
  console.log('PRODUCTION AUTHORIZED: NO; GitHub App production signing is not granted')
}
if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) { console.error('BLOCKED: '+error.message); process.exitCode=1 }
}
module.exports = { verifyRecord,verifyProduct,canonicalOrigin,candidateShape,TASK,RECORD,TREE,BASE }

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { inspectEvidenceReuse } from './check-governance-evidence-reuse.mjs'

const root = tmpdir()
const now = Date.parse('2026-11-26T00:00:00.000Z')
const sha = value => createHash('sha256').update(value).digest('hex')
const productPath = 'lib/product.ts'
const grantPath = 'docs/change-gates/exceptions/TASK.json'
const otherReceipt = 'docs/acceptance/OTHER Receipt.md'
const ownReceipt = 'docs/acceptance/TASK Acceptance Receipt.md'

function fixture(t, path = otherReceipt, contents = 'Other task evidence\n') {
  mkdirSync(root, { recursive: true })
  const dir = mkdtempSync(join(root, 'reuse-git-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], {
    cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim()
  const write = (path, bytes) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), bytes) }
  const commit = () => { git('add', '.'); git('commit', '-m', 'isolated fixture'); return git('rev-parse', 'HEAD') }
  git('init', '-q')
  write(productPath, 'export const protectedValue = 1\n')
  write(grantPath, '{"status":"ACTIVE","originalConsent":"exact immutable source"}\n')
  write('original-raw-failure.log', 'RAW FAIL / BLOCKED; later assertions NOT EXECUTED\n')
  const from = commit()
  write(path, contents)
  const to = commit()
  const input = {
    taskId: 'CURRENT-TASK',
    productSha: from, productTree: git('rev-parse', `${from}^{tree}`),
    observedProductSha: from, observedProductTree: git('rev-parse', `${from}^{tree}`),
    productionSha: from, observedProductionSha: from,
    governanceFrom: from, governanceTo: to,
    environmentSha256: sha('isolated environment'), observedEnvironmentSha256: sha('isolated environment'),
    productInputs: { [productPath]: sha(readFileSync(join(dir, productPath))) },
    authorityInputs: { [grantPath]: sha(readFileSync(join(dir, grantPath))) },
    documentaryPaths: [path], expiresAt: '2026-11-27T00:00:00.000Z',
    authorizationBinding: 'DOCUMENTARY_ADVANCE_DECLARED',
  }
  return { dir, git, write, commit, input, check: value => inspectEvidenceReuse(dir, value ?? input, now) }
}

test('unrelated documentary governance advance preserves fixed product evidence without issuing authority', t => {
  const f = fixture(t)
  const before = readFileSync(join(f.dir, 'original-raw-failure.log'))
  const result = f.check()
  assert.equal(result.evidenceStatus, 'UNCHANGED_INPUTS_REVIEW_GOVERNANCE')
  assert.equal(result.authorizationStatus, 'NOT_ASSESSED')
  assert.deepEqual(result.changedPaths, [otherReceipt])
  assert.doesNotMatch(JSON.stringify(result), /"(?:authorized|acceptance|corePass)"/i)
  assert.deepEqual(readFileSync(join(f.dir, 'original-raw-failure.log')), before)
  assert.equal(f.git('status', '--porcelain'), '')
})

test('explicit own receipt addition does not change product identity or original grant', t => {
  const f = fixture(t, ownReceipt)
  const input = { ...f.input, documentaryPaths: [], ownReceiptPath: ownReceipt }
  assert.equal(f.check(input).evidenceStatus, 'UNCHANGED_INPUTS_REVIEW_GOVERNANCE')
  assert.equal(f.git('diff', '--name-only', input.governanceFrom, input.governanceTo), ownReceipt)
})

test('exact old Governance Head consent never silently transfers even when evidence is unchanged', t => {
  const f = fixture(t)
  const result = f.check({ ...f.input, authorizationBinding: 'EXACT_GOVERNANCE_HEAD' })
  assert.equal(result.evidenceStatus, 'UNCHANGED_INPUTS')
  assert.equal(result.authorizationStatus, 'EXACT_REF_CHANGED_NO_TRANSFER')
})

for (const path of ['lib/product.ts', 'tests/payment.test.ts', 'AGENTS.md',
  'docs/workflows/Workflow.md', 'docs/governance/Level 0.md', 'scripts/guards/check-change-scope.js',
  'scripts/test/manifests/root-core-tests.json', 'docs/acceptance/Authorization.md']) {
  test(`an allowlist cannot reclassify protected or executable input ${path}`, t => {
    const f = fixture(t, path)
    assert.equal(f.check().evidenceStatus, 'NOT_REUSABLE')
  })
}

test('altering original authorization cannot be excused as documentary advancement', t => {
  const f = fixture(t)
  f.write(grantPath, '{"status":"REVOKED"}\n')
  const to = f.commit()
  const result = f.check({ ...f.input, governanceTo: to, documentaryPaths: [otherReceipt, grantPath] })
  assert.equal(result.evidenceStatus, 'NOT_REUSABLE')
})

test('exact declared other-task grants are governance evidence to review, never current task authority', t => {
  const path = 'docs/change-gates/exceptions/OTHER-TASK.json'
  const f = fixture(t, path, '{"taskId":"OTHER-TASK","status":"ACTIVE"}\n')
  const result = f.check()
  assert.equal(result.evidenceStatus, 'UNCHANGED_INPUTS_REVIEW_GOVERNANCE')
  assert.equal(result.authorizationStatus, 'NOT_ASSESSED')
  assert.equal(f.check({ ...f.input, taskId: 'OTHER-TASK' }).reason, 'OWN_AUTHORIZATION_CHANGED')
})

test('a forged task owner cannot disguise own grant as an unrelated task record', t => {
  const f = fixture(t, 'docs/change-gates/exceptions/OTHER-TASK.json', '{"taskId":"CURRENT-TASK"}')
  assert.equal(f.check().reason, 'TASK_RECORD_OWNER_MISMATCH')
})

for (const [name, change] of [
  ['product SHA', { observedProductSha: 'f'.repeat(40) }],
  ['product tree', { observedProductTree: 'f'.repeat(40) }],
  ['production', { observedProductionSha: 'f'.repeat(40) }],
  ['environment', { observedEnvironmentSha256: 'f'.repeat(64) }],
  ['missing product inputs', { productInputs: {} }],
  ['missing authority inputs', { authorityInputs: {} }],
  ['expired evidence', { expiresAt: '2026-11-25T23:59:59.000Z' }],
  ['invalid expiry', { expiresAt: 'unknown' }],
  ['missing hash', { productInputs: { [productPath]: null } }],
  ['wrong hash', { productInputs: { [productPath]: 'f'.repeat(64) } }],
  ['undeclared path', { documentaryPaths: [] }],
  ['duplicate paths', { documentaryPaths: [otherReceipt, otherReceipt] }],
]) {
  test(`${name} prevents evidence reuse`, t => {
    const f = fixture(t)
    assert.equal(f.check({ ...f.input, ...change }).evidenceStatus, 'NOT_REUSABLE')
  })
}

test('missing Git object and reversed ancestry fail closed', t => {
  const f = fixture(t)
  assert.equal(f.check({ ...f.input, governanceTo: 'f'.repeat(40) }).evidenceStatus, 'NOT_REUSABLE')
  assert.equal(f.check({ ...f.input, governanceFrom: f.input.governanceTo,
    governanceTo: f.input.governanceFrom }).evidenceStatus, 'NOT_REUSABLE')
})

test('a mode change, deletion, invalid JSON and binary document are not documentary reuse', t => {
  for (const [name, mutate] of [
    ['mode', f => f.git('update-index', '--chmod=+x', otherReceipt)],
    ['delete', f => f.git('rm', otherReceipt)],
  ]) {
    const f = fixture(t)
    mutate(f)
    f.git('commit', '-m', name)
    assert.equal(f.check({ ...f.input, governanceTo: f.git('rev-parse', 'HEAD') }).evidenceStatus, 'NOT_REUSABLE')
  }
  const json = fixture(t, 'docs/acceptance/OTHER Receipt.json', 'invalid-json')
  assert.equal(json.check().evidenceStatus, 'NOT_REUSABLE')
  const binary = fixture(t, otherReceipt, Buffer.from([65, 0, 66]))
  assert.equal(binary.check().evidenceStatus, 'NOT_REUSABLE')
})

test('CLI returns evidence-only output and blocks exact-ref consent transfer', t => {
  const f = fixture(t)
  const inputFile = join(f.dir, 'input.json')
  writeFileSync(inputFile, JSON.stringify({ ...f.input, expiresAt: '2999-01-01T00:00:00.000Z' }))
  const script = new URL('./check-governance-evidence-reuse.mjs', import.meta.url)
  const result = JSON.parse(execFileSync(process.execPath, [script.pathname, f.dir, inputFile], { encoding: 'utf8' }))
  assert.equal(result.authorizationStatus, 'NOT_ASSESSED')
  writeFileSync(inputFile, JSON.stringify({ ...f.input, expiresAt: '2999-01-01T00:00:00.000Z', authorizationBinding: 'EXACT_GOVERNANCE_HEAD' }))
  assert.throws(() => execFileSync(process.execPath, [script.pathname, f.dir, inputFile], { stdio: 'pipe' }),
    error => error.status === 2 && JSON.parse(error.stdout).authorizationStatus === 'EXACT_REF_CHANGED_NO_TRANSFER')
})

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { verify, verifyActivation, verifyClock, verifyRefReadback } from './es-elife-task-source-admission.mjs'

const checkout = process.env.SOURCE_TEST_CHECKOUT
const evidence = process.env.SOURCE_TEST_EVIDENCE
assert.ok(checkout && evidence, 'supply the exact sealed checkout and sealed evidence bundle')
const rule = JSON.parse(readFileSync(new URL('../../docs/change-gates/source-admission/ES-ELIFE-PRODUCT-CATALOG-FIX-01.json', import.meta.url)))
const script = fileURLToPath(new URL('./es-elife-task-source-admission.mjs', import.meta.url))
const governanceRepo = dirname(dirname(dirname(script)))
const at = Date.parse('2026-11-08T11:00:00Z')
const callGit = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()

test('exact evidence retains both blocked lane results', () => {
  assert.deepEqual(verify(checkout, evidence, at), {
    core: { passed: 101, failed: 2, skipped: 0, status: 'BLOCKED' },
    integration: { passed: 16, failed: 2, skipped: 0, status: 'BLOCKED' },
  })
})

test('draft CLI holds the exact candidate and cannot emit SOURCE PASS', () => {
  const run = spawnSync(process.execPath, [script, '--verify-draft', checkout, evidence], { encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  const output = JSON.parse(run.stdout)
  assert.equal(output.trustedMain, null)
  assert.equal(output.mode, 'DRAFT_VERIFIED')
  assert.equal(output.source, 'HOLD')
})

test('evidence window is fail closed at expiry and before the final run', () => {
  verifyClock(Date.parse(rule.expiresAt) - 1)
  assert.throws(() => verifyClock(Date.parse(rule.expiresAt)), /evidence window/)
  assert.throws(() => verifyClock(Date.parse('2026-11-08T00:00:00Z')), /evidence window/)
  assert.throws(() => verifyClock(NaN), /evidence window/)
})

test('another SHA cannot receive the sealed candidate result', () => {
  assert.throws(() => verify(governanceRepo, evidence, at), /sealed HEAD/)
})

const evidenceMutations = [
  ['additional failure in raw log', 'core-candidate-raw.log', path =>
    appendFileSync(path, '\nTEST_RESULT\tFAIL\ttests/new-regression.test.ts\texit=1\n'), /evidence SHA-256/],
  ['additional failing case in the same file', 'integration-candidate-raw.log', path =>
    writeFileSync(path, readFileSync(path, 'utf8').replace('ℹ fail 1', 'ℹ fail 2')), /evidence SHA-256/],
  ['changed assertion list', 'core-failures.json', path =>
    writeFileSync(path, readFileSync(path, 'utf8').replace('503', '504')), /evidence SHA-256/],
  ['raw status laundering', 'integration-candidate-summary.json', path =>
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll('BLOCKED', 'PASS')), /evidence SHA-256/],
  ['lost original baseline log', 'core-baseline-raw.log', path => rmSync(path), /evidence inventory/],
  ['substituted environment input', 'core-environment.json', path => appendFileSync(path, '\n'), /evidence SHA-256/],
  ['extra evidence file', 'unexpected.json', path => writeFileSync(path, '{}'), /evidence inventory/],
  ['browser evidence missing', 'catalog-browser-result.json', path => rmSync(path), /evidence inventory/],
  ['symlink substituted for exact bytes', 'core-failures.json', path => {
    rmSync(path)
    symlinkSync(join(evidence, 'core-failures.json'), path)
  }, /regular evidence file/],
]
for (const [name, file, mutate, message] of evidenceMutations) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), 'source-rule-negative-'))
    try {
      cpSync(evidence, dir, { recursive: true })
      mutate(join(dir, file))
      assert.throws(() => verify(checkout, dir, at), message)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
}

test('candidate ref readback rejects drift, missing refs and ambiguous records', () => {
  const rows = [
    `${rule.base}\trefs/heads/main`,
    `${rule.releaseBase}\trefs/heads/release`,
    `${rule.candidate}\trefs/pull/45/head`,
  ]
  assert.deepEqual(verifyRefReadback(rows.join('\n')), [rule.base, rule.releaseBase])
  assert.throws(() => verifyRefReadback(rows.slice(0, 2).join('\n')), /exact GitHub refs/)
  assert.throws(() => verifyRefReadback([rows[0], rows[1], rows[0]].join('\n')), /exact GitHub ref names/)
  rows[2] = `${rule.product}\trefs/pull/45/head`
  assert.throws(() => verifyRefReadback(rows.join('\n')), /candidate ref drift/)
})

test('unchanged trusted main, ref drift and wrong ancestry fail closed', () => {
  assert.throws(() => verifyActivation(checkout, rule.base, rule.releaseBase), /has not entered/)
  assert.throws(() => verifyActivation(checkout, rule.base, rule.candidate), /release base drift/)
  assert.throws(() => verifyActivation(checkout, rule.product, rule.releaseBase), /merge-base/)
  assert.throws(() => verifyActivation(checkout, rule.candidate, rule.releaseBase), /exact path delta/)
})

test('exact committed governance shape validates locally; mutated and extra paths fail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'source-rule-adoption-'))
  try {
    const localHead = callGit(governanceRepo, 'rev-parse', 'HEAD')
    assert.notEqual(localHead, rule.base, 'run this test after sealing the local governance commit')
    assert.equal(verifyActivation(governanceRepo, localHead, rule.releaseBase), localHead)
    callGit(dir, 'clone', '--shared', '--quiet', '--no-checkout', governanceRepo, '.')
    callGit(dir, 'checkout', '--detach', rule.base)
    callGit(dir, '-c', 'user.email=source-rule-test@example.invalid', '-c', 'user.name=Local Test',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', '-m', 'Synthetic adoption', localHead)
    const merge = callGit(dir, 'rev-parse', 'HEAD')
    assert.equal(verifyActivation(dir, merge, rule.releaseBase), merge)
    callGit(dir, 'checkout', '--detach', localHead)
    const commit = () => {
      callGit(dir, 'add', '--all')
      callGit(dir, '-c', 'user.email=source-rule-test@example.invalid', '-c', 'user.name=Local Test',
        '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Synthetic negative')
      return callGit(dir, 'rev-parse', 'HEAD')
    }
    appendFileSync(join(dir, 'scripts/governance/es-elife-task-source-admission.mjs'), '\n// changed\n')
    assert.throws(() => verifyActivation(dir, commit(), rule.releaseBase), /trusted evaluator bytes/)
    callGit(dir, 'checkout', '--detach', localHead)
    callGit(dir, '-c', 'user.email=source-rule-test@example.invalid', '-c', 'user.name=Local Test',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'Unrelated history')
    assert.throws(() => verifyActivation(dir, callGit(dir, 'rev-parse', 'HEAD'), rule.releaseBase), /adoption parents/)
    callGit(dir, 'checkout', '--detach', localHead)
    writeFileSync(join(dir, 'unexpected.txt'), 'extra path')
    assert.throws(() => verifyActivation(dir, commit(), rule.releaseBase), /exact path delta/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

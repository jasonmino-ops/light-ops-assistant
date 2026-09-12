import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  discoverRootTests,
  detectEnvironmentFailure,
  evaluateSuite,
  parseBaselineTestManifest,
  parseKnownFailureBaseline,
  renderStructuredSummary,
} from './run-root-full-suite.mjs'

const known = [{
  id: 'KTF-TEST-01',
  file: 'tests/b.test.ts',
  failureIdentity: 'known assertion',
  failureFingerprints: ['EXPECTED_VALUE', 'ACTUAL_VALUE'],
}]
const files = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.cjs']

function outcome(file, status, overrides = {}) {
  return {
    file,
    status,
    exitStatus: status === 'PASS' ? 0 : status === 'FAIL' ? 1 : null,
    signal: null,
    error: status === 'RUNNER_ERROR' ? 'synthetic launch failure' : null,
    classification: 'TEST',
    observedOutput: file === 'tests/b.test.ts' && status === 'FAIL'
      ? 'known assertion EXPECTED_VALUE ACTUAL_VALUE'
      : 'synthetic failure',
    ...overrides,
  }
}

function evaluate(overrides = {}) {
  return evaluateSuite({
    expected: 3,
    expectedFiles: files,
    collectedFiles: files,
    results: [outcome(files[0], 'PASS'), outcome(files[1], 'FAIL'), outcome(files[2], 'PASS')],
    knownFailures: known,
    metadata: { runIdentity: 'fixed-run', headSha: '0123456789abcdef' },
    ...overrides,
  })
}

test('baseline expected equals collection and unchanged known failures remain explicit', () => {
  const summary = evaluate()
  assert.equal(summary.counts.expected, 3)
  assert.equal(summary.counts.collected, 3)
  assert.equal(summary.counts.executed, 3)
  assert.equal(summary.counts.knownFailures, 1)
  assert.equal(summary.counts.newFailures, 0)
  assert.equal(summary.testEnvironmentHealth, 'PASS')
  assert.equal(summary.overallStatus, 'PASS')
  assert.equal(summary.exitCode, 0)
})

test('a new test failure blocks with the test-failure exit code', () => {
  const summary = evaluate({
    results: [outcome(files[0], 'FAIL'), outcome(files[1], 'FAIL'), outcome(files[2], 'PASS')],
  })
  assert.equal(summary.counts.newFailures, 1)
  assert.deepEqual(summary.files.newFailures, [
    { file: 'tests/a.test.ts', reason: 'NOT_IN_ACTIVE_BASELINE' },
  ])
  assert.equal(summary.testEnvironmentHealth, 'PASS')
  assert.equal(summary.overallStatus, 'BLOCKED')
  assert.equal(summary.exitCode, 1)
  assert.ok(summary.blockingReasons.some(({ category }) => category === 'TEST_FAILURE'))
})

test('a recovered known failure is listed without mutating the baseline', () => {
  const summary = evaluate({
    results: files.map((file) => outcome(file, 'PASS')),
  })
  assert.deepEqual(summary.files.recoveredFailures, known)
  assert.equal(summary.counts.knownFailures, 0)
  assert.equal(summary.overallStatus, 'PASS')
  assert.equal(summary.exitCode, 0)
})

test('a baseline test disappearing from collection blocks environment health', () => {
  const collectedFiles = files.slice(0, 2)
  const summary = evaluate({
    collectedFiles,
    results: [outcome(files[0], 'PASS'), outcome(files[1], 'FAIL')],
  })
  assert.equal(summary.counts.uncollected, 1)
  assert.equal(summary.testEnvironmentHealth, 'BLOCKED')
  assert.equal(summary.exitCode, 2)
  assert.ok(summary.environmentReasons.some(({ code }) => code === 'COLLECTION_COUNT_MISMATCH'))
})

test('materially low collection is a distinct environment blocker', () => {
  const collectedFiles = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts']
  const summary = evaluateSuite({
    expected: 10,
    expectedFiles: Array.from({ length: 10 }, (_, index) => `tests/${index}.test.ts`),
    collectedFiles,
    results: collectedFiles.map((file) => outcome(file, 'PASS')),
    knownFailures: [],
  })
  assert.equal(summary.testEnvironmentHealth, 'BLOCKED')
  assert.ok(summary.environmentReasons.some(({ code }) => code === 'COLLECTION_MATERIALLY_LOW'))
  assert.equal(summary.exitCode, 2)
})

test('runner failure is not reported as a test failure', () => {
  const summary = evaluate({
    results: [outcome(files[0], 'PASS'), outcome(files[1], 'RUNNER_ERROR'), outcome(files[2], 'PASS')],
  })
  assert.equal(summary.counts.failed, 0)
  assert.equal(summary.counts.executed, 2)
  assert.equal(summary.counts.skipped, 1)
  assert.equal(summary.testEnvironmentHealth, 'BLOCKED')
  assert.equal(summary.exitCode, 2)
  assert.ok(summary.environmentReasons.some(({ code }) => code === 'RUNNER_ERROR'))
})

test('test process configuration failure blocks environment health without becoming a new failure', () => {
  const summary = evaluate({
    results: [
      outcome(files[0], 'PASS'),
      outcome(files[1], 'FAIL', {
        classification: 'ENVIRONMENT',
        environmentCode: 'MISSING_REQUIRED_CONFIGURATION',
      }),
      outcome(files[2], 'PASS'),
    ],
  })
  assert.equal(summary.counts.failed, 1)
  assert.equal(summary.counts.environmentFailures, 1)
  assert.equal(summary.counts.newFailures, 0)
  assert.equal(summary.testEnvironmentHealth, 'BLOCKED')
  assert.equal(summary.exitCode, 2)
})

test('a different failure in a known-failing file remains a new failure', () => {
  const summary = evaluate({
    results: [
      outcome(files[0], 'PASS'),
      outcome(files[1], 'FAIL', { observedOutput: 'a different assertion failed' }),
      outcome(files[2], 'PASS'),
    ],
  })
  assert.equal(summary.counts.knownFailures, 0)
  assert.deepEqual(summary.files.newFailures, [
    { file: 'tests/b.test.ts', reason: 'KNOWN_FAILURE_IDENTITY_MISMATCH' },
  ])
  assert.equal(summary.exitCode, 1)
})

test('same known case with a changed failure shape remains a new failure', () => {
  const summary = evaluate({
    results: [
      outcome(files[0], 'PASS'),
      outcome(files[1], 'FAIL', { observedOutput: 'known assertion AUTHORIZED DENIED' }),
      outcome(files[2], 'PASS'),
    ],
  })
  assert.equal(summary.counts.knownFailures, 0)
  assert.deepEqual(summary.files.newFailures, [
    { file: 'tests/b.test.ts', reason: 'KNOWN_FAILURE_IDENTITY_MISMATCH' },
  ])
  assert.equal(summary.exitCode, 1)
})

test('known failure missing from collection is not classified as recovered', () => {
  const collectedFiles = ['tests/a.test.ts', 'tests/c.test.cjs']
  const summary = evaluate({
    collectedFiles,
    results: collectedFiles.map((file) => outcome(file, 'PASS')),
  })
  assert.equal(summary.counts.recoveredFailures, 0)
  assert.deepEqual(summary.files.missingKnownFailures, known)
  assert.equal(summary.testEnvironmentHealth, 'BLOCKED')
  assert.ok(summary.environmentReasons.some(({ code }) => code === 'KNOWN_FAILURE_NOT_COLLECTED'))
})

test('structured output is deterministic for fixed inputs', () => {
  const first = renderStructuredSummary(evaluate())
  const second = renderStructuredSummary(evaluate({ collectedFiles: [...files].reverse() }))
  assert.equal(first, second)
})

test('same-count replacement cannot hide a missing baseline test', () => {
  const collectedFiles = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/replacement.test.ts']
  const summary = evaluate({
    collectedFiles,
    results: [
      outcome('tests/a.test.ts', 'PASS'),
      outcome('tests/b.test.ts', 'FAIL'),
      outcome('tests/replacement.test.ts', 'PASS'),
    ],
  })
  assert.equal(summary.counts.collected, 3)
  assert.deepEqual(summary.files.uncollected, ['tests/c.test.cjs'])
  assert.deepEqual(summary.files.unexpectedCollected, ['tests/replacement.test.ts'])
  assert.equal(summary.testEnvironmentHealth, 'BLOCKED')
  assert.equal(summary.exitCode, 2)
})

test('ordinary is-required assertion is not hidden as an environment failure', () => {
  assert.equal(
    detectEnvironmentFailure('tests/a.test.ts', 'AssertionError: ORDER_ID is required', []),
    null,
  )
  assert.deepEqual(
    detectEnvironmentFailure(
      'tests/a.test.ts',
      'Error: DESKTOP_ACTIVATION_TEST_DATABASE=1 is required for real database tests',
      [],
    ),
    {
      code: 'MISSING_REQUIRED_CONFIGURATION',
      fingerprint: 'Error: DESKTOP_ACTIVATION_TEST_DATABASE=1 is required',
    },
  )
})

test('Markdown remains the single source of truth for expected and active known failures', () => {
  const markdown = `
- 全量口径：仓库根 tests，顺序执行，共 3 个测试文件。

| 编号 | 测试文件 + 用例名 | 失败形态 |
| --- | --- | --- |
| KTF-TEST-01 | \`tests/b.test.ts\` — \`known assertion\` | expected \`EXPECTED_VALUE\`, got \`ACTUAL_VALUE\` |
| KTF-OLD-02 | \`tests/old.test.ts\` — case | assertion |

## 当前仍为已知失败

- \`KTF-TEST-01\`：still active.

## 疑似真实回归

- 原始完整日志稳定位置：\`docs/evidence/root.log\`
- 原始完整日志 SHA-256：\`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`
`
  assert.deepEqual(parseKnownFailureBaseline(markdown), {
    expected: 3,
    knownFailures: known,
    environmentFingerprints: [],
    baselineEvidence: {
      path: 'docs/evidence/root.log',
      sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  })
})

test('baseline raw evidence provides an exact complete manifest', () => {
  const rawLog = [
    'SUITE_START\troot-top-level\tfiles=2\thead=abc',
    'TEST_START\ttests/b.test.ts',
    'TEST_RESULT\tFAIL\ttests/b.test.ts\texit=1',
    'TEST_START\ttests/a.test.cjs',
    'TEST_RESULT\tPASS\ttests/a.test.cjs\texit=0',
    'SUITE_SUMMARY\troot-top-level\tpass=1\tfail=1\ttotal=2',
    '',
  ].join('\n')
  assert.deepEqual(parseBaselineTestManifest(rawLog), ['tests/a.test.cjs', 'tests/b.test.ts'])
})

test('root discovery is immediate-only, extension-bounded, and stably sorted', () => {
  const repoRoot = mkdtempSync(resolve(tmpdir(), 'root-full-suite-'))
  const testsDir = resolve(repoRoot, 'tests')
  mkdirSync(resolve(testsDir, 'smoke'), { recursive: true })
  for (const file of ['z.test.ts', 'a.test.cjs', 'ignored.spec.ts', 'notes.txt']) {
    writeFileSync(resolve(testsDir, file), '')
  }
  writeFileSync(resolve(testsDir, 'smoke', 'nested.test.ts'), '')

  assert.deepEqual(discoverRootTests({ repoRoot }), ['tests/a.test.cjs', 'tests/z.test.ts'])
})

test('repository baseline and root-suite count agree', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const baseline = parseKnownFailureBaseline(
    readFileSync(resolve(repoRoot, 'docs/change-gates/ES-PRINT-RC7-KNOWN-TEST-FAILURES.md'), 'utf8'),
  )
  assert.equal(baseline.expected, 82)
  const evidence = readFileSync(resolve(repoRoot, baseline.baselineEvidence.path), 'utf8')
  const expectedFiles = parseBaselineTestManifest(evidence)
  assert.deepEqual(discoverRootTests({ repoRoot }), expectedFiles)
  assert.equal(baseline.knownFailures.length, 3)
})

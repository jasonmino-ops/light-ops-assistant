#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MIN_COLLECTION_RATIO = 0.9
export const DEFAULT_BASELINE_PATH = 'docs/change-gates/ES-PRINT-RC7-KNOWN-TEST-FAILURES.md'

const ROOT_SUITE_NAME = 'root-top-level'
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_REPO_ROOT = resolve(SCRIPT_DIR, '..', '..')

function toPosix(value) {
  return value.split(sep).join('/')
}

function stableSort(values) {
  return [...values].sort((left, right) => left.localeCompare(right, 'en'))
}

function unique(values) {
  return [...new Set(values)]
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

export function discoverRootTests({ repoRoot = DEFAULT_REPO_ROOT, testsDir = 'tests' } = {}) {
  const absoluteTestsDir = isAbsolute(testsDir) ? testsDir : resolve(repoRoot, testsDir)
  const prefix = toPosix(relative(repoRoot, absoluteTestsDir))

  return stableSort(
    readdirSync(absoluteTestsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.test\.(?:ts|cjs)$/.test(entry.name))
      .map((entry) => `${prefix}/${entry.name}`),
  )
}

export function parseKnownFailureBaseline(markdown) {
  const expectedMatch = markdown.match(/共\s*(\d+)\s*个测试文件/)
  if (!expectedMatch) {
    throw new Error('Known Failure Baseline does not declare the expected test-file count')
  }

  const tableEntries = new Map()
  const environmentFingerprints = []
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*KTF-/.test(line)) continue
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim())
    const [id, identityCell, failureShape, attribution] = cells
    const fileMatch = identityCell?.match(/`(tests\/[^`]+\.test\.(?:ts|cjs))`/)
    if (!fileMatch) {
      throw new Error(`Known failure ${id} has no root test-file identity`)
    }
    const identityTokens = [...identityCell.matchAll(/`([^`]+)`/g)].map((match) => match[1])
    const failureIdentity = identityTokens.find((token) => token !== fileMatch[1]) ?? null
    const failureFingerprints = [...failureShape.matchAll(/`([^`]+)`/g)].map((match) => match[1])
    tableEntries.set(id, { file: fileMatch[1], failureIdentity, failureFingerprints })

    if (attribution === '环境问题') {
      const fingerprint = [...failureShape.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1])
        .find((token) => /(?:ERR_CONNECTION_REFUSED|ECONNREFUSED|\bis required\b|\bare required\b)/.test(token))
      if (fingerprint) environmentFingerprints.push({ id, file: fileMatch[1], fingerprint })
    }
  }

  const activeSection = markdown.match(/## 当前仍为已知失败\s*\n([\s\S]*?)(?=\n##\s|\s*$)/)
  if (!activeSection) {
    throw new Error('Known Failure Baseline has no active-known-failures section')
  }

  const activeIds = unique(
    [...activeSection[1].matchAll(/`(KTF-[^`]+)`/g)].map((match) => match[1]),
  )
  const knownFailures = activeIds.map((id) => {
    const entry = tableEntries.get(id)
    if (!entry) throw new Error(`Active known failure ${id} has no matching baseline table row`)
    if (!entry.failureIdentity) {
      throw new Error(`Active known failure ${id} has no machine-checkable failure identity`)
    }
    if (entry.failureFingerprints.length === 0) {
      throw new Error(`Active known failure ${id} has no machine-checkable failure-shape fingerprint`)
    }
    return { id, ...entry }
  })

  if (new Set(knownFailures.map(({ file }) => file)).size !== knownFailures.length) {
    throw new Error('Active known failures must have unique root test-file identities')
  }

  const evidencePathMatch = markdown.match(/原始完整日志稳定位置：`([^`]+)`/)
  const evidenceHashMatch = markdown.match(/原始完整日志 SHA-256：`([a-f0-9]{64})`/)
  if (!evidencePathMatch || !evidenceHashMatch) {
    throw new Error('Known Failure Baseline has no stable root-suite evidence path/hash')
  }

  return {
    expected: Number(expectedMatch[1]),
    knownFailures: knownFailures.sort((left, right) => left.id.localeCompare(right.id, 'en')),
    environmentFingerprints: environmentFingerprints.sort((left, right) => left.id.localeCompare(right.id, 'en')),
    baselineEvidence: {
      path: evidencePathMatch[1],
      sha256: evidenceHashMatch[1],
    },
  }
}

export function parseBaselineTestManifest(rawLog) {
  const declaredCount = Number(rawLog.match(/^SUITE_START\t[^\n]*\tfiles=(\d+)/m)?.[1])
  const files = [...rawLog.matchAll(/^TEST_START\t([^\r\n]+)$/gm)].map((match) => match[1])
  const resultFiles = [...rawLog.matchAll(/^TEST_RESULT\t(?:PASS|FAIL)\t([^\t\r\n]+)/gm)].map(
    (match) => match[1],
  )
  if (!Number.isInteger(declaredCount) || declaredCount < 1) {
    throw new Error('Baseline root-suite evidence has no valid SUITE_START file count')
  }
  if (files.length !== declaredCount || new Set(files).size !== files.length) {
    throw new Error('Baseline root-suite evidence TEST_START manifest is incomplete or duplicated')
  }
  if (resultFiles.length !== files.length || new Set(resultFiles).size !== resultFiles.length) {
    throw new Error('Baseline root-suite evidence TEST_RESULT manifest is incomplete or duplicated')
  }
  const started = stableSort(files)
  const completed = stableSort(resultFiles)
  if (started.some((file, index) => file !== completed[index])) {
    throw new Error('Baseline root-suite evidence start/result manifests differ')
  }
  return started
}

function resultByFile(results) {
  const map = new Map()
  for (const result of results) {
    if (map.has(result.file)) throw new Error(`Duplicate result for ${result.file}`)
    map.set(result.file, result)
  }
  return map
}

function environmentReason(code, message) {
  return { category: 'ENVIRONMENT', code, message }
}

export function evaluateSuite({
  expected,
  expectedFiles,
  collectedFiles,
  results,
  knownFailures,
  runnerErrors = [],
  metadata = {},
}) {
  const expectedManifest = stableSort(unique(expectedFiles))
  if (expectedManifest.length !== expected || expectedManifest.length !== expectedFiles.length) {
    throw new Error('Expected test-file manifest must be unique and match the baseline count')
  }
  const collected = stableSort(unique(collectedFiles))
  if (collected.length !== collectedFiles.length) {
    throw new Error('Collected test-file identities must be unique')
  }

  const known = [...knownFailures].sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const knownByFile = new Map(known.map((entry) => [entry.file, entry]))
  const expectedSet = new Set(expectedManifest)
  const collectedSet = new Set(collected)
  const missingExpectedFiles = expectedManifest.filter((file) => !collectedSet.has(file))
  const unexpectedCollectedFiles = collected.filter((file) => !expectedSet.has(file))
  const outcomes = resultByFile(results)
  const unexpectedResults = stableSort([...outcomes.keys()].filter((file) => !collected.includes(file)))
  if (unexpectedResults.length > 0) {
    throw new Error(`Results exist for uncollected files: ${unexpectedResults.join(', ')}`)
  }

  const completed = results.filter((result) => result.status === 'PASS' || result.status === 'FAIL')
  const passed = stableSort(completed.filter((result) => result.status === 'PASS').map(({ file }) => file))
  const failedResults = completed.filter((result) => result.status === 'FAIL')
  const failures = stableSort(failedResults.map(({ file }) => file))
  const environmentFailureResults = failedResults.filter((result) => result.classification === 'ENVIRONMENT')
  const testFailureResults = failedResults.filter((result) => result.classification !== 'ENVIRONMENT')
  const knownStillFailing = testFailureResults
    .filter((result) => {
      const knownEntry = knownByFile.get(result.file)
      return knownEntry &&
        result.observedOutput?.includes(knownEntry.failureIdentity) &&
        knownEntry.failureFingerprints.every((fingerprint) => result.observedOutput.includes(fingerprint))
    })
    .map((result) => knownByFile.get(result.file))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))
  const knownStillFailingFiles = new Set(knownStillFailing.map(({ file }) => file))
  const newFailures = testFailureResults
    .filter((result) => !knownStillFailingFiles.has(result.file))
    .map((result) => ({
      file: result.file,
      reason: knownByFile.has(result.file) ? 'KNOWN_FAILURE_IDENTITY_MISMATCH' : 'NOT_IN_ACTIVE_BASELINE',
    }))
    .sort((left, right) => left.file.localeCompare(right.file, 'en'))
  const recoveredFailures = known.filter(({ file }) => outcomes.get(file)?.status === 'PASS')
  const missingKnownFailures = known.filter(({ file }) => !collectedSet.has(file))
  const incompleteKnownFailures = known.filter(
    ({ file }) => collectedSet.has(file) && !['PASS', 'FAIL'].includes(outcomes.get(file)?.status),
  )
  const skipped = collected.filter((file) => !['PASS', 'FAIL'].includes(outcomes.get(file)?.status))
  const uncollected = missingExpectedFiles.length
  const minimumCompleteCount = Math.ceil(expected * MIN_COLLECTION_RATIO)
  const environmentReasons = []

  if (collected.length !== expected) {
    environmentReasons.push(
      environmentReason(
        'COLLECTION_COUNT_MISMATCH',
        `expected ${expected} root test files but collected ${collected.length}`,
      ),
    )
  }
  if (missingExpectedFiles.length > 0 || unexpectedCollectedFiles.length > 0) {
    environmentReasons.push(
      environmentReason(
        'COLLECTION_MANIFEST_MISMATCH',
        `missing baseline files: ${missingExpectedFiles.join(', ') || 'NONE'}; ` +
          `unexpected collected files: ${unexpectedCollectedFiles.join(', ') || 'NONE'}`,
      ),
    )
  }
  if (collected.length < minimumCompleteCount) {
    environmentReasons.push(
      environmentReason(
        'COLLECTION_MATERIALLY_LOW',
        `collected ${collected.length}; minimum complete count is ${minimumCompleteCount}`,
      ),
    )
  }
  if (completed.length !== collected.length) {
    environmentReasons.push(
      environmentReason(
        'EXECUTION_INCOMPLETE',
        `collected ${collected.length} root test files but completed ${completed.length}`,
      ),
    )
  }
  if (completed.length < minimumCompleteCount) {
    environmentReasons.push(
      environmentReason(
        'EXECUTION_MATERIALLY_LOW',
        `completed ${completed.length}; minimum complete count is ${minimumCompleteCount}`,
      ),
    )
  }
  if (runnerErrors.length > 0 || results.some((result) => result.status === 'RUNNER_ERROR')) {
    environmentReasons.push(
      environmentReason('RUNNER_ERROR', 'runner or process-launch failure prevented a complete suite result'),
    )
  }
  if (environmentFailureResults.length > 0) {
    environmentReasons.push(
      environmentReason(
        'TEST_ENVIRONMENT_FAILURE',
        `test processes reported environment/configuration failures: ${environmentFailureResults
          .map(({ file }) => file)
          .sort((left, right) => left.localeCompare(right, 'en'))
          .join(', ')}`,
      ),
    )
  }
  if (missingKnownFailures.length > 0) {
    environmentReasons.push(
      environmentReason(
        'KNOWN_FAILURE_NOT_COLLECTED',
        `known failures missing from collection: ${missingKnownFailures.map(({ id }) => id).join(', ')}`,
      ),
    )
  }
  if (incompleteKnownFailures.length > 0) {
    environmentReasons.push(
      environmentReason(
        'KNOWN_FAILURE_NOT_EXECUTED',
        `known failures did not complete: ${incompleteKnownFailures.map(({ id }) => id).join(', ')}`,
      ),
    )
  }

  const deduplicatedEnvironmentReasons = environmentReasons.filter(
    (reason, index, all) => all.findIndex((candidate) => candidate.code === reason.code) === index,
  )
  const testEnvironmentHealth = deduplicatedEnvironmentReasons.length === 0 ? 'PASS' : 'BLOCKED'
  const blockingReasons = [
    ...deduplicatedEnvironmentReasons,
    ...(newFailures.length > 0
      ? [{
          category: 'TEST_FAILURE',
          code: 'NEW_FAILURES',
          message: newFailures.map(({ file, reason }) => `${file} (${reason})`).join(', '),
        }]
      : []),
  ]
  const overallStatus = blockingReasons.length === 0 ? 'PASS' : 'BLOCKED'
  const exitCode = testEnvironmentHealth === 'BLOCKED' ? 2 : newFailures.length > 0 ? 1 : 0

  return {
    schemaVersion: 1,
    suite: ROOT_SUITE_NAME,
    metadata,
    counts: {
      expected,
      collected: collected.length,
      executed: completed.length,
      passed: passed.length,
      failed: failures.length,
      knownFailures: knownStillFailing.length,
      newFailures: newFailures.length,
      recoveredFailures: recoveredFailures.length,
      skipped: skipped.length,
      uncollected,
      environmentFailures: environmentFailureResults.length,
    },
    files: {
      collected,
      results: results
        .map(({ observedOutput, ...result }) => result)
        .sort((left, right) => left.file.localeCompare(right.file, 'en')),
      knownFailures: knownStillFailing,
      newFailures,
      recoveredFailures,
      missingKnownFailures,
      incompleteKnownFailures,
      skipped,
      environmentFailures: environmentFailureResults
        .map(({ observedOutput, ...result }) => result)
        .sort((left, right) => left.file.localeCompare(right.file, 'en')),
      uncollected: missingExpectedFiles,
      unexpectedCollected: unexpectedCollectedFiles,
    },
    runnerErrors: [...runnerErrors],
    testEnvironmentHealth,
    environmentReasons: deduplicatedEnvironmentReasons,
    overallStatus,
    blockingReasons,
    exitCode,
  }
}

export function renderStructuredSummary(summary) {
  return `${JSON.stringify(summary, null, 2)}\n`
}

function renderList(label, values, formatter = (value) => value) {
  return [label, ...(values.length > 0 ? values.map((value) => `- ${formatter(value)}`) : ['- NONE'])]
}

export function renderHumanSummary(summary) {
  const { counts } = summary
  return [
    'FULL SUITE SUMMARY',
    `Expected: ${counts.expected}`,
    `Collected: ${counts.collected}`,
    `Executed: ${counts.executed}`,
    `Passed: ${counts.passed}`,
    `Failed: ${counts.failed}`,
    `Known Failures: ${counts.knownFailures}`,
    `New Failures: ${counts.newFailures}`,
    `Recovered Failures: ${counts.recoveredFailures}`,
    `Skipped / Not Collected: ${counts.skipped} / ${counts.uncollected}`,
    `Environment Failures: ${counts.environmentFailures}`,
    `TEST ENVIRONMENT HEALTH: ${summary.testEnvironmentHealth}`,
    `OVERALL STATUS: ${summary.overallStatus}`,
    `EXIT CODE: ${summary.exitCode}`,
    ...renderList('Known Failures:', summary.files.knownFailures, ({ id, file }) => `${id} ${file}`),
    ...renderList('New Failures:', summary.files.newFailures, ({ file, reason }) => `${file} (${reason})`),
    ...renderList('Recovered Failures:', summary.files.recoveredFailures, ({ id, file }) => `${id} ${file}`),
    ...renderList('Skipped:', summary.files.skipped),
    ...renderList('Uncollected:', summary.files.uncollected),
    ...renderList('Unexpected Collected:', summary.files.unexpectedCollected),
    ...renderList(
      'Blocking Reasons:',
      summary.blockingReasons,
      ({ category, code, message }) => `${category}/${code}: ${message}`,
    ),
  ].join('\n')
}

function parseArgs(argv) {
  const options = {
    repoRoot: DEFAULT_REPO_ROOT,
    baselinePath: DEFAULT_BASELINE_PATH,
    testsDir: 'tests',
    outputDir: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (!['--repo-root', '--baseline', '--tests-dir', '--output-dir'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`Missing value for ${argument}`)
    index += 1
    if (argument === '--repo-root') options.repoRoot = resolve(value)
    if (argument === '--baseline') options.baselinePath = value
    if (argument === '--tests-dir') options.testsDir = value
    if (argument === '--output-dir') options.outputDir = resolve(value)
  }
  return options
}

function helpText() {
  return `Usage: npm run test:full -- [options]\n\n` +
    `Options:\n` +
    `  --baseline <path>    Markdown Known Failure Baseline (source of truth)\n` +
    `  --tests-dir <path>   Root-suite directory; only immediate *.test.ts/*.test.cjs files\n` +
    `  --output-dir <path>  Exact new evidence directory (must not already exist)\n` +
    `  --repo-root <path>   Repository root\n`
}

function getHeadSha(repoRoot) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function defaultRunIdentity(timestamp, headSha) {
  const compactTimestamp = timestamp.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${compactTimestamp}-${headSha.slice(0, 12)}`
}

function prepareEvidenceDirectory({ repoRoot, outputDir, runIdentity }) {
  const target = outputDir ?? resolve(repoRoot, 'test-results', 'test-evidence', 'root-full', runIdentity)
  if (existsSync(target)) throw new Error(`Evidence directory already exists: ${target}`)
  mkdirSync(target, { recursive: true })
  return target
}

function emitRaw(rawLogPath, text) {
  appendFileSync(rawLogPath, text)
  process.stdout.write(text)
}

export function detectEnvironmentFailure(file, output, baselineFingerprints) {
  const baselineMatch = baselineFingerprints.find(
    (entry) => entry.file === file && output.includes(entry.fingerprint),
  )
  if (baselineMatch) {
    return { code: 'BASELINE_ENVIRONMENT_FINGERPRINT', fingerprint: baselineMatch.fingerprint }
  }

  const explicitMarker = output.match(/^TEST_ENVIRONMENT_BLOCKED(?:\t|:)\s*([^\n]*)/m)
  if (explicitMarker) {
    return { code: 'EXPLICIT_TEST_ENVIRONMENT_BLOCKED', fingerprint: explicitMarker[0] }
  }

  const requiredConfiguration = output.match(
    /^Error: [^\n]*(?:_TEST_DATABASE|DATABASE_URL|_BASE_URL|_SECRET|CHROME_PATH)[^\n]*\s+(?:is|are) required\b/m,
  )
  if (requiredConfiguration) {
    return { code: 'MISSING_REQUIRED_CONFIGURATION', fingerprint: requiredConfiguration[0] }
  }

  const explicitLocalDatabase = output.match(/^Error: Explicit LOCAL test database[^\n]* required/im)
  if (explicitLocalDatabase) {
    return { code: 'MISSING_LOCAL_TEST_DATABASE', fingerprint: explicitLocalDatabase[0] }
  }

  return null
}

function normalizeProcessResult(file, child, baselineFingerprints) {
  if (child.error || child.status === null) {
    return {
      file,
      status: 'RUNNER_ERROR',
      exitStatus: child.status,
      signal: child.signal ?? null,
      error: child.error?.message ?? 'process did not return an exit status',
    }
  }
  const observedOutput = `${child.stdout ?? ''}\n${child.stderr ?? ''}`
  const environmentFailure = child.status === 0
    ? null
    : detectEnvironmentFailure(file, observedOutput, baselineFingerprints)
  return {
    file,
    status: child.status === 0 ? 'PASS' : 'FAIL',
    classification: environmentFailure ? 'ENVIRONMENT' : 'TEST',
    exitStatus: child.status,
    signal: child.signal ?? null,
    error: null,
    environmentCode: environmentFailure?.code ?? null,
    environmentFingerprint: environmentFailure?.fingerprint ?? null,
    observedOutput,
  }
}

function runCollectedTests({ repoRoot, collectedFiles, rawLogPath, baselineFingerprints }) {
  const results = []
  const runnerErrors = []
  const tsxCli = resolve(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

  if (collectedFiles.some((file) => file.endsWith('.test.ts')) && !existsSync(tsxCli)) {
    runnerErrors.push(`Missing existing dev dependency runtime: ${toPosix(relative(repoRoot, tsxCli))}`)
    return { results, runnerErrors }
  }

  for (const file of collectedFiles) {
    emitRaw(rawLogPath, `TEST_START\t${file}\n`)
    const absoluteFile = resolve(repoRoot, file)
    const args = file.endsWith('.test.ts') ? [tsxCli, absoluteFile] : [absoluteFile]
    const child = spawnSync(process.execPath, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 64 * 1024 * 1024,
    })
    if (child.stdout) emitRaw(rawLogPath, child.stdout.endsWith('\n') ? child.stdout : `${child.stdout}\n`)
    if (child.stderr) emitRaw(rawLogPath, child.stderr.endsWith('\n') ? child.stderr : `${child.stderr}\n`)
    const result = normalizeProcessResult(file, child, baselineFingerprints)
    results.push(result)
    emitRaw(
      rawLogPath,
      `TEST_RESULT\t${result.status}\t${file}\texit=${result.exitStatus ?? 'none'}\t` +
        `classification=${result.classification ?? 'RUNNER'}\tsignal=${result.signal ?? 'none'}\t` +
        `error=${result.error ?? 'none'}\n`,
    )
  }
  return { results, runnerErrors }
}

function blockedStartupSummary(error) {
  const reason = environmentReason('RUNNER_STARTUP_ERROR', error.message)
  return {
    schemaVersion: 1,
    suite: ROOT_SUITE_NAME,
    metadata: {},
    counts: {
      expected: null,
      collected: 0,
      executed: 0,
      passed: 0,
      failed: 0,
      knownFailures: 0,
      newFailures: 0,
      recoveredFailures: 0,
      skipped: 0,
      uncollected: null,
      environmentFailures: 0,
    },
    files: {
      collected: [],
      results: [],
      knownFailures: [],
      newFailures: [],
      recoveredFailures: [],
      missingKnownFailures: [],
      incompleteKnownFailures: [],
      skipped: [],
      environmentFailures: [],
      uncollected: [],
      unexpectedCollected: [],
    },
    runnerErrors: [error.message],
    testEnvironmentHealth: 'BLOCKED',
    environmentReasons: [reason],
    overallStatus: 'BLOCKED',
    blockingReasons: [reason],
    exitCode: 2,
  }
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv)
    if (options.help) {
      process.stdout.write(helpText())
      return 0
    }

    const repoRoot = options.repoRoot
    const baselineAbsolutePath = isAbsolute(options.baselinePath)
      ? options.baselinePath
      : resolve(repoRoot, options.baselinePath)
    const baselineContent = readFileSync(baselineAbsolutePath, 'utf8')
    const baseline = parseKnownFailureBaseline(baselineContent)
    const baselineEvidenceAbsolutePath = resolve(repoRoot, baseline.baselineEvidence.path)
    const baselineEvidenceContent = readFileSync(baselineEvidenceAbsolutePath)
    if (sha256(baselineEvidenceContent) !== baseline.baselineEvidence.sha256) {
      throw new Error('Stable baseline evidence SHA-256 does not match the Markdown source of truth')
    }
    const expectedFiles = parseBaselineTestManifest(baselineEvidenceContent.toString('utf8'))
    if (expectedFiles.length !== baseline.expected) {
      throw new Error('Stable baseline evidence manifest does not match the expected test-file count')
    }
    const collectedFiles = discoverRootTests({ repoRoot, testsDir: options.testsDir })
    const headSha = getHeadSha(repoRoot)
    const timestamp = new Date().toISOString()
    const runIdentity = defaultRunIdentity(timestamp, headSha)
    const evidenceDirectory = prepareEvidenceDirectory({
      repoRoot,
      outputDir: options.outputDir,
      runIdentity,
    })
    const rawLogPath = resolve(evidenceDirectory, 'root-full-suite.log')
    writeFileSync(rawLogPath, '')
    emitRaw(
      rawLogPath,
      `SUITE_START\t${ROOT_SUITE_NAME}\tfiles=${collectedFiles.length}\texpected=${baseline.expected}\thead=${headSha}\n`,
    )

    const { results, runnerErrors } = runCollectedTests({
      repoRoot,
      collectedFiles,
      rawLogPath,
      baselineFingerprints: baseline.environmentFingerprints,
    })
    const summary = evaluateSuite({
      expected: baseline.expected,
      expectedFiles,
      collectedFiles,
      results,
      knownFailures: baseline.knownFailures,
      runnerErrors,
      metadata: {
        runIdentity,
        timestamp,
        headSha,
        baselinePath: toPosix(relative(repoRoot, baselineAbsolutePath)),
        baselineSha256: sha256(baselineContent),
        baselineEvidencePath: baseline.baselineEvidence.path,
        baselineEvidenceSha256: baseline.baselineEvidence.sha256,
        evidenceDirectory: toPosix(relative(repoRoot, evidenceDirectory)),
      },
    })

    emitRaw(
      rawLogPath,
      `SUITE_SUMMARY\t${ROOT_SUITE_NAME}\texpected=${summary.counts.expected}\t` +
        `collected=${summary.counts.collected}\texecuted=${summary.counts.executed}\t` +
        `pass=${summary.counts.passed}\tfail=${summary.counts.failed}\t` +
        `known=${summary.counts.knownFailures}\tnew=${summary.counts.newFailures}\t` +
        `recovered=${summary.counts.recoveredFailures}\tenvironment_failures=${summary.counts.environmentFailures}\t` +
        `skipped=${summary.counts.skipped}\t` +
        `uncollected=${summary.counts.uncollected}\tenvironment=${summary.testEnvironmentHealth}\t` +
        `overall=${summary.overallStatus}\n`,
    )

    summary.metadata.rawLogSha256 = sha256(readFileSync(rawLogPath))

    const summaryPath = resolve(evidenceDirectory, 'summary.json')
    writeFileSync(summaryPath, renderStructuredSummary(summary))
    process.stdout.write(`\n${renderHumanSummary(summary)}\n`)
    process.stdout.write(`RAW EVIDENCE: ${rawLogPath}\n`)
    process.stdout.write(`STRUCTURED EVIDENCE: ${summaryPath}\n`)
    return summary.exitCode
  } catch (error) {
    const summary = blockedStartupSummary(error instanceof Error ? error : new Error(String(error)))
    process.stderr.write(`${renderHumanSummary(summary)}\n`)
    process.stderr.write(renderStructuredSummary(summary))
    return summary.exitCode
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main()
}

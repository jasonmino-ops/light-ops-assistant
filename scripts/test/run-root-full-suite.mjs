#!/usr/bin/env node

import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  copyFileSync,
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
export const DEFAULT_CORE_MANIFEST_PATH = 'scripts/test/manifests/root-core-tests.json'
export const DEFAULT_INTEGRATION_MANIFEST_PATH = 'scripts/test/manifests/root-integration-tests.json'

const ROOT_SUITE_NAME = 'root-top-level'
const DURABLE_EVIDENCE_ROOT = 'docs/change-gates/evidence/ES-ENGINEERING-EVIDENCE-02B'
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

function duplicateValues(values) {
  const seen = new Set()
  const duplicates = new Set()
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value)
    seen.add(value)
  }
  return stableSort(duplicates)
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || isAbsolute(value)) {
    throw new Error(`${label} must be a non-empty repository-relative path`)
  }
  const normalized = toPosix(value)
  if (normalized.split('/').includes('..')) {
    throw new Error(`${label} must not escape its evidence root`)
  }
  return normalized
}

export function parseLaneManifest(raw, expectedLane) {
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid ${expectedLane} manifest JSON: ${error.message}`)
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${expectedLane} manifest must be a JSON object`)
  }
  if ('sha256' in manifest || 'manifestSha256' in manifest) {
    throw new Error(`${expectedLane} manifest must not contain a self SHA-256`)
  }
  if (manifest.schemaVersion !== 1 || manifest.lane !== expectedLane) {
    throw new Error(`${expectedLane} manifest schema or lane is invalid`)
  }
  if (!Number.isInteger(manifest.expectedCount) || manifest.expectedCount < 1) {
    throw new Error(`${expectedLane} manifest expectedCount must be a positive integer`)
  }
  if (!Array.isArray(manifest.tests)) {
    throw new Error(`${expectedLane} manifest tests must be an array`)
  }
  const tests = manifest.tests.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${expectedLane} manifest test ${index} must be an object`)
    }
    for (const field of ['file', 'lane', 'reason', 'dependencyType', 'evidence']) {
      if (typeof entry[field] !== 'string' || entry[field].trim().length === 0) {
        throw new Error(`${expectedLane} manifest test ${index} has no ${field}`)
      }
    }
    if (entry.lane !== expectedLane) {
      throw new Error(`${expectedLane} manifest test ${entry.file} declares lane ${entry.lane}`)
    }
    if (!/^tests\/[^/]+\.test\.(?:ts|cjs)$/.test(entry.file)) {
      throw new Error(`${expectedLane} manifest has invalid root test path: ${entry.file}`)
    }
    return { ...entry }
  })
  return { ...manifest, tests }
}

function loadLaneManifest({ repoRoot, path, lane }) {
  const absolutePath = isAbsolute(path) ? path : resolve(repoRoot, path)
  const raw = readFileSync(absolutePath, 'utf8')
  const manifest = parseLaneManifest(raw, lane)
  return {
    lane,
    path: toPosix(relative(repoRoot, absolutePath)),
    absolutePath,
    raw,
    sha256: sha256(raw),
    expectedCount: manifest.expectedCount,
    tests: manifest.tests,
    files: manifest.tests.map(({ file }) => file),
  }
}

function manifestReason(code, message) {
  return { category: 'MANIFEST', code, message }
}

export function auditLaneManifests({ coreManifest, integrationManifest, discoveredFiles, integrityErrors = [] }) {
  const coreFiles = coreManifest.files ?? coreManifest.tests.map(({ file }) => file)
  const integrationFiles = integrationManifest.files ?? integrationManifest.tests.map(({ file }) => file)
  const discovered = stableSort(unique(discoveredFiles))
  const coreUnique = stableSort(unique(coreFiles))
  const integrationUnique = stableSort(unique(integrationFiles))
  const union = stableSort(unique([...coreFiles, ...integrationFiles]))
  const unionSet = new Set(union)
  const discoveredSet = new Set(discovered)
  const coreDuplicates = duplicateValues(coreFiles)
  const integrationDuplicates = duplicateValues(integrationFiles)
  const integrationSet = new Set(integrationFiles)
  const crossLaneDuplicates = coreUnique.filter((file) => integrationSet.has(file))
  const addedUnassigned = discovered.filter((file) => !unionSet.has(file))
  const removedMissing = union.filter((file) => !discoveredSet.has(file))
  const blockingReasons = []

  if (coreManifest.expectedCount !== coreFiles.length || integrationManifest.expectedCount !== integrationFiles.length) {
    blockingReasons.push(manifestReason(
      'MANIFEST_EXPECTED_COUNT_MISMATCH',
      `CORE expected/entries ${coreManifest.expectedCount}/${coreFiles.length}; ` +
        `INTEGRATION expected/entries ${integrationManifest.expectedCount}/${integrationFiles.length}`,
    ))
  }
  if (coreDuplicates.length > 0 || integrationDuplicates.length > 0) {
    blockingReasons.push(manifestReason(
      'DUPLICATE_MEMBERSHIP',
      `CORE duplicates: ${coreDuplicates.join(', ') || 'NONE'}; ` +
        `INTEGRATION duplicates: ${integrationDuplicates.join(', ') || 'NONE'}`,
    ))
  }
  if (crossLaneDuplicates.length > 0) {
    blockingReasons.push(manifestReason(
      'CROSS_LANE_DUPLICATE',
      `tests assigned to both lanes: ${crossLaneDuplicates.join(', ')}`,
    ))
  }
  if (addedUnassigned.length > 0) {
    blockingReasons.push(manifestReason(
      'ADDED_UNASSIGNED_TEST',
      `filesystem tests absent from both manifests: ${addedUnassigned.join(', ')}`,
    ))
  }
  if (removedMissing.length > 0) {
    blockingReasons.push(manifestReason(
      'REMOVED_MISSING_TEST',
      `manifest tests absent from filesystem discovery: ${removedMissing.join(', ')}`,
    ))
  }
  for (const error of integrityErrors) {
    blockingReasons.push(manifestReason('MANIFEST_HASH_INTEGRITY_ERROR', String(error)))
  }

  return {
    expected: {
      core: coreManifest.expectedCount,
      integration: integrationManifest.expectedCount,
      aggregate: coreManifest.expectedCount + integrationManifest.expectedCount,
    },
    discovered,
    coreFiles: coreUnique,
    integrationFiles: integrationUnique,
    union,
    coreDuplicates,
    integrationDuplicates,
    crossLaneDuplicates,
    addedUnassigned,
    removedMissing,
    unassigned: addedUnassigned,
    duplicate: stableSort(unique([...coreDuplicates, ...integrationDuplicates, ...crossLaneDuplicates])),
    blockingReasons,
    exact: blockingReasons.length === 0,
  }
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
  suite = ROOT_SUITE_NAME,
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
  const knownEnvironmentBlocked = known.filter(
    ({ file }) => outcomes.get(file)?.status === 'FAIL' && outcomes.get(file)?.classification === 'ENVIRONMENT',
  )
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
    suite,
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
      knownEnvironmentBlocked: knownEnvironmentBlocked.length,
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
      knownEnvironmentBlocked,
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
    authority: 'LANE_ONLY',
    laneStatus: overallStatus,
    overallStatus,
    blockingReasons,
    exitCode,
  }
}

function laneCounts(summary, field) {
  return summary?.counts?.[field] ?? 0
}

function aggregateFiles(laneSummaries, field) {
  return laneSummaries
    .flatMap((summary) => summary?.files?.[field] ?? [])
    .sort((left, right) => left.file.localeCompare(right.file, 'en'))
}

export function evaluateAggregate({
  coreSummary,
  integrationSummary,
  manifestAudit,
  metadata = {},
  runnerErrors = [],
  manifestIntegrityErrors = [],
  evidenceIntegrityErrors = [],
}) {
  const laneSummaries = [coreSummary, integrationSummary].filter(Boolean)
  const manifestReasons = [
    ...manifestAudit.blockingReasons,
    ...manifestIntegrityErrors.map((message) => manifestReason('MANIFEST_HASH_INTEGRITY_ERROR', String(message))),
  ]
  const laneEnvironmentReasons = []
  for (const [lane, summary] of [['CORE', coreSummary], ['INTEGRATION', integrationSummary]]) {
    if (!summary) {
      laneEnvironmentReasons.push(environmentReason(`${lane}_LANE_NOT_EXECUTED`, `${lane} lane was not executed`))
    } else if (summary.testEnvironmentHealth !== 'PASS') {
      laneEnvironmentReasons.push(environmentReason(
        `${lane}_ENVIRONMENT_BLOCKED`,
        `${lane} environment is BLOCKED: ${summary.environmentReasons.map(({ code }) => code).join(', ') || 'UNKNOWN'}`,
      ))
    }
  }
  const runnerReasons = runnerErrors.length > 0
    ? [environmentReason('RUNNER_ERROR', runnerErrors.join('; '))]
    : []
  const evidenceReasons = evidenceIntegrityErrors.map((message) => ({
    category: 'EVIDENCE',
    code: 'EVIDENCE_INTEGRITY_ERROR',
    message: String(message),
  }))
  const newFailures = aggregateFiles(laneSummaries, 'newFailures')
  const testFailureReasons = newFailures.length > 0
    ? [{
        category: 'TEST_FAILURE',
        code: 'NEW_FAILURES',
        message: newFailures.map(({ file, reason }) => `${file} (${reason})`).join(', '),
      }]
    : []
  const nonTestBlockingReasons = [
    ...manifestReasons,
    ...laneEnvironmentReasons,
    ...runnerReasons,
    ...evidenceReasons,
  ]
  const blockingReasons = [...nonTestBlockingReasons, ...testFailureReasons]
  const testEnvironmentHealth = nonTestBlockingReasons.length === 0 ? 'PASS' : 'BLOCKED'
  const overallStatus = blockingReasons.length === 0 ? 'PASS' : 'BLOCKED'
  const exitCode = nonTestBlockingReasons.length > 0 ? 2 : newFailures.length > 0 ? 1 : 0
  const expected = manifestAudit.expected.aggregate
  const collected = laneCounts(coreSummary, 'collected') + laneCounts(integrationSummary, 'collected')
  const executed = laneCounts(coreSummary, 'executed') + laneCounts(integrationSummary, 'executed')

  return {
    schemaVersion: 1,
    suite: ROOT_SUITE_NAME,
    metadata,
    counts: {
      expected,
      collected,
      executed,
      passed: laneCounts(coreSummary, 'passed') + laneCounts(integrationSummary, 'passed'),
      failed: laneCounts(coreSummary, 'failed') + laneCounts(integrationSummary, 'failed'),
      knownFailures: laneCounts(coreSummary, 'knownFailures') + laneCounts(integrationSummary, 'knownFailures'),
      newFailures: newFailures.length,
      recoveredFailures: laneCounts(coreSummary, 'recoveredFailures') + laneCounts(integrationSummary, 'recoveredFailures'),
      knownEnvironmentBlocked:
        laneCounts(coreSummary, 'knownEnvironmentBlocked') + laneCounts(integrationSummary, 'knownEnvironmentBlocked'),
      skipped: laneCounts(coreSummary, 'skipped') + laneCounts(integrationSummary, 'skipped'),
      uncollected: Math.max(0, expected - collected),
      environmentFailures:
        laneCounts(coreSummary, 'environmentFailures') + laneCounts(integrationSummary, 'environmentFailures'),
      unassigned: manifestAudit.unassigned.length,
      duplicate: manifestAudit.duplicate.length,
    },
    files: {
      collected: stableSort(laneSummaries.flatMap((summary) => summary.files.collected)),
      results: laneSummaries
        .flatMap((summary) => summary.files.results)
        .sort((left, right) => left.file.localeCompare(right.file, 'en')),
      knownFailures: aggregateFiles(laneSummaries, 'knownFailures'),
      newFailures,
      recoveredFailures: aggregateFiles(laneSummaries, 'recoveredFailures'),
      knownEnvironmentBlocked: aggregateFiles(laneSummaries, 'knownEnvironmentBlocked'),
      missingKnownFailures: aggregateFiles(laneSummaries, 'missingKnownFailures'),
      incompleteKnownFailures: aggregateFiles(laneSummaries, 'incompleteKnownFailures'),
      skipped: stableSort(laneSummaries.flatMap((summary) => summary.files.skipped)),
      environmentFailures: laneSummaries
        .flatMap((summary) => summary.files.environmentFailures)
        .sort((left, right) => left.file.localeCompare(right.file, 'en')),
      uncollected: manifestAudit.removedMissing,
      unexpectedCollected: manifestAudit.addedUnassigned,
      unassigned: manifestAudit.unassigned,
      duplicate: manifestAudit.duplicate,
    },
    manifestAudit: {
      expected: manifestAudit.expected,
      discovered: manifestAudit.discovered.length,
      union: manifestAudit.union.length,
      intersection: manifestAudit.crossLaneDuplicates.length,
      unassigned: manifestAudit.unassigned,
      duplicate: manifestAudit.duplicate,
      removedMissing: manifestAudit.removedMissing,
      exact: manifestAudit.exact && manifestIntegrityErrors.length === 0,
    },
    lanes: {
      core: coreSummary
        ? { environmentHealth: coreSummary.testEnvironmentHealth, status: coreSummary.overallStatus, exitCode: coreSummary.exitCode }
        : { environmentHealth: 'BLOCKED', status: 'NOT_EXECUTED', exitCode: 2 },
      integration: integrationSummary
        ? { environmentHealth: integrationSummary.testEnvironmentHealth, status: integrationSummary.overallStatus, exitCode: integrationSummary.exitCode }
        : { environmentHealth: 'BLOCKED', status: 'NOT_EXECUTED', exitCode: 2 },
    },
    runnerErrors: [...runnerErrors],
    testEnvironmentHealth,
    environmentReasons: nonTestBlockingReasons,
    evidenceStatus: metadata.durableEvidenceExists ? 'DURABLE' : 'NOT_DURABLE',
    authority: 'FULL_SUITE',
    fullSuiteStatus: overallStatus,
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
    `${summary.suite.toUpperCase()} SUMMARY`,
    ...(summary.authority === 'FULL_SUITE' ? [`FULL SUITE STATUS: ${summary.fullSuiteStatus}`] : []),
    `Expected: ${counts.expected}`,
    `Collected: ${counts.collected}`,
    `Executed: ${counts.executed}`,
    `Passed: ${counts.passed}`,
    `Failed: ${counts.failed}`,
    `Known Failures: ${counts.knownFailures}`,
    `New Failures: ${counts.newFailures}`,
    `Recovered Failures: ${counts.recoveredFailures}`,
    `Known but Environment Blocked: ${counts.knownEnvironmentBlocked ?? 0}`,
    `Skipped / Not Collected: ${counts.skipped} / ${counts.uncollected}`,
    `Environment Failures: ${counts.environmentFailures}`,
    `TEST ENVIRONMENT HEALTH: ${summary.testEnvironmentHealth}`,
    `OVERALL STATUS: ${summary.overallStatus}`,
    `EXIT CODE: ${summary.exitCode}`,
    ...renderList('Known Failures:', summary.files.knownFailures, ({ id, file }) => `${id} ${file}`),
    ...renderList('New Failures:', summary.files.newFailures, ({ file, reason }) => `${file} (${reason})`),
    ...renderList('Recovered Failures:', summary.files.recoveredFailures, ({ id, file }) => `${id} ${file}`),
    ...renderList(
      'Known but Environment Blocked:',
      summary.files.knownEnvironmentBlocked ?? [],
      ({ id, file }) => `${id} ${file}`,
    ),
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
    coreManifestPath: DEFAULT_CORE_MANIFEST_PATH,
    integrationManifestPath: DEFAULT_INTEGRATION_MANIFEST_PATH,
    testsDir: 'tests',
    outputDir: null,
    lane: 'aggregate',
    promoteRun: null,
    verifyDurable: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help') return { ...options, help: true }
    if (![
      '--repo-root',
      '--baseline',
      '--core-manifest',
      '--integration-manifest',
      '--tests-dir',
      '--output-dir',
      '--lane',
      '--promote-run',
      '--verify-durable',
    ].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = argv[index + 1]
    if (!value) throw new Error(`Missing value for ${argument}`)
    index += 1
    if (argument === '--repo-root') options.repoRoot = resolve(value)
    if (argument === '--baseline') options.baselinePath = value
    if (argument === '--core-manifest') options.coreManifestPath = value
    if (argument === '--integration-manifest') options.integrationManifestPath = value
    if (argument === '--tests-dir') options.testsDir = value
    if (argument === '--output-dir') options.outputDir = resolve(value)
    if (argument === '--lane') options.lane = value.toLowerCase()
    if (argument === '--promote-run') options.promoteRun = resolve(value)
    if (argument === '--verify-durable') options.verifyDurable = resolve(value)
  }
  if (!['core', 'integration', 'aggregate'].includes(options.lane)) {
    throw new Error(`Invalid lane: ${options.lane}`)
  }
  if (options.promoteRun && options.verifyDurable) {
    throw new Error('--promote-run and --verify-durable are mutually exclusive')
  }
  return options
}

function helpText() {
  return `Usage: npm run test:full -- [options]\n\n` +
    `Options:\n` +
    `  --lane <lane>        core, integration, or aggregate (default)\n` +
    `  --baseline <path>    Markdown Known Failure Baseline (source of truth)\n` +
    `  --core-manifest <p>  Fixed Core lane manifest\n` +
    `  --integration-manifest <p>  Fixed Integration lane manifest\n` +
    `  --tests-dir <path>   Root-suite directory; only immediate *.test.ts/*.test.cjs files\n` +
    `  --output-dir <path>  Exact new evidence directory (must not already exist)\n` +
    `  --promote-run <path> Promote an existing aggregate runtime run without rerunning\n` +
    `  --verify-durable <p> Verify an existing durable evidence directory\n` +
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
  const target = outputDir ?? resolve(repoRoot, 'test-results', 'test-evidence', 'root-lanes', runIdentity)
  if (existsSync(target)) throw new Error(`Evidence directory already exists: ${target}`)
  mkdirSync(target, { recursive: true })
  return target
}

function emitRaw(rawLogPath, text) {
  appendFileSync(rawLogPath, text)
  process.stdout.write(text)
}

function laneDirectoryName(lane) {
  return lane.toLowerCase()
}

function laneSuiteName(lane) {
  return `root-${lane.toLowerCase()}`
}

function laneRawLogName(lane) {
  return `root-${lane.toLowerCase()}-suite.log`
}

function expectedDurableEvidencePath(headSha, runIdentity) {
  return `${DURABLE_EVIDENCE_ROOT}/${headSha.slice(0, 12)}/${runIdentity}`
}

function executeLane({
  repoRoot,
  evidenceDirectory,
  manifestInfo,
  baseline,
  baselineAbsolutePath,
  baselineContent,
  headSha,
  timestamp,
  runIdentity,
}) {
  const lane = manifestInfo.lane
  const laneDirectory = resolve(evidenceDirectory, laneDirectoryName(lane))
  mkdirSync(laneDirectory, { recursive: true })
  const manifestSnapshotPath = resolve(laneDirectory, 'manifest.json')
  writeFileSync(manifestSnapshotPath, manifestInfo.raw)
  const rawLogPath = resolve(laneDirectory, laneRawLogName(lane))
  writeFileSync(rawLogPath, '')
  emitRaw(
    rawLogPath,
    `SUITE_START\t${laneSuiteName(lane)}\tlane=${lane}\tfiles=${manifestInfo.files.length}\t` +
      `expected=${manifestInfo.expectedCount}\thead=${headSha}\n`,
  )
  const knownFailures = baseline.knownFailures.filter(({ file }) => manifestInfo.files.includes(file))
  const { results, runnerErrors } = runCollectedTests({
    repoRoot,
    collectedFiles: manifestInfo.files,
    rawLogPath,
    baselineFingerprints: baseline.environmentFingerprints,
  })
  const summary = evaluateSuite({
    suite: laneSuiteName(lane),
    expected: manifestInfo.expectedCount,
    expectedFiles: manifestInfo.files,
    collectedFiles: manifestInfo.files,
    results,
    knownFailures,
    runnerErrors,
    metadata: {
      lane,
      runIdentity,
      timestamp,
      headSha,
      manifestPath: manifestInfo.path,
      manifestSha256: manifestInfo.sha256,
      manifestSnapshotPath: `${laneDirectoryName(lane)}/manifest.json`,
      baselinePath: toPosix(relative(repoRoot, baselineAbsolutePath)),
      baselineSha256: sha256(baselineContent),
      baselineEvidencePath: baseline.baselineEvidence.path,
      baselineEvidenceSha256: baseline.baselineEvidence.sha256,
      evidenceDirectory: toPosix(relative(repoRoot, evidenceDirectory)),
      laneEvidenceDirectory: `${laneDirectoryName(lane)}/`,
    },
  })
  emitRaw(
    rawLogPath,
    `SUITE_SUMMARY\t${laneSuiteName(lane)}\texpected=${summary.counts.expected}\t` +
      `collected=${summary.counts.collected}\texecuted=${summary.counts.executed}\t` +
      `pass=${summary.counts.passed}\tfail=${summary.counts.failed}\t` +
      `known=${summary.counts.knownFailures}\tnew=${summary.counts.newFailures}\t` +
      `recovered=${summary.counts.recoveredFailures}\t` +
      `known_environment_blocked=${summary.counts.knownEnvironmentBlocked}\t` +
      `environment_failures=${summary.counts.environmentFailures}\t` +
      `skipped=${summary.counts.skipped}\tuncollected=${summary.counts.uncollected}\t` +
      `environment=${summary.testEnvironmentHealth}\toverall=${summary.overallStatus}\n`,
  )
  summary.metadata.rawLogSha256 = sha256(readFileSync(rawLogPath))
  const summaryPath = resolve(laneDirectory, 'summary.json')
  writeFileSync(summaryPath, renderStructuredSummary(summary))
  process.stdout.write(`\n${renderHumanSummary(summary)}\n`)
  process.stdout.write(`RAW EVIDENCE: ${rawLogPath}\n`)
  process.stdout.write(`STRUCTURED EVIDENCE: ${summaryPath}\n`)
  return { summary, rawLogPath, summaryPath, manifestSnapshotPath }
}

export function collectLaneEvidenceIntegrityErrors({ laneResult, manifestInfo, baselineSha256 }) {
  const errors = []
  const { summary, rawLogPath, summaryPath, manifestSnapshotPath } = laneResult
  const persistedSummary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  if (sha256(readFileSync(rawLogPath)) !== summary.metadata.rawLogSha256) {
    errors.push(`${manifestInfo.lane} raw log SHA-256 mismatch`)
  }
  if (sha256(readFileSync(manifestSnapshotPath)) !== manifestInfo.sha256) {
    errors.push(`${manifestInfo.lane} manifest snapshot SHA-256 mismatch`)
  }
  if (persistedSummary.metadata.manifestSha256 !== manifestInfo.sha256) {
    errors.push(`${manifestInfo.lane} summary manifest SHA-256 mismatch`)
  }
  if (persistedSummary.metadata.baselineSha256 !== baselineSha256) {
    errors.push(`${manifestInfo.lane} summary baseline SHA-256 mismatch`)
  }
  if (persistedSummary.metadata.headSha !== summary.metadata.headSha) {
    errors.push(`${manifestInfo.lane} summary Candidate HEAD mismatch`)
  }
  return errors
}

export function collectManifestIntegrityErrors(manifests) {
  return manifests
    .filter((manifest) => sha256(readFileSync(manifest.absolutePath)) !== manifest.sha256)
    .map((manifest) => `${manifest.lane} manifest changed during execution`)
}

function writeAggregateEvidence({
  repoRoot,
  evidenceDirectory,
  runIdentity,
  timestamp,
  headSha,
  baselineAbsolutePath,
  baselineContent,
  baseline,
  coreManifest,
  integrationManifest,
  coreResult,
  integrationResult,
  manifestAudit,
  manifestIntegrityErrors,
  evidenceIntegrityErrors,
}) {
  const aggregateDirectory = resolve(evidenceDirectory, 'aggregate')
  mkdirSync(aggregateDirectory, { recursive: true })
  const rawLogPath = resolve(aggregateDirectory, 'root-aggregate-suite.log')
  writeFileSync(rawLogPath, '')
  emitRaw(rawLogPath, `SUITE_START\t${ROOT_SUITE_NAME}\tlane=AGGREGATE\texpected=${manifestAudit.expected.aggregate}\thead=${headSha}\n`)
  for (const result of [coreResult, integrationResult]) {
    if (!result) continue
    emitRaw(
      rawLogPath,
      `LANE_RESULT\t${result.summary.metadata.lane}\tenvironment=${result.summary.testEnvironmentHealth}\t` +
        `overall=${result.summary.overallStatus}\texit=${result.summary.exitCode}\t` +
        `summary_sha256=${sha256(readFileSync(result.summaryPath))}\n`,
    )
  }
  const durablePath = expectedDurableEvidencePath(headSha, runIdentity)
  const summary = evaluateAggregate({
    coreSummary: coreResult?.summary,
    integrationSummary: integrationResult?.summary,
    manifestAudit,
    manifestIntegrityErrors,
    evidenceIntegrityErrors,
    metadata: {
      lane: 'AGGREGATE',
      runIdentity,
      timestamp,
      headSha,
      coreManifestPath: coreManifest.path,
      coreManifestSha256: coreManifest.sha256,
      integrationManifestPath: integrationManifest.path,
      integrationManifestSha256: integrationManifest.sha256,
      baselinePath: toPosix(relative(repoRoot, baselineAbsolutePath)),
      baselineSha256: sha256(baselineContent),
      baselineEvidencePath: baseline.baselineEvidence.path,
      baselineEvidenceSha256: baseline.baselineEvidence.sha256,
      evidenceDirectory: toPosix(relative(repoRoot, evidenceDirectory)),
      expectedDurableEvidencePath: durablePath,
      durableEvidenceExists: false,
      coreSummarySha256: coreResult ? sha256(readFileSync(coreResult.summaryPath)) : null,
      integrationSummarySha256: integrationResult ? sha256(readFileSync(integrationResult.summaryPath)) : null,
    },
  })
  emitRaw(
    rawLogPath,
    `SUITE_SUMMARY\t${ROOT_SUITE_NAME}\texpected=${summary.counts.expected}\t` +
      `collected=${summary.counts.collected}\texecuted=${summary.counts.executed}\t` +
      `pass=${summary.counts.passed}\tfail=${summary.counts.failed}\t` +
      `known=${summary.counts.knownFailures}\tnew=${summary.counts.newFailures}\t` +
      `recovered=${summary.counts.recoveredFailures}\t` +
      `known_environment_blocked=${summary.counts.knownEnvironmentBlocked}\t` +
      `environment_failures=${summary.counts.environmentFailures}\t` +
      `unassigned=${summary.counts.unassigned}\tduplicate=${summary.counts.duplicate}\t` +
      `environment=${summary.testEnvironmentHealth}\toverall=${summary.overallStatus}\n`,
  )
  summary.metadata.rawLogSha256 = sha256(readFileSync(rawLogPath))
  const summaryPath = resolve(aggregateDirectory, 'summary.json')
  writeFileSync(summaryPath, renderStructuredSummary(summary))
  process.stdout.write(`\n${renderHumanSummary(summary)}\n`)
  process.stdout.write(`EXPECTED DURABLE EVIDENCE PATH: ${resolve(repoRoot, durablePath)}\n`)
  process.stdout.write(`EVIDENCE STATUS: ${summary.evidenceStatus}\n`)
  return { summary, rawLogPath, summaryPath }
}

function listEvidenceFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...listEvidenceFiles(absolutePath, relativePath))
    else if (entry.isFile() && relativePath !== 'checksums.json') files.push(relativePath)
    else if (!entry.isFile()) throw new Error(`Unsupported evidence entry: ${relativePath}`)
  }
  return stableSort(files)
}

function writeEvidenceChecksums({
  evidenceDirectory,
  headSha,
  runIdentity,
  baselinePath,
  baselineSha256,
  coreManifest,
  integrationManifest,
}) {
  const files = listEvidenceFiles(evidenceDirectory).map((path) => {
    const content = readFileSync(resolve(evidenceDirectory, path))
    return { path, sha256: sha256(content), bytes: content.byteLength }
  })
  const checksums = {
    schemaVersion: 1,
    headSha,
    runIdentity,
    baseline: { path: baselinePath, sha256: baselineSha256 },
    manifests: {
      core: { path: coreManifest.path, sha256: coreManifest.sha256 },
      integration: { path: integrationManifest.path, sha256: integrationManifest.sha256 },
    },
    files,
  }
  const path = resolve(evidenceDirectory, 'checksums.json')
  writeFileSync(path, renderStructuredSummary(checksums))
  return { checksums, path, sha256: sha256(readFileSync(path)) }
}

export function verifyEvidenceBundle({ repoRoot, evidenceDirectory, requireAggregate = true }) {
  const checksumsPath = resolve(evidenceDirectory, 'checksums.json')
  if (!existsSync(checksumsPath)) throw new Error('Evidence integrity error: checksums.json is missing')
  const checksums = JSON.parse(readFileSync(checksumsPath, 'utf8'))
  if (!checksums || checksums.schemaVersion !== 1 || !Array.isArray(checksums.files)) {
    throw new Error('Evidence integrity error: checksums.json schema is invalid')
  }
  const declaredPaths = checksums.files.map(({ path }) => assertSafeRelativePath(path, 'Evidence file path'))
  if (duplicateValues(declaredPaths).length > 0) {
    throw new Error('Evidence integrity error: checksums.json has duplicate file paths')
  }
  const actualPaths = listEvidenceFiles(evidenceDirectory)
  if (JSON.stringify(stableSort(declaredPaths)) !== JSON.stringify(actualPaths)) {
    throw new Error('Evidence integrity error: declared and actual evidence file manifests differ')
  }
  for (const entry of checksums.files) {
    const content = readFileSync(resolve(evidenceDirectory, entry.path))
    if (content.byteLength !== entry.bytes || sha256(content) !== entry.sha256) {
      throw new Error(`Evidence integrity error: checksum mismatch for ${entry.path}`)
    }
  }
  const requiredPaths = requireAggregate
    ? [
        'core/manifest.json',
        'core/root-core-suite.log',
        'core/summary.json',
        'integration/manifest.json',
        'integration/root-integration-suite.log',
        'integration/summary.json',
        'aggregate/root-aggregate-suite.log',
        'aggregate/summary.json',
      ]
    : []
  for (const path of requiredPaths) {
    if (!declaredPaths.includes(path)) throw new Error(`Evidence integrity error: required file missing: ${path}`)
  }
  if (!requireAggregate) {
    return { checksums, checksumsPath, checksumsSha256: sha256(readFileSync(checksumsPath)) }
  }
  const coreSummary = JSON.parse(readFileSync(resolve(evidenceDirectory, 'core/summary.json'), 'utf8'))
  const integrationSummary = JSON.parse(readFileSync(resolve(evidenceDirectory, 'integration/summary.json'), 'utf8'))
  const aggregateSummary = JSON.parse(readFileSync(resolve(evidenceDirectory, 'aggregate/summary.json'), 'utf8'))
  for (const [lane, summary] of [['CORE', coreSummary], ['INTEGRATION', integrationSummary], ['AGGREGATE', aggregateSummary]]) {
    if (summary.metadata.headSha !== checksums.headSha) {
      throw new Error(`Evidence integrity error: ${lane} Candidate HEAD mismatch`)
    }
    const rawPath = lane === 'AGGREGATE'
      ? 'aggregate/root-aggregate-suite.log'
      : `${lane.toLowerCase()}/${laneRawLogName(lane)}`
    if (sha256(readFileSync(resolve(evidenceDirectory, rawPath))) !== summary.metadata.rawLogSha256) {
      throw new Error(`Evidence integrity error: ${lane} raw log SHA-256 mismatch`)
    }
  }
  if (sha256(readFileSync(resolve(evidenceDirectory, 'core/manifest.json'))) !== checksums.manifests.core.sha256 ||
      coreSummary.metadata.manifestSha256 !== checksums.manifests.core.sha256) {
    throw new Error('Evidence integrity error: CORE manifest SHA-256 mismatch')
  }
  if (sha256(readFileSync(resolve(evidenceDirectory, 'integration/manifest.json'))) !== checksums.manifests.integration.sha256 ||
      integrationSummary.metadata.manifestSha256 !== checksums.manifests.integration.sha256) {
    throw new Error('Evidence integrity error: INTEGRATION manifest SHA-256 mismatch')
  }
  if (coreSummary.metadata.baselineSha256 !== checksums.baseline.sha256 ||
      integrationSummary.metadata.baselineSha256 !== checksums.baseline.sha256 ||
      aggregateSummary.metadata.baselineSha256 !== checksums.baseline.sha256) {
    throw new Error('Evidence integrity error: baseline SHA-256 mismatch')
  }
  return {
    checksums,
    checksumsPath,
    checksumsSha256: sha256(readFileSync(checksumsPath)),
    coreSummary,
    integrationSummary,
    aggregateSummary,
  }
}

function promoteEvidenceBundle({ repoRoot, sourceDirectory }) {
  const verification = verifyEvidenceBundle({ repoRoot, evidenceDirectory: sourceDirectory })
  const { aggregateSummary, checksums } = verification
  const currentHead = getHeadSha(repoRoot)
  if (aggregateSummary.metadata.headSha !== currentHead) {
    throw new Error(`Evidence Candidate HEAD ${aggregateSummary.metadata.headSha} does not equal current HEAD ${currentHead}`)
  }
  const expectedPath = expectedDurableEvidencePath(checksums.headSha, checksums.runIdentity)
  if (aggregateSummary.metadata.expectedDurableEvidencePath !== expectedPath) {
    throw new Error('Evidence expected durable path does not match Candidate HEAD and run identity')
  }
  for (const manifest of Object.values(checksums.manifests)) {
    if (sha256(readFileSync(resolve(repoRoot, assertSafeRelativePath(manifest.path, 'Manifest path')))) !== manifest.sha256) {
      throw new Error(`Manifest SHA-256 changed after run: ${manifest.path}`)
    }
  }
  if (sha256(readFileSync(resolve(repoRoot, assertSafeRelativePath(checksums.baseline.path, 'Baseline path')))) !== checksums.baseline.sha256) {
    throw new Error(`Baseline SHA-256 changed after run: ${checksums.baseline.path}`)
  }
  const destination = resolve(repoRoot, assertSafeRelativePath(expectedPath, 'Expected durable evidence path'))
  const allowedRoot = resolve(repoRoot, DURABLE_EVIDENCE_ROOT)
  if (!destination.startsWith(`${allowedRoot}${sep}`)) {
    throw new Error('Expected durable evidence path is outside the approved durable evidence root')
  }
  if (existsSync(destination)) throw new Error(`Durable evidence destination already exists: ${destination}`)
  mkdirSync(destination, { recursive: true })
  for (const relativePath of [...checksums.files.map(({ path }) => path), 'checksums.json']) {
    const target = resolve(destination, relativePath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(resolve(sourceDirectory, relativePath), target)
  }
  const durableVerification = verifyEvidenceBundle({ repoRoot, evidenceDirectory: destination })
  process.stdout.write(`DURABLE EVIDENCE: ${destination}\n`)
  process.stdout.write(`DURABLE EVIDENCE EXISTS: YES\n`)
  process.stdout.write(`EVIDENCE STATUS: DURABLE\n`)
  process.stdout.write(`CHECKSUMS SHA-256: ${durableVerification.checksumsSha256}\n`)
  return { destination, ...durableVerification }
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
      knownEnvironmentBlocked: 0,
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
      knownEnvironmentBlocked: [],
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
    laneStatus: 'BLOCKED',
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
    if (options.promoteRun) {
      promoteEvidenceBundle({ repoRoot, sourceDirectory: options.promoteRun })
      return 0
    }
    if (options.verifyDurable) {
      const verification = verifyEvidenceBundle({ repoRoot, evidenceDirectory: options.verifyDurable })
      const expected = resolve(
        repoRoot,
        assertSafeRelativePath(
          verification.aggregateSummary.metadata.expectedDurableEvidencePath,
          'Expected durable evidence path',
        ),
      )
      if (resolve(options.verifyDurable) !== expected) {
        throw new Error(`Durable evidence is not at its expected path: ${expected}`)
      }
      process.stdout.write(`DURABLE EVIDENCE: ${options.verifyDurable}\n`)
      process.stdout.write('DURABLE EVIDENCE EXISTS: YES\n')
      process.stdout.write('EVIDENCE STATUS: DURABLE\n')
      process.stdout.write(`CHECKSUMS SHA-256: ${verification.checksumsSha256}\n`)
      return 0
    }

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
    const coreManifest = loadLaneManifest({
      repoRoot,
      path: options.coreManifestPath,
      lane: 'CORE',
    })
    const integrationManifest = loadLaneManifest({
      repoRoot,
      path: options.integrationManifestPath,
      lane: 'INTEGRATION',
    })
    const discoveredFiles = discoverRootTests({ repoRoot, testsDir: options.testsDir })
    const knownOutsideManifests = baseline.knownFailures
      .filter(({ file }) => !coreManifest.files.includes(file) && !integrationManifest.files.includes(file))
      .map(({ id, file }) => `${id} ${file}`)
    const manifestAudit = auditLaneManifests({
      coreManifest,
      integrationManifest,
      discoveredFiles,
      integrityErrors: knownOutsideManifests.length > 0
        ? [`active known failures absent from both manifests: ${knownOutsideManifests.join(', ')}`]
        : [],
    })
    const headSha = getHeadSha(repoRoot)
    const timestamp = new Date().toISOString()
    const runIdentity = defaultRunIdentity(timestamp, headSha)
    const evidenceDirectory = prepareEvidenceDirectory({
      repoRoot,
      outputDir: options.outputDir,
      runIdentity,
    })
    let coreResult = null
    let integrationResult = null
    const baselineSha256 = sha256(baselineContent)
    const executionArguments = {
      repoRoot,
      evidenceDirectory,
      baseline,
      baselineAbsolutePath,
      baselineContent,
      headSha,
      timestamp,
      runIdentity,
    }

    if (manifestAudit.exact && ['core', 'aggregate'].includes(options.lane)) {
      coreResult = executeLane({ ...executionArguments, manifestInfo: coreManifest })
    }
    if (manifestAudit.exact && ['integration', 'aggregate'].includes(options.lane)) {
      integrationResult = executeLane({ ...executionArguments, manifestInfo: integrationManifest })
    }

    const evidenceIntegrityErrors = [
      ...(coreResult
        ? collectLaneEvidenceIntegrityErrors({ laneResult: coreResult, manifestInfo: coreManifest, baselineSha256 })
        : []),
      ...(integrationResult
        ? collectLaneEvidenceIntegrityErrors({ laneResult: integrationResult, manifestInfo: integrationManifest, baselineSha256 })
        : []),
    ]
    const manifestIntegrityErrors = collectManifestIntegrityErrors([coreManifest, integrationManifest])
    let aggregateResult = null
    if (options.lane === 'aggregate' || !manifestAudit.exact) {
      aggregateResult = writeAggregateEvidence({
        ...executionArguments,
        coreManifest,
        integrationManifest,
        coreResult,
        integrationResult,
        manifestAudit,
        manifestIntegrityErrors,
        evidenceIntegrityErrors,
      })
    }
    const checksums = writeEvidenceChecksums({
      evidenceDirectory,
      headSha,
      runIdentity,
      baselinePath: toPosix(relative(repoRoot, baselineAbsolutePath)),
      baselineSha256,
      coreManifest,
      integrationManifest,
    })
    process.stdout.write(`RUNTIME EVIDENCE: ${evidenceDirectory}\n`)
    process.stdout.write(`CHECKSUMS: ${checksums.path}\n`)

    if (!manifestAudit.exact) return aggregateResult.summary.exitCode
    if (options.lane === 'core') {
      if (manifestIntegrityErrors.length > 0 || evidenceIntegrityErrors.length > 0) return 2
      return coreResult.summary.exitCode
    }
    if (options.lane === 'integration') {
      if (manifestIntegrityErrors.length > 0 || evidenceIntegrityErrors.length > 0) return 2
      return integrationResult.summary.exitCode
    }
    return aggregateResult.summary.exitCode
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

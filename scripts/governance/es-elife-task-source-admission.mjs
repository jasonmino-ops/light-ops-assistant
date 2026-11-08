import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const task = 'ES-ELIFE-PRODUCT-CATALOG-FIX-01'
const rulePath = `docs/change-gates/source-admission/${task}.json`
const guidePath = `docs/change-gates/source-admission/${task}.md`
const scriptPath = 'scripts/governance/es-elife-task-source-admission.mjs'
const testPath = 'scripts/governance/es-elife-task-source-admission.test.mjs'
const ruleBytes = readFileSync(new URL(`../../${rulePath}`, import.meta.url))
const rule = JSON.parse(ruleBytes)
const scopeScript = 'scripts/guards/check-change-scope.js'
const scopeConfig = 'docs/change-gates/gate-config.json'
const freezeRecord = 'docs/change-gates/exceptions/TASK-CASHIER-SALES-TX-TIMEOUT-01.json'
const frozenTest = 'tests/cashier-realtime-integration.test.ts'
const knownFailures = 'docs/change-gates/ES-PRINT-RC7-KNOWN-TEST-FAILURES.md'
const candidateRef = 'refs/pull/45/head'
const mainRef = 'refs/heads/main'
const releaseRef = 'refs/heads/release'
const fixedOrigin = 'git@github.com:jasonmino-ops/light-ops-assistant.git'
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const ordered = values => [...values].sort()
const fields = output => output.toString().split('\0').filter(Boolean)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(GIT_|NODE_OPTIONS$)/.test(name)))

function git(repo, ...args) {
  return execFileSync('git', ['--no-replace-objects', ...args], { cwd: repo, env, timeout: 20_000 })
}

function blob(repo, ref, path) {
  return git(repo, 'show', `${ref}:${path}`)
}

function changed(repo, before, after) {
  return fields(git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--no-renames',
    '--name-only', '-z', before, after, '--'))
}

function temporary(action) {
  const dir = mkdtempSync(join(tmpdir(), 'es-source-admission-'))
  try {
    return action(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function scopeGuard(repo, paths) {
  return temporary(dir => {
    mkdirSync(join(dir, 'docs/change-gates'), { recursive: true })
    writeFileSync(join(dir, scopeConfig), blob(repo, rule.base, scopeConfig))
    const verifier = join(dir, 'scope.cjs')
    writeFileSync(verifier, blob(repo, rule.base, scopeScript))
    const output = execFileSync(process.execPath, [verifier, '--files', paths.join(',')], {
      cwd: dir, env, encoding: 'utf8', timeout: 20_000,
    })
    assert.equal(output.trimEnd().split('\n').at(-1), 'PASS', 'Scope Guard must pass without an exception')
  })
}

function verifyPathDelta(repo, before, after, paths) {
  assert.deepEqual(ordered(changed(repo, before, after)), ordered(paths), 'exact path delta')
  for (const path of paths) {
    assert.match(git(repo, 'ls-tree', after, '--', path).toString(), /^100644 blob [a-f0-9]{40}\t/,
      `regular file required: ${path}`)
  }
}

function verifyGit(repo) {
  assert.equal(git(repo, 'rev-parse', 'HEAD').toString().trim(), rule.candidate, 'sealed HEAD')
  assert.equal(git(repo, 'status', '--porcelain=v1', '--untracked-files=all').length, 0, 'clean checkout')
  assert.equal(git(repo, 'rev-parse', `${rule.candidate}^{tree}`).toString().trim(), rule.candidateTree, 'sealed tree')
  assert.equal(git(repo, 'rev-parse', `${rule.base}^{tree}`).toString().trim(), rule.baseTree, 'trusted baseline tree')
  assert.equal(git(repo, 'show', '-s', '--format=%P', rule.candidate).toString().trim(),
    `${rule.base} ${rule.documentation}`, 'sealed parents')
  git(repo, 'merge-base', '--is-ancestor', rule.product, rule.candidate)

  const paths = Object.keys(rule.paths)
  verifyPathDelta(repo, rule.base, rule.candidate, paths)
  for (const [path, digest] of Object.entries(rule.paths)) {
    assert.equal(sha256(blob(repo, rule.candidate, path)), digest, `sealed file: ${path}`)
  }
  verifyPathDelta(repo, `${rule.product}^`, rule.product, Object.keys(rule.productPaths))
  for (const [path, digest] of Object.entries(rule.productPaths)) {
    assert.equal(rule.paths[path], digest, `product hash binding: ${path}`)
    assert.equal(sha256(blob(repo, rule.product, path)), digest, `product bytes: ${path}`)
  }

  for (const [path, digest] of Object.entries(rule.unchanged)) {
    for (const ref of [rule.base, rule.candidate]) {
      assert.equal(sha256(blob(repo, ref, path)), digest, `protected verification input: ${path}`)
    }
  }

  const oldGrant = JSON.parse(blob(repo, rule.base, freezeRecord))
  assert.equal(oldGrant.taskId, 'TASK-CASHIER-SALES-TX-TIMEOUT-01')
  assert.equal(oldGrant.authorizedPathSha256[frozenTest], rule.unchanged[frozenTest])
  for (const path of oldGrant.authorizedPaths) {
    assert.ok(!paths.includes(path), `old grant outside this delta: ${path}`)
    assert.equal(sha256(blob(repo, rule.candidate, path)), oldGrant.authorizedPathSha256[path],
      `old grant sealed bytes: ${path}`)
  }

  // Reprove the terminal boundary assertions that did not execute after the
  // legacy whole-diff assertion threw. The complete sealed tree delta above
  // independently excludes every other path, including old Diamond grants.
  assert.ok(!paths.some(path => [
    'app/api/cashier/orders/route.ts', 'app/api/cashier/pending-orders/route.ts', 'app/sale/page.tsx',
  ].includes(path) || ['customer-display', 'pos/session/update', 'migration', 'print'].some(part => path.includes(part))
    || path.startsWith('prisma/')), 'frozen boundary')
  assert.deepEqual(paths.filter(path =>
    path.startsWith('docs/freezes/') || path.startsWith('docs/change-gates/')), [], 'no freeze or authorization edits')
  scopeGuard(repo, paths)

  for (const [path, digest] of Object.entries(rule.catalogEvidence)) {
    assert.equal(sha256(blob(repo, rule.candidate, path)), digest, `catalog evidence: ${path}`)
  }
}

export function verifyClock(now) {
  assert.ok(Number.isFinite(now) && now >= Date.parse('2026-11-08T09:26:43.206Z')
    && now < Date.parse(rule.expiresAt), 'rule outside its evidence window')
}

function readEvidence(dir) {
  assert.deepEqual(ordered(readdirSync(dir)), ordered(Object.keys(rule.evidence)), 'exact evidence inventory')
  const evidence = new Map()
  for (const [file, digest] of Object.entries(rule.evidence)) {
    const path = join(dir, file)
    assert.ok(lstatSync(path).isFile(), `regular evidence file required: ${file}`)
    const bytes = readFileSync(path)
    assert.equal(sha256(bytes), digest, `evidence SHA-256: ${file}`)
    evidence.set(file, bytes.toString('utf8'))
  }
  return evidence
}

function verifyLane(repo, evidence, lane, side, approvedFailures) {
  const expected = rule.lanes[lane][side]
  const report = JSON.parse(evidence.get(expected.summary))
  const raw = evidence.get(expected.raw)
  const { metadata, counts, files } = report
  const expectedFiles = JSON.parse(blob(repo, rule.base, expected.manifestPath)).tests.map(item => item.file)
  const bound = ['runIdentity', 'headSha', 'manifestPath', 'manifestSha256', 'baselineSha256']
  for (const field of bound) assert.equal(metadata[field], expected[field], `${lane}/${side} ${field}`)
  assert.equal(expected.headSha, side === 'candidate' ? rule.candidate : rule.base)
  assert.equal(metadata.lane, lane)
  assert.equal(metadata.rawLogSha256, rule.evidence[expected.raw])
  assert.equal(metadata.manifestSha256, sha256(blob(repo, rule.base, expected.manifestPath)))
  assert.equal(metadata.baselineSha256, sha256(blob(repo, rule.base, knownFailures)))
  assert.equal(report.testEnvironmentHealth, 'PASS')
  assert.equal(report.laneStatus, 'BLOCKED')
  assert.equal(report.exitCode, 1)
  assert.equal(report.authority, 'LANE_ONLY')
  assert.deepEqual(report.runnerErrors, [])
  assert.deepEqual(report.environmentReasons, [])
  assert.deepEqual(ordered(files.collected), ordered(expectedFiles))
  assert.deepEqual(ordered(files.results.map(item => item.file)), ordered(expectedFiles))
  const failed = new Set(approvedFailures.map(item => item.test_id.split(' / ')[0]))
  for (const item of files.results) {
    const fail = failed.has(item.file)
    assert.equal(item.status, fail ? 'FAIL' : 'PASS', `${lane}/${side} outcome for ${item.file}`)
    assert.equal(item.exitStatus, Number(fail))
    assert.equal(item.classification, 'TEST')
    assert.equal(item.signal, null)
  }
  const rawResults = [...raw.matchAll(/^TEST_RESULT\t(PASS|FAIL)\t([^\t\n]+)\t/gm)]
  assert.deepEqual(ordered(rawResults.map(([, status, file]) => `${file}\t${status}`)),
    ordered(files.results.map(item => `${item.file}\t${item.status}`)), `${lane}/${side} raw outcomes`)
  for (const key of ['expected', 'collected', 'executed']) assert.equal(counts[key], expectedFiles.length)
  for (const key of ['skipped', 'uncollected', 'environmentFailures', 'knownEnvironmentBlocked']) assert.equal(counts[key], 0)
  assert.equal(counts.failed, failed.size)
  assert.equal(counts.passed, expectedFiles.length - failed.size)
  return { passed: counts.passed, failed: counts.failed, skipped: 0, status: report.laneStatus }
}

export function verify(repo, evidenceDir, now = Date.now()) {
  assert.equal(rule.schemaVersion, 1)
  assert.equal(rule.task, task)
  assert.equal(rule.risk, 'L2')
  verifyClock(now)
  verifyGit(repo)
  const evidence = readEvidence(evidenceDir)
  const core = JSON.parse(evidence.get('core-failures.json'))
  const integration = JSON.parse(evidence.get('integration-failures.json'))
  const frozen = core.filter(item => item.attribution === 'candidate_triggered')
  assert.equal(core.length, 5)
  assert.equal(integration.length, 2)
  assert.equal(frozen.length, 1)
  assert.ok(frozen[0].test_id.startsWith(`${frozenTest} / `))
  assert.deepEqual(frozen[0].actual, Object.keys(rule.paths), 'complete legacy rejected paths')
  assert.ok(integration.every(item => item.attribution === 'baseline_reproduced'))

  const results = {
    core: verifyLane(repo, evidence, 'CORE', 'candidate', core),
    integration: verifyLane(repo, evidence, 'INTEGRATION', 'candidate', integration),
  }
  verifyLane(repo, evidence, 'CORE', 'baseline', core.filter(item => item.attribution === 'baseline_reproduced'))
  verifyLane(repo, evidence, 'INTEGRATION', 'baseline', integration)

  for (const lane of ['core', 'integration']) {
    const disposition = JSON.parse(evidence.get(`${lane}-disposition.json`))
    assert.equal(disposition.expires_at, rule.expiresAt)
    assert.deepEqual(disposition.candidate, { sha: rule.candidate, tree: rule.candidateTree })
    assert.deepEqual(disposition.trusted_baseline ?? disposition.baseline, { sha: rule.base, tree: rule.baseTree })
    assert.equal(disposition.failure_set_input.sha256, rule.evidence[`${lane}-failures.json`])
    assert.equal(disposition.independent_review, 'PASS_DOCUMENTARY_DISPOSITION_ONLY')
  }
  const browser = JSON.parse(evidence.get('catalog-browser-result.json'))
  assert.equal(evidence.get('catalog-browser-exit.txt').trim(), '0')
  assert.deepEqual(browser.errors, [])
  for (const key of ['skipped', 'unexpected', 'flaky']) assert.equal(browser.stats[key], 0)
  assert.equal(browser.stats.expected, 2)
  const specs = browser.suites.flatMap(suite => suite.specs)
  assert.deepEqual(specs.map(spec => spec.title.split('-')[0]), ['2096', '5000'])
  for (const spec of specs) {
    assert.equal(spec.tests.length, 1)
    assert.equal(spec.tests[0].status, 'expected')
    assert.deepEqual(spec.tests[0].results.map(result => result.status), ['passed'])
  }
  const reuse = JSON.parse(evidence.get('evidence-reuse-readback.json'))
  assert.equal(reuse.candidate, rule.candidate)
  assert.equal(reuse.trusted_main, rule.base)
  assert.equal(reuse.production, rule.releaseBase)
  assert.equal(reuse.candidate_paths_verified, Object.keys(rule.paths).length)
  return results
}

export function verifyActivation(repo, main, release) {
  assert.match(main ?? '', /^[a-f0-9]{40}$/)
  assert.equal(release, rule.releaseBase, 'release base drift')
  assert.notEqual(main, rule.base, 'rule has not entered trusted main')
  git(repo, 'merge-base', '--is-ancestor', rule.base, main)
  verifyPathDelta(repo, rule.base, main, [rulePath, guidePath, scriptPath, testPath])
  assert.deepEqual(blob(repo, main, rulePath), ruleBytes, 'trusted rule bytes')
  assert.deepEqual(blob(repo, main, scriptPath), readFileSync(fileURLToPath(import.meta.url)), 'trusted evaluator bytes')
  for (const [path, digest] of Object.entries(rule.adoptionFiles)) {
    assert.equal(sha256(blob(repo, main, path)), digest, `adopted file: ${path}`)
  }
  const additions = git(repo, 'rev-list', '--topo-order', `${rule.base}..${main}`).toString().trim().split('\n')
  assert.ok(additions.length === 1 || additions.length === 2, 'single governance adoption history')
  const source = additions.at(-1)
  assert.equal(git(repo, 'show', '-s', '--format=%P', source).toString().trim(), rule.base, 'governance source parent')
  if (source !== main) {
    assert.equal(git(repo, 'show', '-s', '--format=%P', main).toString().trim(),
      `${rule.base} ${source}`, 'governance adoption parents')
    assert.equal(git(repo, 'rev-parse', `${main}^{tree}`).toString().trim(),
      git(repo, 'rev-parse', `${source}^{tree}`).toString().trim(), 'governance merge tree equality')
  }
  return main
}

export function verifyRefReadback(output) {
  const entries = output.trim().split('\n').map(line => line.split('\t'))
  assert.equal(entries.length, 3, 'exact GitHub refs')
  assert.ok(entries.every(entry => entry.length === 2 && /^[a-f0-9]{40}$/.test(entry[0])), 'valid GitHub ref entries')
  const refs = new Map(entries.map(([sha, ref]) => [ref, sha]))
  assert.deepEqual(ordered(refs.keys()), ordered([mainRef, releaseRef, candidateRef]), 'exact GitHub ref names')
  assert.equal(refs.get(candidateRef), rule.candidate, 'GitHub candidate ref drift')
  return [refs.get(mainRef), refs.get(releaseRef)]
}

function verifyTrustedMain(repo) {
  const remoteOutput = temporary(dir => execFileSync('git', ['ls-remote', '--exit-code',
    fixedOrigin, mainRef, releaseRef, candidateRef], {
    cwd: dir, env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    timeout: 30_000, encoding: 'utf8',
  }))
  return verifyActivation(repo, ...verifyRefReadback(remoteOutput))
}

function main() {
  const [mode, repo, evidenceDir, ...extra] = process.argv.slice(2)
  assert.ok(['--verify-draft', '--evaluate'].includes(mode) && repo && evidenceDir && !extra.length,
    'usage: node <rule> --verify-draft|--evaluate <sealed-checkout> <evidence-directory>')
  const checkout = resolve(repo)
  const raw = verify(checkout, resolve(evidenceDir))
  const trustedMain = mode === '--evaluate' ? verifyTrustedMain(checkout) : null
  verifyClock(Date.now())
  console.log(JSON.stringify({
    task, risk: rule.risk, candidate: rule.candidate, baseline: rule.base, trustedMain,
    raw, source: trustedMain ? 'PASS' : 'HOLD', mode: trustedMain ? 'ACTIVE' : 'DRAFT_VERIFIED',
  }, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(`SOURCE HOLD: ${error.message}`)
    process.exitCode = 1
  }
}

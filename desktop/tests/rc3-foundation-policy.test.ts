import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Local Git/byte fixtures only. Synthetic approval never touches real refs.
const actual = resolve(__dirname, '../..')
const branch = 'codex/es-desktop-commercial-installer-01-rc3'
const base = 'b692180349b60bf595aeaa6fd6e2fd757762690e'
const mainBase = '3a0d97ad2c72e260596d413573c587f584f55603'
const prefix = 'docs/desktop/es-desktop-commercial-installer-01-rc3-foundation'
const recordPath = `${prefix}.json`, approvalPath = `${prefix}-approval.json`, inputsPath = `${prefix}-build-inputs.json`
const code = ['desktop/scripts/build-single-installer.mjs', 'desktop/scripts/release-foundation.mjs',
  'desktop/scripts/rc3-foundation-policy.mjs', 'desktop/tests/rc3-foundation-policy.test.ts', 'desktop/tests/rc2-foundation-policy.test.ts']
const evidence = 'docs/desktop/es-desktop-commercial-installer-01-review-evidence/rc3/'
const addonRoot = '/Users/jason/E-Shop-Releases/desktop/0.3.0/rc.3/partial-add-on'
const addonManifest = join(addonRoot, 'candidate-build-manifest.json')
const addon = join(addonRoot, 'artifacts/E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.12-x64.exe')
let sandbox: string, repo: string, good: string, trustedMain: string
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
function canonical(v: any): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
const env = () => { const e = { ...process.env }; delete e.GIT_PAGER; return e }
function git(...args: string[]) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: env(), stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
function commit() {
  git('add', '-A')
  git('-c', 'user.name=RC3 Fixture', '-c', 'user.email=fixture@invalid', 'commit', '--allow-empty', '-m', 'TEST FIXTURE ONLY')
  return git('rev-parse', 'HEAD')
}
const read = (p: string) => JSON.parse(readFileSync(join(repo, p), 'utf8'))
const write = (p: string, v: any) => writeFileSync(join(repo, p), `${JSON.stringify(v, null, 2)}\n`)
function trustCurrent() {
  // Never used on actual repo. Preserve required main ancestry in this fixture.
  const t = execFileSync('git', ['-c', 'user.name=RC3 Fixture', '-c', 'user.email=fixture@invalid',
    'commit-tree', git('rev-parse', 'HEAD^{tree}'), '-p', mainBase, '-m', 'SYNTHETIC TRUST ONLY'],
  { cwd: repo, env: env(), encoding: 'utf8' }).trim()
  git('update-ref', 'refs/remotes/origin/main', t)
}
function signFixture() {
  const record = read(recordPath), approval = read(approvalPath)
  approval.payloadSha256 = sha(canonical(record))
  approval.frozenSnapshotSha256 = sha(canonical(record.frozenSnapshot))
  write(approvalPath, approval)
  commit(); trustCurrent()
}
function run(command = 'policy', args: string[] = [], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['desktop/scripts/release-foundation.mjs', command,
    ...(command === 'policy' ? ['--addon-installer', addon, '--addon-manifest', addonManifest] : []), ...args],
  { cwd: repo, env: { ...env(), ...extraEnv }, encoding: 'utf8', timeout: 30000 })
}
function reject(result: ReturnType<typeof run>, message: RegExp) {
  expect(result.status).toBe(1); expect(result.stderr).toMatch(message)
}
beforeAll(() => {
  sandbox = mkdtempSync(join(realpathSync(tmpdir()), 'es-rc3-policy-tests-'))
  repo = join(sandbox, 'repository')
  execFileSync('git', ['clone', '--shared', '--no-checkout', actual, repo], { stdio: 'pipe' })
  git('checkout', '-B', branch, base)
  for (const p of [...code, recordPath, approvalPath, inputsPath]) {
    mkdirSync(resolve(repo, p, '..'), { recursive: true }); cpSync(join(actual, p), join(repo, p))
  }
  writeFileSync(join(repo, '.git/info/exclude'), '/desktop/node_modules\n')
  symlinkSync(join(actual, 'desktop/node_modules'), join(repo, 'desktop/node_modules'), 'dir')
  // The synthetic approval must bind these fixture bytes, including the
  // current dispatcher/build preflight. This never changes a real receipt.
  const sealed = read(recordPath)
  sealed.candidateSourceSha256 = Object.fromEntries(code.map(p => [p, sha(readFileSync(join(repo, p)))]))
  for (const p of Object.keys(sealed.productSourceSha256)) sealed.productSourceSha256[p] = sha(readFileSync(join(repo, p)))
  write(recordPath, sealed)
  const candidate = commit()
  const approval = read(approvalPath)
  approval.status = 'ACTIVE'
  approval.formalApproval = { approvedBy: 'Founder', signedAt: '2026-11-23T00:00:00Z',
    sourceReference: 'SYNTHETIC_TEST_FIXTURE_NOT_A_REAL_APPROVAL', candidateCommit: candidate }
  write(approvalPath, approval); signFixture(); good = git('rev-parse', 'HEAD')
  trustedMain = git('rev-parse', 'origin/main')
  const provider = join(sandbox, 'eshop-windows-provider')
  const providerActual = resolve(actual, '../eshop-windows-provider')
  execFileSync('git', ['clone', '--shared', '--no-checkout', providerActual, provider], { stdio: 'pipe' })
  execFileSync('git', ['checkout', '7785be145d5259991038d17839d322e2694e338c'], { cwd: provider, stdio: 'pipe' })
  cpSync(join(providerActual, 'artifacts'), join(provider, 'artifacts'), { recursive: true })
}, 60000)
beforeEach(() => {
  if (!repo.startsWith(sandbox) || !sandbox.includes('es-rc3-policy-tests-')) throw new Error('fixture boundary')
  // Destructive reset/clean is confined to this newly created disposable fixture.
  git('reset', '--hard', good); git('clean', '-fd'); git('update-ref', 'refs/remotes/origin/main', trustedMain)
})
afterAll(() => { if (sandbox?.includes('es-rc3-policy-tests-')) rmSync(sandbox, { recursive: true, force: true }) })

describe('exact RC3 internal Foundation successor (synthetic trusted activation)', () => {
  it('accepts only the exact signed byte/source/component composition without producing an installer', () => {
    const r = run(); expect(r.stderr).toBe(''); expect(r.status).toBe(0)
    const result = JSON.parse(r.stdout)
    expect(result).toMatchObject({ result: 'PASS', mode: 'INTERNAL TEST ONLY', version: '0.3.0-rc.3',
      published: false, releaseReady: false, installerGenerated: false })
    expect(result.frozenBoundary).toHaveLength(12)
    expect(result.frozenBoundary.every((g: any) => g.status === 'EXACT_RC3_FORMALLY_SIGNED_SNAPSHOT')).toBe(true)
    expect(existsSync(join(repo, 'desktop/release'))).toBe(false)
  })
  it('never treats working-only draft/approval as trusted registration', () => {
    git('update-ref', 'refs/remotes/origin/main', '2f75d95abbb14cb2657bd3ecb9ecbc1359cfbf8e')
    reject(run(), /RC3_TRUSTED_RECORD_NOT_REGISTERED/)
  })
  it('rejects a working repair draft against the predecessor trusted RC3 receipt', () => {
    git('update-ref', 'refs/remotes/origin/main', mainBase)
    reject(run(), /RC3_TRUSTED_RECORD_NOT_REGISTERED/)
  })
  it('does not inherit the first-build RC3 candidate for corrected Product bytes', () => {
    const a = read(approvalPath); a.formalApproval.candidateCommit = '686a51be51bbcaee10abdba256f415d5fd4008e5'
    write(approvalPath, a); signFixture(); reject(run(), /RC3_LINEAGE_MISMATCH/)
  })
  for (const status of ['PENDING_FOUNDER_SIGNATURE', 'CLOSED', 'UNKNOWN']) it(`rejects ${status} approval`, () => {
    const a = read(approvalPath); a.status = status; write(approvalPath, a); commit(); trustCurrent()
    reject(run(), /RC3_FORMAL_APPROVAL_REQUIRED/)
  })
  it('rejects unsigned formal approval', () => {
    const a = read(approvalPath); a.formalApproval.signedAt = null; write(approvalPath, a); commit(); trustCurrent()
    reject(run(), /RC3_FORMAL_APPROVAL_REQUIRED/)
  })
  it('rejects working/trusted record mismatch', () => {
    const r = read(recordPath); r.version = '0.3.0-rc.4'; write(recordPath, r)
    reject(run(), /RC3_TRUSTED_RECORD_MISMATCH/)
  })
  for (const field of ['taskId', 'version', 'productCommit', 'sourceBase', 'mainBase', 'branch']) it(`rejects wrong ${field} even in trusted record`, () => {
    const r = read(recordPath); r[field] = 'unapproved'; write(recordPath, r); signFixture()
    reject(run(), /RC3_EXACT_CANDIDATE_REQUIRED/)
  })
  for (const [field, value] of [['mode', 'commercial'], ['published', true], ['releaseReady', true],
    ['elevated', true], ['installationScope', 'all-users'], ['arch', 'arm64']]) it(`rejects changed build ${field}`, () => {
    const r = read(recordPath); r.build[field as string] = value; write(recordPath, r); signFixture()
    reject(run(), /RC3_BUILD_SCOPE/)
  })
  it('rejects altered trusted source scope', () => {
    const r = read(recordPath); r.candidateSourceSha256['app/api/payments/injected.ts'] = '0'.repeat(64)
    write(recordPath, r); signFixture(); reject(run(), /RC3_SOURCE_SCOPE/)
  })
  for (const mode of ['missing', 'extra']) it(`rejects ${mode} Product source-binding scope`, () => {
    const r = read(recordPath)
    if (mode === 'missing') delete r.productSourceSha256['desktop/build/installer.nsh']
    else r.productSourceSha256['app/api/payments/injected.ts'] = '0'.repeat(64)
    write(recordPath, r); signFixture(); reject(run(), /RC3_PRODUCT_SOURCE_SCOPE/)
  })
  for (const file of ['desktop/build/installer.nsh', 'desktop/scripts/desktop-nsis-profile.mjs']) it(`rejects rebound trusted Product hash mismatch for ${file}`, () => {
    const r = read(recordPath); r.productSourceSha256[file] = '0'.repeat(64)
    write(recordPath, r); signFixture(); reject(run(), /RC3_PRODUCT_SOURCE_MISMATCH/)
  })
  for (const predecessor of ['rc1', 'rc2']) it(`does not inherit the actual ${predecessor} personal receipt for this new frozen successor`, () => {
    const a = read(approvalPath)
    const old = JSON.parse(readFileSync(join(actual, `docs/desktop/es-desktop-commercial-installer-01-${predecessor}-foundation-approval.json`), 'utf8'))
    a.formalApproval = old.formalApproval; write(approvalPath, a); signFixture()
    reject(run(), /RC3_LINEAGE_MISMATCH/)
  })
  it('rejects committed NSIS drift before component admission even with the same version and Add-on', () => {
    const file = 'desktop/build/installer.nsh'
    writeFileSync(join(repo, file), readFileSync(join(repo, file), 'utf8') + '\n; drift\n'); commit()
    reject(run(), /RC3_UNKNOWN_SOURCE_CHANGE/)
  })
  it('rejects unknown committed source, rather than accepting ancestry alone', () => {
    writeFileSync(join(repo, 'unapproved-runtime.js'), 'unknown source'); commit()
    reject(run(), /RC3_UNKNOWN_SOURCE_CHANGE/)
  })
  it('rejects committed drift in an approved source file', () => {
    writeFileSync(join(repo, code[0]), `${readFileSync(join(repo, code[0]), 'utf8')}\n// drift\n`); commit()
    reject(run(), /RC3_SOURCE_HASH_MISMATCH/)
  })
  it('rejects dirty/untracked source', () => {
    writeFileSync(join(repo, 'unapproved-runtime.js'), 'dirty'); reject(run(), /RC3_CLEAN_SOURCE_REQUIRED/)
  })
  it('rejects another branch', () => {
    git('checkout', '-b', 'codex/unapproved'); reject(run(), /RC3_WRONG_BRANCH/); git('checkout', branch)
  })
  it('rejects a mismatched formal frozen snapshot', () => {
    const r = read(recordPath); r.frozenSnapshot[0].fileSha256[Object.keys(r.frozenSnapshot[0].fileSha256)[0]] = '0'.repeat(64)
    write(recordPath, r); signFixture(); reject(run(), /RC3_FROZEN_SNAPSHOT_MISMATCH/)
  })
  it('rejects changed pre-build manifest bytes', () => {
    const m = read(inputsPath); m.installerGenerated = true; write(inputsPath, m); commit(); trustCurrent()
    reject(run(), /RC3_BUILD_INPUT_MANIFEST_MISMATCH/)
  })
  it('rejects a fabricated successful build manifest even when hash-rebound', () => {
    const m = read(inputsPath); m.installerGenerated = true; write(inputsPath, m)
    const r = read(recordPath); r.buildInputManifestSha256 = sha(readFileSync(join(repo, inputsPath)))
    write(recordPath, r); signFixture(); reject(run(), /RC3_BUILD_INPUT_MANIFEST_MISMATCH/)
  })
  for (const file of ['package-lock.json', 'desktop/package-lock.json', 'e-shop-tray/package-lock.json']) it(`rejects false dependency provenance even with a rebound manifest: ${file}`, () => {
    const m = read(inputsPath); m.dependencyLocks[file] = '0'.repeat(64); write(inputsPath, m)
    const r = read(recordPath); r.buildInputManifestSha256 = sha(readFileSync(join(repo, inputsPath)))
    write(recordPath, r); signFixture(); reject(run(), /RC3_DEPENDENCY_LOCK_MISMATCH/)
  })
  for (const mode of ['missing', 'extra']) it(`rejects ${mode} dependency-lock manifest scope`, () => {
    const m = read(inputsPath)
    if (mode === 'missing') delete m.dependencyLocks['desktop/package-lock.json']
    else m.dependencyLocks['unknown/package-lock.json'] = '0'.repeat(64)
    write(inputsPath, m); const r = read(recordPath)
    r.buildInputManifestSha256 = sha(readFileSync(join(repo, inputsPath)))
    write(recordPath, r); signFixture(); reject(run(), /RC3_DEPENDENCY_LOCK_SCOPE/)
  })
  it('rejects unknown Add-on bytes', () => {
    const fake = join(sandbox, 'unknown.exe'); writeFileSync(fake, 'unknown')
    const r = run('policy', ['--addon-installer', fake]); reject(r, /RC3_ADDON_INPUT_MISMATCH/)
  })
  it('rejects an unknown Add-on manifest', () => {
    const fake = join(sandbox, 'unknown-manifest.json'); writeFileSync(fake, JSON.stringify({ testOnly: false }))
    reject(run('policy', ['--addon-manifest', fake]), /RC3_ADDON_INPUT_MISMATCH/)
  })
  it('rejects Provider artifact drift', () => {
    const file = join(sandbox, 'eshop-windows-provider/artifacts/eshop-windows-provider/dist/index.js')
    const original = readFileSync(file)
    try { writeFileSync(file, 'unknown'); reject(run(), /RC3_PROVIDER_ARTIFACT_MISMATCH/) }
    finally { writeFileSync(file, original) }
  })
  it('rejects Git/environment redirection', () => {
    reject(run('policy', [], { GIT_NAMESPACE: 'unapproved' }), /RC3_UNSAFE_BUILD_ENVIRONMENT/)
  })
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_SIGN_CONFIG',
    'AZURE_TENANT_ID', 'APP_BUILDER_BIN', 'ELECTRON_MIRROR', 'USE_SYSTEM_SIGNTOOL', 'NODE_OPTIONS']) {
    it(`rejects pre-build signing/loader/builder override ${key}`, () => {
      // NODE_OPTIONS must be a valid option so Node can reach the policy guard.
      const value = key === 'NODE_OPTIONS' ? '--no-warnings' : 'SYNTHETIC_TEST_VALUE'
      reject(run('policy', [], { [key]: value }), /RC3_UNSAFE_BUILD_ENVIRONMENT/)
    })
  }
  it('rejects a candidate signature tied to the wrong source lineage', () => {
    const a = read(approvalPath); a.formalApproval.candidateCommit = mainBase
    write(approvalPath, a); commit(); trustCurrent(); reject(run(), /RC3_LINEAGE_MISMATCH/)
  })
  it('rejects substituted Provider source even with a rebound trusted manifest', () => {
    const m = read(inputsPath); m.provider.sourceCommit = mainBase; write(inputsPath, m)
    const r = read(recordPath); r.buildInputManifestSha256 = sha(readFileSync(join(repo, inputsPath)))
    write(recordPath, r); signFixture(); reject(run(), /RC3_COMPONENT_SOURCE_MISMATCH/)
  })
  it('rejects invented Add-on authorization mapping even with rebound trusted inputs', () => {
    const m = read(inputsPath); m.addon.approvedContentMappingSha256 = '0'.repeat(64); write(inputsPath, m)
    const r = read(recordPath); r.buildInputManifestSha256 = sha(readFileSync(join(repo, inputsPath)))
    write(recordPath, r); signFixture(); reject(run(), /RC3_ADDON_AUTHORIZATION_REQUIRED/)
  })
  for (const flag of ['--distribution-class', '--baseline', '--force', '--rehearsal', '--release']) it(`rejects bypass argument ${flag}`, () => {
    reject(run('policy', [flag, 'unapproved']), /RC3_INPUT_ARGUMENTS_REQUIRED/)
  })
  it('rejects the exact RC4 successor without its own trusted receipt', () => {
    const p = read('desktop/package.json'); p.version = '0.3.0-rc.4'; write('desktop/package.json', p)
    // This disposable fixture supplies only the dispatcher module, never an
    // RC4 record or receipt. The real trusted registry must still reject it.
    cpSync(join(actual, 'desktop/scripts/rc4-foundation-policy.mjs'), join(repo, 'desktop/scripts/rc4-foundation-policy.mjs'))
    reject(run(), /RC4_TRUSTED_RECORD_NOT_REGISTERED/)
  })
  for (const version of ['0.3.0-rc.5', '0.3.1-rc.1', '0.3.0-RC.2', '0.4.0-rc.1']) it(`keeps other RC ${version} rejected`, () => {
    const p = read('desktop/package.json'); p.version = version; write('desktop/package.json', p)
    reject(run(), /unsupported prerelease channel/)
  })
  for (const command of ['write', 'verify']) it(`never authorizes formal ${command}`, () => {
    reject(run(command), /unsupported prerelease channel/)
  })
  it('keeps the old Phase1 channel/version rejection in its original function body', () => {
    const old = execFileSync('git', ['show', `${base}:desktop/scripts/release-foundation.mjs`], { cwd: actual, encoding: 'utf8' })
    const now = readFileSync(join(repo, 'desktop/scripts/release-foundation.mjs'), 'utf8')
    for (const fn of ['inferReleaseChannel', 'validateBuilderConfig']) {
      const body = (s: string) => s.split(`function ${fn}(`)[1].split('\n}\n')[0]
      expect(body(now)).toBe(body(old))
    }
    expect(now).toContain("facts.channel !== 'pilot' || facts.version !== PHASE1_DESKTOP_VERSION")
    expect(now).toContain("const PHASE1_DESKTOP_VERSION = '0.2.0-pilot.2'")
  })
  for (const version of ['0.2.0-pilot.2', '0.2.0-pilot.3', '0.3.0']) it(`preserves actual old policy result for ${version}`, () => {
    const p = read('desktop/package.json'); p.version = version; write('desktop/package.json', p)
    const original = execFileSync('git', ['show', `${base}:desktop/scripts/release-foundation.mjs`], { cwd: actual })
    const baselineScript = join(repo, 'desktop/scripts/phase1-baseline-fixture.mjs')
    writeFileSync(baselineScript, original)
    const baseline = spawnSync(process.execPath, [baselineScript, 'policy'], { cwd: repo, env: env(), encoding: 'utf8' })
    const candidate = run()
    expect(candidate.status).toBe(baseline.status)
    expect(candidate.stderr).toBe(baseline.stderr)
    expect(candidate.stderr).toMatch(version === '0.2.0-pilot.2' ? /frozen boundary changed:/ : /Phase 1 must use/)
  })
  it('guards the original Desktop command before compilation or staging', () => {
    const s = readFileSync(join(repo, code[0]), 'utf8')
    expect(s.indexOf("'scripts/release-foundation.mjs', 'policy'")).toBeLessThan(s.indexOf('const staged = await stageSingleInstallerInputs(options)'))
    expect(s.indexOf("'scripts/release-foundation.mjs', 'policy'")).toBeLessThan(s.indexOf("run('npm', ['run', 'compile']"))
    expect(s).toContain('internalEnvironment = candidateEnvironment()')
    expect(s).toContain("run('npx', ['electron-builder', '--win', '--x64', '--publish', 'never'], desktopDir, internalEnvironment)")
  })
})

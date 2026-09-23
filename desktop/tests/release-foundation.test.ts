import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const script = join(__dirname, '..', 'scripts', 'release-foundation.mjs')
const desktopRoot = join(__dirname, '..')
const repositoryRoot = join(desktopRoot, '..')
const desktopVersion = '0.2.0-pilot.2'
const installer = `E-Shop-Desktop-Setup-${desktopVersion}.exe`
const p2TaskId = 'ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION'
const p2SourceCommit = 'db56bb9035afd74c28d26df42a7f7de89843bbce'
const productionSha = 'b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4'

function gitObjectAvailable(commit: string) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: repositoryRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function trustedRiskRegisterAvailable() {
  try {
    execFileSync('git', ['show', `origin/main:docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json`], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function trustedRiskRegisterMatchesWorkingTree() {
  try {
    const trusted = execFileSync('git', ['show', 'origin/main:docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    const working = readFileSync(join(repositoryRoot, 'docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json'), 'utf8')
    return trusted === working
  } catch {
    return false
  }
}

function runReleaseFoundation(args: string[], options: { cwd?: string } = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: options.cwd ?? desktopRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
      GITHUB_WORKFLOW: 'test-workflow',
      GITHUB_RUN_ID: '12345',
      BUILD_TIMESTAMP: '2026-07-18T00:00:00.000Z',
    },
  })
}

function makeReleaseDir(metadataName = 'latest.yml') {
  const dir = mkdtempSync(join(tmpdir(), 'ep-mb3-07a-release-'))
  writeFileSync(join(dir, installer), 'installer-bytes')
  writeFileSync(join(dir, `${installer}.blockmap`), 'blockmap-bytes')
  writeFileSync(
    join(dir, metadataName),
    [
      `version: ${desktopVersion}`,
      'files:',
      `  - url: ${installer}`,
      '    sha512: test-sha512',
      `path: ${installer}`,
      'sha512: test-sha512',
      '',
    ].join('\n'),
  )
  return dir
}

describe('EP-MB3-07A release foundation policy', () => {
  it('keeps desktop/package.json as the unique Desktop version source', () => {
    const output = runReleaseFoundation(['policy'])
    const result = JSON.parse(output)
    expect(result.versionSource).toBe('desktop/package.json')
    expect(result.desktopVersion).toBe(desktopVersion)
    expect(result.releaseChannel).toBe('pilot')
    expect(result.defaultRuntimeChannel).toBe('stable')
    expect(result.distributionClass).toBe('unsigned-internal')
    expect(result.tag).toBe(`desktop-v${desktopVersion}`)
    expect(result.installerName).toBe(installer)
    expect(result.updateMetadataName).toBe('latest.yml')
    expect(result.frozenBoundary.every((group: { status: string }) => group.status === 'PASS')).toBe(true)
  })

  it('accepts only the exact authorized launch-context successor bytes', () => {
    const output = runReleaseFoundation(['policy'])
    const result = JSON.parse(output)
    const authorized = result.frozenBoundary
      .filter((group: { authorizedSuccessorSnapshot?: string }) => group.authorizedSuccessorSnapshot)
      .map((group: { label: string; authorizedSuccessorSnapshot: string }) => ({
        label: group.label,
        snapshot: group.authorizedSuccessorSnapshot,
      }))

    expect(authorized).toEqual([
      { label: 'main startup gate', snapshot: 'cb55c5a9e78cb7f80c8295a0387bb82cb0af8494' },
      { label: 'WindowManager', snapshot: '17c764427f1e53288dedb82a1965b1365c1ded3d' },
      { label: 'Prisma', snapshot: 'cb55c5a9e78cb7f80c8295a0387bb82cb0af8494' },
      { label: 'cashier/customer/mobile business', snapshot: 'b936b5e4c5616859c58de3762474ab8cc3356ea3' },
    ])
    expect(() => runReleaseFoundation([
      'policy',
      '--baseline',
      '439dcac561734d07b9e022c8d99e693c99d26794',
    ])).toThrow(/frozen boundary changed: main startup gate, WindowManager/)
  })

  it('writes and verifies release provenance plus SHA manifest without secrets', () => {
    const releaseDir = makeReleaseDir()
    const output = runReleaseFoundation(['write', '--release-dir', releaseDir])
    const result = JSON.parse(output)
    expect(result.result).toBe('PASS')
    expect(result.shaEntries).toBe(5)
    expect(readdirSync(releaseDir).sort()).toEqual([
      'SHA256SUMS.txt',
      `${installer}.blockmap`,
      installer,
      'latest.yml',
      `release-notes-${desktopVersion}.md`,
      `release-provenance-${desktopVersion}.json`,
    ].sort())

    const provenance = JSON.parse(readFileSync(join(releaseDir, result.provenance), 'utf8'))
    expect(provenance.schemaVersion).toBe('ep-mb3-07a.release-provenance.v1')
    expect(provenance.distributionClass).toBe('unsigned-internal')
    expect(provenance.signingStatus).toBe('unsigned-internal')
    expect(JSON.stringify(provenance)).not.toMatch(/TOKEN|SECRET|PASSWORD|Authorization|Bearer/)

    const verifyOutput = runReleaseFoundation(['verify', '--release-dir', releaseDir])
    expect(JSON.parse(verifyOutput).result).toBe('PASS')
  })

  it('rejects signed-commercial claims during Phase 1', () => {
    const releaseDir = makeReleaseDir()
    expect(() =>
      runReleaseFoundation(['write', '--release-dir', releaseDir, '--distribution-class', 'signed-commercial']),
    ).toThrow(/unsigned-internal/)
  })

  it('rejects tampered assets when SHA manifest no longer matches', () => {
    const releaseDir = makeReleaseDir()
    runReleaseFoundation(['write', '--release-dir', releaseDir])
    writeFileSync(join(releaseDir, 'latest.yml'), 'tampered')
    expect(() => runReleaseFoundation(['verify', '--release-dir', releaseDir])).toThrow(/SHA mismatch/)
  })

  it('rejects builder-debug.yml as an unexpected published asset', () => {
    const releaseDir = makeReleaseDir()
    runReleaseFoundation(['write', '--release-dir', releaseDir])
    writeFileSync(join(releaseDir, 'builder-debug.yml'), 'diagnostic output')
    expect(() => runReleaseFoundation(['verify', '--release-dir', releaseDir])).toThrow(
      /release asset allowlist mismatch.*builder-debug\.yml/,
    )
  })

  it('removes only electron-builder diagnostic metadata before release verification', () => {
    const workflow = readFileSync(join(repositoryRoot, '.github/workflows/desktop-windows-build.yml'), 'utf8')
    const cleanupStep = workflow.indexOf('Remove electron-builder diagnostic metadata')
    const diagnosticPath = workflow.indexOf('$diagnostic = ".\\release\\builder-debug.yml"')
    const exactRemoval = workflow.indexOf('Remove-Item -LiteralPath $diagnostic -Force')
    const manifestStep = workflow.indexOf('Generate release foundation manifests')

    expect(cleanupStep).toBeGreaterThan(-1)
    expect(diagnosticPath).toBeGreaterThan(cleanupStep)
    expect(exactRemoval).toBeGreaterThan(diagnosticPath)
    expect(manifestStep).toBeGreaterThan(exactRemoval)
  })

  it('rejects arbitrary extra files as unexpected published assets', () => {
    const releaseDir = makeReleaseDir()
    runReleaseFoundation(['write', '--release-dir', releaseDir])
    writeFileSync(join(releaseDir, 'operator-note.txt'), 'not a formal release asset')
    expect(() => runReleaseFoundation(['verify', '--release-dir', releaseDir])).toThrow(
      /release asset allowlist mismatch.*operator-note\.txt/,
    )
  })

  it('rejects missing allowlisted published assets', () => {
    const releaseDir = makeReleaseDir()
    runReleaseFoundation(['write', '--release-dir', releaseDir])
    unlinkSync(join(releaseDir, 'latest.yml'))
    expect(() => runReleaseFoundation(['verify', '--release-dir', releaseDir])).toThrow(
      /release asset allowlist mismatch.*latest\.yml/,
    )
  })

  it('rejects duplicate asset filenames in release directories', () => {
    const releaseDir = makeReleaseDir()
    mkdirSync(join(releaseDir, 'nested'))
    writeFileSync(join(releaseDir, 'nested', 'ignored.txt'), 'not a release asset')
    runReleaseFoundation(['write', '--release-dir', releaseDir])
    const shaManifest = readFileSync(join(releaseDir, 'SHA256SUMS.txt'), 'utf8')
    writeFileSync(join(releaseDir, 'SHA256SUMS.txt'), `${shaManifest}${shaManifest.split('\n')[0]}\n`)
    expect(() => runReleaseFoundation(['verify', '--release-dir', releaseDir])).toThrow(/duplicate release asset filename/)
  })
})

describe('risk-based source acceptance policy', () => {
  it.skipIf(!gitObjectAvailable(p2SourceCommit) || !trustedRiskRegisterAvailable() || !trustedRiskRegisterMatchesWorkingTree())('accepts the exact registered P2 source pilot without packaging', () => {
    const output = runReleaseFoundation([
      'source-policy',
      '--task-id',
      p2TaskId,
      '--source-commit',
      p2SourceCommit,
      '--production-sha',
      productionSha,
    ])
    const result = JSON.parse(output)
    expect(result.mode).toBe('SOURCE_ACCEPTANCE')
    expect(result.result).toBe('PASS')
    expect(result.taskId).toBe(p2TaskId)
    expect(result.fieldStatus).toBe('MILESTONE_FIELD_PENDING')
    expect(result.milestoneTarget).toBe('P3-B Desktop Pilot')
    expect(result.installerRequired).toBe(false)
    expect(result.fieldVerified).toBe(false)
    expect(result.productionReady).toBe(false)
  })

  it('fails closed for an unregistered source task', () => {
    expect(() => runReleaseFoundation([
      'source-policy',
      '--task-id',
      'ES-UNREGISTERED-SOURCE-TASK',
      '--source-commit',
      p2SourceCommit,
      '--production-sha',
      productionSha,
    ])).toThrow(/unregistered source acceptance task/)
  })

  it('fails closed when the registered source commit is substituted', () => {
    expect(() => runReleaseFoundation([
      'source-policy',
      '--task-id',
      p2TaskId,
      '--source-commit',
      '150524da711bbb886afed086064ad1965b6d80d7',
      '--production-sha',
      productionSha,
    ])).toThrow(/source commit does not match registered task/)
  })

  it.skipIf(!trustedRiskRegisterAvailable() || !trustedRiskRegisterMatchesWorkingTree())('fails closed when the source commit is not descended from the trusted baseline', () => {
    expect(() => runReleaseFoundation([
      'source-policy',
      '--task-id',
      p2TaskId,
      '--source-commit',
      p2SourceCommit,
      '--production-sha',
      p2SourceCommit,
    ])).toThrow(/Production SHA is not an ancestor/)
  })

  it.skipIf(!trustedRiskRegisterAvailable() || trustedRiskRegisterMatchesWorkingTree())('fails closed before integration when the working register differs from trusted origin/main', () => {
    expect(() => runReleaseFoundation([
      'source-policy',
      '--task-id',
      p2TaskId,
      '--source-commit',
      p2SourceCommit,
      '--production-sha',
      productionSha,
    ])).toThrow(/working-tree risk-based delivery register differs from trusted origin\/main/)
  })
})

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const script = join(__dirname, '..', 'scripts', 'release-foundation.mjs')
const desktopRoot = join(__dirname, '..')
const repositoryRoot = join(desktopRoot, '..')
const desktopVersion = '0.3.0-commercial-pilot.1'
const installer = `E-Shop-Desktop-Setup-${desktopVersion}-x64.exe`
const p2TaskId = 'ES-DESKTOP-UX-01-P2-CASHIER-MINIMAL-SIMPLIFICATION'
const p2SourceCommit = 'db56bb9035afd74c28d26df42a7f7de89843bbce'
const productionSha = 'b4ff8e1dfbc1f095811b247e63e2bdf04534f5a4'
const nonAncestorProductionSha = '3110af05a4e38b433bb4e1bd5b1bbea80dfe0ae6'

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

function jsonDocumentsMatch(left: string, right: string) {
  return JSON.stringify(JSON.parse(left)) === JSON.stringify(JSON.parse(right))
}

function trustedRiskRegisterMatchesWorkingTree() {
  try {
    const trusted = execFileSync('git', ['show', 'origin/main:docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    })
    const working = readFileSync(
      join(repositoryRoot, 'docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json'),
      'utf8',
    )
    return jsonDocumentsMatch(trusted, working)
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
      ESHOP_PROVIDER_ARTIFACT_MANIFEST_SHA256: 'a'.repeat(64),
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
  it('compares trusted JSON registers semantically across LF and CRLF checkouts', () => {
    expect(jsonDocumentsMatch('{\n  "status": "ACTIVE"\n}\n', '{\r\n  "status": "ACTIVE"\r\n}\r\n')).toBe(true)
  })

  it('keeps generated Contract output deterministic before clean-worktree policy tests on Windows', () => {
    for (const workflow of ['desktop-release-pilot.yml', 'desktop-windows-build.yml']) {
      const source = readFileSync(join(repositoryRoot, '.github', 'workflows', workflow), 'utf8')
      expect(source).toContain('$contractOut = Join-Path $env:RUNNER_TEMP "hrt-contract-dist"')
      expect(source).toContain('npm run build -- --newLine lf --outDir $contractOut')
    }
  })

  it('resolves renderer build tooling from the pinned Desktop install on Windows', () => {
    for (const workflow of ['desktop-release-pilot.yml', 'desktop-windows-build.yml']) {
      const source = readFileSync(join(repositoryRoot, '.github', 'workflows', workflow), 'utf8')
      const rendererInstall = source.indexOf('Install renderer source dependencies')
      const compile = source.indexOf('Compile main & preload')

      expect(rendererInstall).toBeGreaterThan(-1)
      expect(source.indexOf('npm ci --omit=dev --ignore-scripts', rendererInstall)).toBeGreaterThan(rendererInstall)
      expect(compile).toBeGreaterThan(rendererInstall)
      expect(source).toContain('$env:NODE_PATH = (Resolve-Path .\\node_modules).Path')
      expect(source).toContain('npm run compile')
    }
  })

  it('keeps desktop/package.json as the unique Desktop version source', () => {
    const output = runReleaseFoundation(['policy'])
    const result = JSON.parse(output)
    expect(result.versionSource).toBe('desktop/package.json')
    expect(result.desktopVersion).toBe(desktopVersion)
    expect(result.releaseChannel).toBe('commercial-pilot')
    expect(result.defaultRuntimeChannel).toBe('stable')
    expect(result.distributionClass).toBe('unsigned-internal')
    expect(result.tag).toBe(`desktop-v${desktopVersion}`)
    expect(result.installerName).toBe(installer)
    expect(result.updateMetadataName).toBe('latest.yml')
    expect(result.frozenBoundary.every((group: { status: string }) => group.status === 'PASS')).toBe(true)
  })

  it('records only the exact Founder-authorized Commercial Pilot startup boundary', () => {
    const output = runReleaseFoundation(['policy'])
    const result = JSON.parse(output)
    const authorized = result.frozenBoundary.filter((group: { authorizedCommercialPilotScope?: boolean }) =>
      group.authorizedCommercialPilotScope)
    expect(authorized).toEqual([
      expect.objectContaining({
        label: 'ActivationRuntime', changed: ['desktop/src/main/activation/activationRuntime.ts'], status: 'PASS',
        authorizedPathSha256: {
          'desktop/src/main/activation/activationRuntime.ts': '9f08e00cfb59d0d41015a5a1c20d0627885b6b05a1548cde5049d46fc9b9b8a9',
        },
      }),
      expect.objectContaining({
        label: 'CredentialStore', changed: ['desktop/src/main/activation/credentialStore.ts'], status: 'PASS',
        authorizedPathSha256: {
          'desktop/src/main/activation/credentialStore.ts': 'f0dafcb93de98d69eab1798c86e61e48b7e33e75e688667cbfd77a8a8c787103',
        },
      }),
      expect.objectContaining({
        label: 'main startup gate', changed: ['desktop/src/main/main.ts'], status: 'PASS',
        authorizedPathSha256: {
          'desktop/src/main/main.ts': 'aef3d6426a3be6dee55426e3104071f6118281c37278ee49ab53be07e375113a',
        },
      }),
      expect.objectContaining({
        label: 'WindowManager', changed: ['desktop/src/main/windowManager.ts'], status: 'PASS',
        authorizedPathSha256: {
          'desktop/src/main/windowManager.ts': '14497c1c0eac104fe70586a4bd40201cc5284425e3051e9059d7b70c39fce590',
        },
      }),
    ])
    expect(() => runReleaseFoundation([
      'policy',
      '--baseline',
      '439dcac561734d07b9e022c8d99e693c99d26794',
    ])).toThrow(/frozen boundary changed:/)
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
    expect(provenance.releaseChannel).toBe('commercial-pilot')
    expect(provenance.releaseStatus).toBe('COMMERCIAL_PILOT_CANDIDATE')
    expect(provenance.distributionClass).toBe('unsigned-internal')
    expect(provenance.signingStatus).toBe('unsigned-internal')
    expect(provenance.providerArtifactManifestSha256).toBe('a'.repeat(64))
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
  it.skipIf(!gitObjectAvailable(p2SourceCommit) || !trustedRiskRegisterAvailable() || !trustedRiskRegisterMatchesWorkingTree())('rejects a historical P2 source pilot after its exact authorization is closed', () => {
    expect(() => runReleaseFoundation([
      'source-policy',
      '--task-id',
      p2TaskId,
      '--source-commit',
      p2SourceCommit,
      '--production-sha',
      productionSha,
    ])).toThrow(/scope exception is not the exact active authorization/)
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

  it.skipIf(!trustedRiskRegisterAvailable() || !trustedRiskRegisterMatchesWorkingTree())('fails closed when the declared Production SHA is outside current main lineage', () => {
    expect(() => runReleaseFoundation([
      'source-policy',
      '--task-id',
      p2TaskId,
      '--source-commit',
      p2SourceCommit,
      '--production-sha',
      nonAncestorProductionSha,
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

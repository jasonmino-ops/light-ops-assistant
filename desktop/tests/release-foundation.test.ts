import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const script = join(__dirname, '..', 'scripts', 'release-foundation.mjs')
const desktopRoot = join(__dirname, '..')

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

function makeReleaseDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ep-mb3-07a-release-'))
  const installer = 'E-Shop-Desktop-Setup-0.2.0-pilot.1.exe'
  writeFileSync(join(dir, installer), 'installer-bytes')
  writeFileSync(join(dir, `${installer}.blockmap`), 'blockmap-bytes')
  writeFileSync(
    join(dir, 'pilot.yml'),
    [
      'version: 0.2.0-pilot.1',
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
    expect(result.desktopVersion).toBe('0.2.0-pilot.1')
    expect(result.releaseChannel).toBe('pilot')
    expect(result.defaultRuntimeChannel).toBe('stable')
    expect(result.distributionClass).toBe('unsigned-internal')
    expect(result.tag).toBe('desktop-v0.2.0-pilot.1')
    expect(result.installerName).toBe('E-Shop-Desktop-Setup-0.2.0-pilot.1.exe')
    expect(result.updateMetadataName).toBe('pilot.yml')
    expect(result.frozenBoundary.every((group: { status: string }) => group.status === 'PASS')).toBe(true)
  })

  it('writes and verifies release provenance plus SHA manifest without secrets', () => {
    const releaseDir = makeReleaseDir()
    const output = runReleaseFoundation(['write', '--release-dir', releaseDir])
    const result = JSON.parse(output)
    expect(result.result).toBe('PASS')
    expect(result.shaEntries).toBe(5)

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
    writeFileSync(join(releaseDir, 'pilot.yml'), 'tampered')
    expect(() => runReleaseFoundation(['verify', '--release-dir', releaseDir])).toThrow(/SHA mismatch/)
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

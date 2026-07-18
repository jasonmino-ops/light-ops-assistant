import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const script = join(__dirname, '..', 'scripts', 'release-foundation.mjs')
const desktopRoot = join(__dirname, '..')
const desktopVersion = '0.2.0-pilot.2'
const installer = `E-Shop-Desktop-Setup-${desktopVersion}.exe`

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

  it('allows non-published electron-builder extras only for build-output verification', () => {
    const releaseDir = makeReleaseDir()
    runReleaseFoundation(['write', '--release-dir', releaseDir])
    writeFileSync(join(releaseDir, 'builder-debug.yml'), 'diagnostic output')
    const output = runReleaseFoundation(['verify', '--release-dir', releaseDir, '--allow-build-output-extras'])
    const result = JSON.parse(output)
    expect(result.result).toBe('PASS')
    expect(result.shaEntries).toBe(5)
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

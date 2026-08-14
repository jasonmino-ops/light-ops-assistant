import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { validateInstallerScript, validateMvpPayload } from '../tools/e-shop-installer/phase1/build.mjs'

const installerScript = readFileSync(new URL('../tools/e-shop-installer/phase1/installer.nsi', import.meta.url), 'utf8')
const buildScript = readFileSync(new URL('../tools/e-shop-installer/phase1/build.mjs', import.meta.url), 'utf8')

function hash(value) {
  return createHash('sha256').update(value).digest('hex')
}

function write(path, value = 'fixture') {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, value)
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'eshop-installer-phase1-'))
  const files = [
    'E-Shop-V1-Setup.ps1',
    'app/eshop-v1-setup.cjs',
    'runtime/node.exe',
    'runtime/LICENSE',
    'setup-payload/E-Shop-DianXiaoEr-Setup-0.4.7-x64.exe',
    'setup-payload/qz-tray-2.2.6.exe',
    'setup-payload/certificate-package/manifest.json',
    'setup-payload/certificate-package/eshop-root-ca.crt',
    'Drivers/Rongta/README.txt',
    'Drivers/Xprinter/README.txt',
  ]
  const entries = []
  for (const path of files) {
    const value = path.endsWith('.exe') ? Buffer.from('MZfixture') : Buffer.from(`fixture:${path}`)
    write(join(dir, ...path.split('/')), value)
    entries.push({ path, sha256: hash(value) })
  }
  write(join(dir, 'MANIFEST.json'), JSON.stringify({
    schema: 'eshop.setup-mvp-candidate/v1',
    sourceCommit: '0'.repeat(40),
    candidateVersion: 'MVP-TEST',
    files: entries,
  }))
  return dir
}

async function main() {
  assert.match(installerScript, /MUI_PAGE_WELCOME/)
  assert.match(installerScript, /MUI_PAGE_INSTFILES/)
  assert.match(installerScript, /MUI_PAGE_FINISH/)
  assert.match(installerScript, /RequestExecutionLevel admin/)
  assert.match(installerScript, /ShowInstDetails nevershow/)
  assert.doesNotMatch(installerScript, /\$PROGRAMDATA(?:\\|\b)/)
  assert.doesNotMatch(installerScript, /\$COMMONPROGRAMDATA(?:\\|\b)/)
  assert.doesNotMatch(installerScript, /\$COMMONAPPDATA(?:\\|\b)/)
  assert.doesNotMatch(installerScript, /^\s*InstallDir\b/m)
  assert.match(installerScript, /ExpandEnvStrings \$INSTDIR "%ProgramData%\\E-Shop\\Installer\\MVP"/)
  assert.match(installerScript, /Windows ProgramData could not be resolved/)
  assert.match(installerScript, /Windows ProgramData was not expanded/)
  assert.match(installerScript, /Windows ProgramData did not resolve to an absolute path/)
  assert.match(installerScript, /SetOutPath "\$INSTDIR"/)
  assert.match(installerScript, /-File "\$INSTDIR\\E-Shop-V1-Setup\.ps1"/)
  assert.match(installerScript, /File \/r/)
  assert.match(installerScript, /nsExec::ExecToStack/)
  assert.match(installerScript, /-WindowStyle Hidden/)
  assert.match(installerScript, /E-Shop-V1-Setup\.ps1/)
  assert.match(installerScript, /Drivers\\Rongta/)
  assert.match(installerScript, /Drivers\\Xprinter/)
  assert.match(installerScript, /CopyFiles \/SILENT/)
  assert.doesNotMatch(installerScript, /192\.168\.18\.49|RongtaUSB PORT:/i)
  assert.doesNotMatch(installerScript, /RongTaDriverInstall\.exe|芯烨.*\.(?:exe|msi)/i)
  assert.match(buildScript, /NSIS 3\.0\.4\.1/)
  assert.match(buildScript, /E-Shop-V5-Setup\.exe/)
  assert.doesNotMatch(buildScript, /join\(outputDir, 'E-Shop-V1-Setup\.exe'\)/)
  assert.doesNotMatch(buildScript, /join\(outputDir, 'E-Shop-V2-Setup\.exe'\)/)
  assert.doesNotMatch(buildScript, /join\(outputDir, 'E-Shop-V3-Setup\.exe'\)/)
  assert.doesNotMatch(buildScript, /join\(outputDir, 'E-Shop-V4-Setup\.exe'\)/)
  assert.match(buildScript, /private material is forbidden/)
  assert.match(buildScript, /driver payload must remain external/)
  assert.deepEqual(validateInstallerScript(), {
    scriptPath: new URL('../tools/e-shop-installer/phase1/installer.nsi', import.meta.url).pathname,
  })

  const dir = fixture()
  try {
    const result = validateMvpPayload(dir)
    assert.equal(result.manifest.sourceCommit, '0'.repeat(40))

    write(join(dir, 'Drivers', 'Rongta', 'RongTaDriverInstall.exe'), Buffer.from('MZexternal'))
    assert.throws(() => validateMvpPayload(dir), /driver payload must remain external/)
    rmSync(join(dir, 'Drivers', 'Rongta', 'RongTaDriverInstall.exe'))

    write(join(dir, 'app', 'eshop-v1-setup.cjs'), 'const endpoint = "192.168.18.49"')
    assert.throws(() => validateMvpPayload(dir), /MVP payload hash mismatch|fixed golden-machine environment/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  console.log('E-Shop Installer Packaging Phase 1 tests passed')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

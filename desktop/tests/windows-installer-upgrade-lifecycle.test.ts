import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(__dirname, '..')
const installerInclude = readFileSync(join(desktopRoot, 'build', 'installer.nsh'), 'utf8')
const verifierPath = join(desktopRoot, 'scripts', 'verify-nsis-installer.mjs')
const verifierSource = readFileSync(verifierPath, 'utf8')
const builderTemplateRoot = join(desktopRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
const installerTemplate = readFileSync(join(builderTemplateRoot, 'installer.nsi'), 'utf8')
const installSection = readFileSync(join(builderTemplateRoot, 'installSection.nsh'), 'utf8')
const uninstallerTemplate = readFileSync(join(builderTemplateRoot, 'uninstaller.nsh'), 'utf8')
const processTemplate = readFileSync(
  join(builderTemplateRoot, 'include', 'allowOnlyOneInstallerInstance.nsh'),
  'utf8',
)

type NsisVerifier = {
  crc32(bytes: Buffer): number
  inspectNsisInstaller(bytes: Buffer): {
    installer: { crc32: string; flags: number }
    uninstaller: { crc32: string; flags: number }
  }
}

function macroBody(name: string): string {
  const match = installerInclude.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`))
  if (!match) throw new Error(`missing macro ${name}`)
  return match[1]
}

function instructionsOnly(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith(';'))
    .join('\n')
}

function minimalPeStub(): Buffer {
  const stub = Buffer.alloc(1024)
  const pe = 0x80
  const optional = pe + 24
  const table = optional + 224
  stub.writeUInt16LE(0x5a4d, 0)
  stub.writeUInt32LE(pe, 60)
  stub.writeUInt32LE(0x4550, pe)
  stub.writeUInt16LE(0x14c, pe + 4)
  stub.writeUInt16LE(1, pe + 6)
  stub.writeUInt16LE(224, pe + 20)
  stub.writeUInt16LE(0x102, pe + 22)
  stub.writeUInt16LE(0x10b, optional)
  stub.writeUInt32LE(512, optional + 60)
  stub.writeUInt32LE(512, table + 16)
  stub.writeUInt32LE(512, table + 20)
  return stub
}

function createNsisBinary(
  crc32: (bytes: Buffer) => number,
  flags: 0 | 1,
  extraBlocks: Buffer[] = [],
): Buffer {
  const header = Buffer.alloc(68, flags === 1 ? 0x41 : 0x42)
  const blocks = [header, ...extraBlocks]
  const blockBytes = blocks.flatMap((block) => {
    const length = Buffer.alloc(4)
    length.writeUInt32LE(block.length)
    return [length, block]
  })
  const overlayLength = 28 + blockBytes.reduce((total, block) => total + block.length, 0) + 4
  const overlay = Buffer.alloc(28)
  overlay.writeUInt32LE(flags, 0)
  Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex').copy(overlay, 4)
  overlay.writeUInt32LE(header.length, 20)
  overlay.writeUInt32LE(overlayLength, 24)

  const withoutCrc = Buffer.concat([minimalPeStub(), overlay, ...blockBytes])
  const crc = Buffer.alloc(4)
  crc.writeUInt32LE(crc32(withoutCrc.subarray(512)))
  return Buffer.concat([withoutCrc, crc])
}

describe('ES-DESKTOP-INSTALLER-UPGRADE-LIFECYCLE-FIX-01', () => {
  it('replaces the builder tasklist/taskkill path with exact executable detection', () => {
    const body = macroBody('customCheckAppRunning')

    expect(processTemplate).toMatch(/!ifmacrodef customCheckAppRunning\s+!insertmacro customCheckAppRunning/)
    expect(body).toContain('nsProcess::_FindProcess /NOUNLOAD "${APP_EXECUTABLE_FILENAME}"')
    expect(body).toMatch(/\$R0 == 0/)
    expect(body).toMatch(/\$R0 != 603/)
    expect(instructionsOnly(installerInclude)).not.toMatch(/tasklist|find\.exe|taskkill|_KillProcess/i)
  })

  it('fails closed for a running app and never force terminates it', () => {
    const body = macroBody('customCheckAppRunning')

    expect(body).toContain('Exit E-Shop Desktop from its tray menu')
    expect(body).toContain('SetErrorLevel 2')
    expect(body).toContain('SetErrorLevel 3')
    expect(body.match(/\bQuit\b/g)).toHaveLength(2)
    expect(instructionsOnly(body)).not.toMatch(
      /nsExec|ExecWait|ExecShell|taskkill|_KillProcess|CloseWindow|SendMessage/i,
    )
  })

  it('runs the exact check before install and uninstaller lifecycle work', () => {
    expect(installerTemplate).toMatch(/!ifmacrodef customInit\s+!insertmacro customInit/)
    expect(uninstallerTemplate).toMatch(/!ifmacrodef customUnInit\s+!insertmacro customUnInit/)
    expect(installSection.indexOf('!insertmacro CHECK_APP_RUNNING')).toBeLessThan(
      installSection.indexOf('!insertmacro uninstallOldVersion'),
    )
    expect(macroBody('customInit')).toContain('!insertmacro customCheckAppRunning')
    expect(macroBody('customUnInit')).toContain('!insertmacro customCheckAppRunning')
  })

  it('moves the prior uninstaller working directory to TEMP without changing AppData semantics', () => {
    const body = macroBody('customUnInit')

    expect(body.indexOf('!insertmacro customCheckAppRunning')).toBeLessThan(body.indexOf('SetOutPath "$TEMP"'))
    expect(installerInclude).not.toMatch(/RMDir\s+\/r\s+"?\$APPDATA|--delete-app-data/i)
    expect(readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8')).toMatch(
      /^\s*deleteAppDataOnUninstall:\s*false\s*$/m,
    )
  })

  it('protects embedded-uninstaller CRC and preserves the one HKCU Run lifecycle', () => {
    expect(installerInclude).toContain('!define /ifndef MUI_UNICON "${MUI_ICON}"')
    expect(installerInclude).toContain('!if "${MUI_ICON}" != "${MUI_UNICON}"')
    expect(installerInclude.match(/^\s*WriteRegStr HKCU /gm)).toHaveLength(1)
    expect(installerInclude.match(/^\s*DeleteRegValue HKCU /gm)).toHaveLength(1)
    expect(installerInclude).toContain('"${ESHOP_DESKTOP_AUTOSTART_VALUE}"')
  })

  it('verifies outer and embedded NSIS CRCs and rejects mutations', async () => {
    const verifier = await import(pathToFileURL(resolve(verifierPath)).href) as NsisVerifier
    expect(verifier.crc32(Buffer.from('123456789'))).toBe(0xcbf43926)

    const uninstaller = createNsisBinary(verifier.crc32, 1)
    const installer = createNsisBinary(verifier.crc32, 0, [uninstaller])
    const inspected = verifier.inspectNsisInstaller(installer)
    expect(inspected.installer.flags).toBe(0)
    expect(inspected.uninstaller.flags).toBe(1)

    const corruptedOuter = Buffer.from(installer)
    corruptedOuter[corruptedOuter.length - 1] ^= 0xff
    expect(() => verifier.inspectNsisInstaller(corruptedOuter)).toThrow('DESKTOP_INSTALLER_NSIS_CRC_MISMATCH')

    const corruptedInner = Buffer.from(uninstaller)
    corruptedInner[corruptedInner.length - 1] ^= 0xff
    const installerWithCorruptedInner = createNsisBinary(verifier.crc32, 0, [corruptedInner])
    expect(() => verifier.inspectNsisInstaller(installerWithCorruptedInner)).toThrow(
      'DESKTOP_INSTALLER_NSIS_CRC_MISMATCH',
    )
  })

  it('keeps the integrity verifier read-only and specific to one embedded uninstaller', () => {
    expect(verifierSource).toMatch(/uninstallers\.length !== 1/)
    expect(verifierSource).toMatch(/DESKTOP_INSTALLER_NSIS_CRC_MISMATCH/)
    expect(verifierSource).not.toMatch(/writeFile|chmod|rename|unlink|rmSync|spawn|execFile|taskkill/i)
  })
})

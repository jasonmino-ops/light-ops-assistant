import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(__dirname, '..')
const builderConfig = readFileSync(join(desktopRoot, 'electron-builder.yml'), 'utf8')
const installerInclude = readFileSync(join(desktopRoot, 'build', 'installer.nsh'), 'utf8')
const builderTemplateRoot = join(desktopRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis')
const installTemplate = readFileSync(join(builderTemplateRoot, 'installSection.nsh'), 'utf8')
const uninstallTemplate = readFileSync(join(builderTemplateRoot, 'uninstaller.nsh'), 'utf8')

const runKey = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const valueName = 'E-Shop Desktop'

function matchingLines(pattern: RegExp): string[] {
  return installerInclude
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))
}

describe('ES-DESKTOP-AUTOSTART-01 Windows installer registration', () => {
  it('loads the supported custom NSIS include from electron-builder', () => {
    expect(builderConfig).toMatch(/^\s*include:\s*build\/installer\.nsh\s*$/m)
    expect(builderConfig).toMatch(/^\s*perMachine:\s*false\s*$/m)
    expect(builderConfig).toMatch(/^\s*deleteAppDataOnUninstall:\s*false\s*$/m)
  })

  it('uses lifecycle hooks invoked by the installed electron-builder version', () => {
    expect(installTemplate).toMatch(/!ifmacrodef customInstall\s+!insertmacro customInstall/)
    expect(uninstallTemplate).toMatch(/!ifmacrodef customUnInstall\s+!insertmacro customUnInstall/)
  })

  it('writes exactly one current-user Run value for the normal packaged executable', () => {
    const writes = matchingLines(/^WriteRegStr\b/)

    expect(writes).toHaveLength(1)
    expect(writes[0]).toBe(
      'WriteRegStr HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}" \'"$INSTDIR\\${APP_EXECUTABLE_FILENAME}"\'',
    )
    expect(installerInclude).toContain(`!define ESHOP_DESKTOP_AUTOSTART_KEY "${runKey}"`)
    expect(installerInclude).toContain(`!define ESHOP_DESKTOP_AUTOSTART_VALUE "${valueName}"`)
  })

  it('uses same-name overwrite semantics so upgrades cannot add duplicate entries', () => {
    expect(matchingLines(/^WriteRegStr\b/)).toHaveLength(1)
    expect(installerInclude.match(/ESHOP_DESKTOP_AUTOSTART_VALUE/g)).toHaveLength(3)
    expect(installerInclude).not.toMatch(/WriteRegExpandStr|WriteRegBin|WriteRegDWORD/)
  })

  it('deletes the exact registration during uninstall', () => {
    const deletes = matchingLines(/^DeleteRegValue\b/)

    expect(deletes).toEqual([
      'DeleteRegValue HKCU "${ESHOP_DESKTOP_AUTOSTART_KEY}" "${ESHOP_DESKTOP_AUTOSTART_VALUE}"',
    ])
  })

  it('does not add an alternate startup system or Activation-bypass argument', () => {
    expect(installerInclude).not.toMatch(/HKLM|CurrentVersion\\RunOnce/i)
    expect(installerInclude).not.toMatch(/Startup|CreateShortCut|schtasks|Schedule|Service/i)
    expect(installerInclude).not.toMatch(/--[A-Za-z]/)
    expect(installerInclude).not.toMatch(/activation|credential|fullscreen/i)
  })
})

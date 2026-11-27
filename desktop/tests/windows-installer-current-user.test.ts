import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const source = readFileSync(join(root, 'build/installer.nsh'), 'utf8')
const machineMode = readFileSync(join(root, 'build/current-user-mode.nsh'), 'utf8')
const config = readFileSync(join(root, 'electron-builder.yml'), 'utf8')
const builderRoot = join(root, 'node_modules/app-builder-lib')
const template = (file: string) => readFileSync(join(builderRoot, 'templates/nsis', file), 'utf8')
const installer = template('installer.nsi')
const uninstaller = template('uninstaller.nsh')
const assisted = template('assistedInstaller.nsh')
const ui = template('multiUserUi.nsh')
const target = readFileSync(join(builderRoot, 'out/targets/nsis/NsisTarget.js'), 'utf8')
const flags = readFileSync(join(builderRoot, 'out/targets/nsis/nsisScriptGenerator.js'), 'utf8')
const body = (name: string) => source.match(new RegExp(`^!macro ${name}\\b[^\\n]*\\n([\\s\\S]*?)!macroend`, 'm'))![1]
const code = (s: string) => s.split('\n').filter(line => !line.trimStart().startsWith(';')).join('\n')

describe('G4 current-user package boundary against locked builder source', () => {
  it('disables assisted elevation, machine default and packed elevation helper explicitly', () => {
    const nsis = config.split('\nnsis:\n')[1].split('\npublish:')[0]
    for (const setting of ['oneClick: false', 'perMachine: false', 'selectPerMachineByDefault: false', 'allowElevation: false', 'packElevateHelper: false', 'deleteAppDataOnUninstall: false']) expect(nsis).toContain(setting)
    expect(config).toMatch(/arch:\s*\n\s*- x64/)
    expect(target).toContain('options.allowElevation !== false')
    expect(target).toContain('defines.MULTIUSER_INSTALLMODE_ALLOW_ELEVATION = null')
    // perMachine:false alone retains the assisted install-mode UI.
    expect(target).toContain('if (!oneClick || options.perMachine === true)')
    expect(target).toContain('defines.INSTALL_MODE_PER_ALL_USERS_REQUIRED = null')
  })
  it('guards installation before initMultiUser and forces the existing per-user page path', () => {
    expect(installer.indexOf('!insertmacro preInit')).toBeLessThan(installer.indexOf('!insertmacro initMultiUser'))
    expect(body('preInit')).toContain('!ifndef BUILD_UNINSTALLER')
    expect(body('preInit')).toContain('!insertmacro eshopVerifyCurrentUserScope')
    expect(body('customInstallMode')).toContain('!insertmacro eshopVerifyCurrentUserScope')
    expect(body('customInstallMode')).toContain('StrCpy $isForceCurrentInstall "1"')
    expect(ui.indexOf('!insertmacro customInstallMode')).toBeLessThan(ui.indexOf('${OrIf} ${isForAllUsers}'))
    expect(body('eshopVerifyInstallContext')).toContain('$installMode != "CurrentUser"')
  })
  it('blocks uninstaller machine initialization before its ordinary elevation path', () => {
    expect(uninstaller.indexOf('!insertmacro initMultiUser')).toBeLessThan(uninstaller.indexOf('!insertmacro customUnInit'))
    expect(assisted).toContain('!insertmacro setInstallModePerAllUsers')
    expect(installer.indexOf('!include "assistedInstaller.nsh"')).toBeLessThan(installer.indexOf('!insertmacro customHeader'))
    expect(installer.indexOf('!insertmacro customHeader')).toBeLessThan(installer.indexOf('!include "uninstaller.nsh"'))
    expect(body('customHeader')).toContain('!macroundef setInstallModePerAllUsers')
    expect(body('customHeader')).toContain('!include "${BUILD_RESOURCES_DIR}\\current-user-mode.nsh"')
    expect(code(machineMode)).toMatch(/!macro setInstallModePerAllUsers[\s\S]*SetErrorLevel 44[\s\S]*Quit/)
    expect(code(machineMode)).not.toMatch(/UAC_RunElevated|Exec|SetShellVarContext all|WriteReg|DeleteReg/)
    // Silent uninstaller checks process before initialization; that hook guards too.
    expect(uninstaller.indexOf('call un.checkAppRunning')).toBeLessThan(uninstaller.indexOf('!insertmacro initMultiUser'))
    expect(body('customCheckAppRunning').trimStart()).toMatch(/^[;\s\S]*?!insertmacro eshopVerifyCurrentUserScope/)
  })
  it('matches actual StdUtils flag boolean semantics and denies unknown values', () => {
    expect(flags).toContain('StdUtils.TestParameter')
    expect(flags).toContain('"true"')
    expect(body('eshopVerifyCurrentUserScope')).toContain('${StdUtils.TestParameter} $R0 "allusers"')
    expect(body('eshopVerifyCurrentUserScope')).toContain('${If} $R0 != "false"')
    expect(body('eshopVerifyCurrentUserScope')).toContain('${IfNot} ${IsNativeAMD64}')
  })
  it('checks every machine install/uninstall/owner key with explicit 32/64 view read access', () => {
    const scope = body('eshopVerifyCurrentUserScope')
    for (const key of ['INSTALL_REGISTRY_KEY', 'UNINSTALL_REGISTRY_KEY', 'ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY', 'ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY', 'ESHOP_DESKTOP_OWNER_KEY']) {
      for (const mask of ['0x20119', '0x20219']) expect(scope).toContain(`!insertmacro eshopRejectMachineKey "\${${key}}" ${mask}`)
    }
    const keyGuard = body('eshopRejectMachineKey')
    expect(keyGuard).toContain('StrCpy $1 -1')
    expect(keyGuard).toContain('RegOpenKeyExW')
    expect(keyGuard).toContain('RegCloseKey')
    expect(keyGuard).toContain('$eshopMachineKeyStatus != 2')
    expect(keyGuard).toContain('$eshopMachineKeyStatus != 3')
    expect(keyGuard).not.toMatch(/WriteReg|DeleteReg|RegCreate|RegSet|RegDelete/)
  })
  it('retains G3 confirmation ordering and exact dependency recovery instead of adding migration', () => {
    expect(body('customUnInit')).not.toMatch(/ExecWait|eshopUninstallCurrentUserAddon|DeleteReg/)
    expect(body('customHeader')).toContain('Section "un.-E-Shop lifecycle"')
    expect(body('eshopConfirmedUninstall')).toContain('${IfNot} ${isUpdated}')
    expect(source).toContain('PendingInstallerSha256')
    expect(source).toContain('Recovery requires the exact original installer file')
    expect(source).toContain('/KEEP_APP_DATA')
    expect(code(source)).not.toMatch(/taskkill|_KillProcess|SetTokenInformation|DuplicateTokenEx|RegCreate|RegDelete/)
  })
})

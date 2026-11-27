import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const source = readFileSync(join(root, 'build/installer.nsh'), 'utf8')
const templates = join(root, 'node_modules/app-builder-lib/templates/nsis')
const installer = readFileSync(join(templates, 'installer.nsi'), 'utf8')
const uninstaller = readFileSync(join(templates, 'uninstaller.nsh'), 'utf8')
const section = readFileSync(join(templates, 'installSection.nsh'), 'utf8')
const assisted = readFileSync(join(templates, 'assistedInstaller.nsh'), 'utf8')
const body = (name: string) => {
  const result = source.match(new RegExp(`!macro ${name}\\b([\\s\\S]*?)!macroend`))
  if (!result) throw new Error(`Missing macro ${name}`)
  return result[1]
}

describe('ES-DIAMOND-V3-PROVIDER-INSTALLER-ALLUSERS-01 context contract', () => {
  it('validates after real multi-user initialization, without overriding the detected mode', () => {
    expect(installer.indexOf('!insertmacro initMultiUser')).toBeLessThan(installer.indexOf('!insertmacro customInit'))
    expect(uninstaller.indexOf('!insertmacro initMultiUser')).toBeLessThan(uninstaller.indexOf('!insertmacro customUnInit'))
    for (const hook of ['customInit', 'customUnInit']) {
      expect(body(hook)).toContain('!insertmacro eshopVerifyInstallContext')
      expect(body(hook)).not.toContain('SetShellVarContext current')
    }
    const guard = body('eshopVerifyInstallContext')
    expect(guard).toMatch(/\$installMode == "all"[\s\S]*?\$\{IfNot\} \$\{UAC_IsAdmin\}[\s\S]*?SetErrorLevel 8[\s\S]*?SetShellVarContext all/)
    expect(guard).toContain('${ElseIf} $installMode == "CurrentUser"\n    SetShellVarContext current')
    expect(guard).not.toMatch(/StrCpy\s+\$installMode|WriteReg|DeleteReg/)
  })

  it('checks both actual registry hives rather than trusting forced mode flags', () => {
    const guard = body('eshopVerifyInstallContext')
    for (const hive of ['HKCU', 'HKLM']) {
      expect(guard).toContain(`${hive} "\${INSTALL_REGISTRY_KEY}" InstallLocation`)
      expect(guard).toContain(`${hive} "\${UNINSTALL_REGISTRY_KEY}" UninstallString`)
    }
    expect(guard).toContain('Conflicting E-Shop Desktop installation registrations')
    expect(guard).toContain('The registered Desktop installation is current-user')
    expect(guard).toContain('The registered Desktop installation is all-users')
    expect(guard).toContain('The Desktop installation context is unknown')
    expect(guard).toContain('SetErrorLevel 6')
    expect(guard).toContain('SetErrorLevel 7')
    expect(guard).not.toContain('GetOptions')
  })

  it('rejects partial registrations, path redirection and unregistered file collisions', () => {
    const guard = body('eshopVerifyInstallContext')
    expect(guard).toContain('${If} $R1 == ""')
    expect(guard).toContain('${OrIf} $R2 == ""')
    expect(guard).toContain('${OrIf} $R1 != "$INSTDIR"')
    expect(guard).toContain('${ElseIf} ${FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"')
    expect(guard).toContain('SetErrorLevel 4')
    expect(body('customUnInit')).toContain('The Desktop uninstall registration cannot be verified')
  })

  it('binds the verified successor handoff and cleanup to the same selected context', () => {
    const handoff = body('eshopUninstallPriorVersion')
    expect(handoff).toContain('ReadRegStr $R1 SHELL_CONTEXT')
    expect(handoff).toContain('ReadRegStr $R2 SHELL_CONTEXT')
    expect(handoff).toContain('StrCpy $R6 "/allusers"')
    expect(handoff).toContain('StrCpy $R6 "/currentuser"')
    expect(handoff).toContain('File /oname=eshop-current-uninstaller.exe "${UNINSTALLER_OUT_FILE}"')
    expect(handoff).toContain('ReadRegStr $R4 SHELL_CONTEXT')
    expect(handoff).toContain('ReadRegStr $R5 SHELL_CONTEXT')
    expect(handoff).toContain('${OrIf} $R5 != ""')
    expect(handoff).not.toMatch(/ReadRegStr\s+\$R[1245]\s+HKCU|ExecWait[^\n]*\$R[23]/)
    expect(source).not.toContain('old-uninstaller.exe')
  })

  it('rechecks context after the mode/directory pages and before generic predecessor fallback', () => {
    expect(section.indexOf('!insertmacro CHECK_APP_RUNNING')).toBeLessThan(section.indexOf('!insertmacro uninstallOldVersion'))
    const check = body('customCheckAppRunning')
    expect(check.indexOf('!insertmacro eshopVerifyInstallContext')).toBeLessThan(check.indexOf('!insertmacro eshopUninstallPriorVersion'))
    expect(check).toContain('$eshopDesktopInstallerPhase == "install"')
    // The first silent-uninstaller process check occurs before initMultiUser.
    // Its context validation remains in customUnInit, after mode selection.
    expect(check).toContain('!ifndef BUILD_UNINSTALLER')
  })

  it('retains normal Windows elevation instead of manufacturing administrator rights', () => {
    expect(installer).toContain('!insertmacro UAC_RunElevated')
    expect(body('eshopUninstallPriorVersion')).toContain('${IfNot} ${UAC_IsAdmin}')
    expect(body('eshopUninstallPriorVersion')).toContain('SetErrorLevel 8')
    expect(assisted).toContain('ReadRegStr $perMachineInstallationFolder HKLM')
    expect(source).not.toMatch(/runas|schtasks|powershell|ExecutionPolicy|DisableUAC/i)
  })

  it('keeps the sole HKCU autorun lifecycle and refuses an existing machine autorun duplicate', () => {
    expect(source.match(/^\s*WriteRegStr HKCU \"\$\{ESHOP_DESKTOP_AUTOSTART_KEY\}/gm)).toHaveLength(1)
    expect(source.match(/^\s*DeleteRegValue HKCU "\$\{ESHOP_DESKTOP_AUTOSTART_KEY\}"/gm)).toHaveLength(1)
    expect(source.match(/^\s*DeleteRegValue HKCU /gm)).toHaveLength(5)
    expect(body('eshopVerifyInstallContext')).toContain('ReadRegStr $R9 HKLM "${ESHOP_DESKTOP_AUTOSTART_KEY}"')
    expect(source).not.toMatch(/(?:WriteReg\w*|DeleteReg\w*)\s+HKLM\b/i)
    const instructions = source.split('\n').filter((line) => !line.trimStart().startsWith(';')).join('\n')
    expect(instructions).not.toMatch(/RMDir\s+\/r.*\$APPDATA|--delete-app-data|taskkill|_KillProcess/i)
  })

  it('returns from Add-on user-context work to the selected Desktop context', () => {
    const cleanup = body('eshopUninstallCurrentUserAddon')
    expect(cleanup.indexOf('SetShellVarContext current')).toBeLessThan(cleanup.indexOf('!insertmacro eshopPrepareManagedAddonUninstall'))
    expect(cleanup.indexOf('!insertmacro eshopPrepareManagedAddonUninstall')).toBeLessThan(cleanup.indexOf('!insertmacro eshopRestoreDesktopContext'))
    expect(body('customUnInit')).not.toContain('!insertmacro eshopUninstallCurrentUserAddon')
    expect(body('eshopConfirmedUninstall')).toContain('!insertmacro eshopUninstallCurrentUserAddon')
    expect(body('customInstall')).toContain('!insertmacro eshopRestoreDesktopContext')
    expect(body('customUnInstall')).toContain('!insertmacro eshopRestoreDesktopContext')
    expect(body('eshopRestoreDesktopContext')).toContain('${If} $installMode == "all"')
    expect(body('eshopRestoreDesktopContext')).toContain('SetShellVarContext all')
  })

  it('continues the installer after confirming no Add-on process instead of returning from its caller', () => {
    const exit = body('eshopRequestManagedAddonExit')
    expect(exit).not.toMatch(/^\s*Return\s*$/m)
    expect(exit.match(/Goto eshopNetworkAddonExitDone_/g)).toHaveLength(2)
    expect(exit).toContain('eshopNetworkAddonExitDone_${ESHOP_MANAGED_ADDON_EXIT_ID}:')
  })
  it('runs dependency removal only in a confirmed uninstall section before builder file deletion', () => {
    expect(installer.indexOf('!insertmacro customHeader')).toBeLessThan(installer.indexOf('!include "uninstaller.nsh"'))
    expect(body('customHeader')).toContain('!ifdef BUILD_UNINSTALLER')
    expect(body('customHeader')).toContain('Section "un.-E-Shop lifecycle"')
    expect(body('customHeader')).toContain('!insertmacro eshopConfirmedUninstall')
    expect(body('customUnInit')).not.toMatch(/eshopUninstallCurrentUserAddon|eshopPrepareManagedAddonUninstall|ExecWait|DeleteReg/)
    expect(body('eshopConfirmedUninstall')).toContain('!insertmacro eshopVerifyInstallContext')
    expect(body('eshopConfirmedUninstall')).toContain('${IfNot} ${isUpdated}')
    expect(uninstaller.indexOf('Section "un.install"')).toBeLessThan(uninstaller.indexOf('# delete the installed files'))
  })

  it('blocks elevated ExecWait paths rather than treating user-writable paths or async shell launch as trusted', () => {
    for (const macro of ['eshopUninstallPriorVersion', 'eshopRequestManagedAddonExit', 'eshopPrepareManagedAddonUninstall', 'eshopPrepareNetworkAddon']) {
      const instructions = body(macro)
      expect(instructions).toContain('!insertmacro eshopRequireUnelevatedLifecycle')
      expect(instructions.indexOf('!insertmacro eshopRequireUnelevatedLifecycle')).toBeLessThan(instructions.indexOf('ExecWait'))
    }
    expect(body('eshopRequireUnelevatedLifecycle')).toMatch(/\$\{If\} \$\{UAC_IsAdmin\}[\s\S]*SetErrorLevel 43[\s\S]*Quit/)
    expect(source.split('\n').filter(line => !line.trimStart().startsWith(';')).join('\n')).not.toMatch(/ExecShellAsUser|ExecShell|UAC::Exec|DuplicateToken/)
    expect(body('eshopVerifyMachineOwner')).toContain('ReadRegStr $R0 HKLM "${ESHOP_DESKTOP_OWNER_KEY}" OwnerSid')
    expect(body('eshopVerifyMachineOwner')).toContain('$R0 != "$eshopInteractiveUserSid"')
    expect(body('eshopVerifyMachineOwner')).toContain('$R3 != "$INSTDIR"')
    expect(body('eshopVerifyMachineOwner')).toContain('SetErrorLevel 42')
    // This safety successor does NOT claim a usable machine-install writer.
    expect(source).not.toMatch(/WriteReg\w* HKLM/)
  })

})

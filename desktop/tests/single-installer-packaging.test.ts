import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const read = (file: string) => readFileSync(join(root, file), 'utf8')

describe('single installer packaging contract', () => {
  it('embeds the exact Add-on payload and keeps merchant delivery single-package', () => {
    const config = read('electron-builder.yml')
    const installer = read('build/installer.nsh')
    const contract = read('scripts/single-installer-contract.mjs')
    expect(config).toContain('to: network-print-addon')
    expect(config).toContain('E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.15-x64.exe')
    expect(installer).toContain('ExecWait \'"$PLUGINSDIR\\eshop-network-addon-preflight.exe" /S /desktop-prerequisite\' $R0')
    expect(installer).toContain('ExecWait \'"${ESHOP_NETWORK_ADDON_ROOT}\\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts --desktop-install-prerequisite\' $R6')
    expect(installer).toContain('The managed Network Print Add-on shortcut contract could not be verified or repaired. Stopping.')
    expect(installer).toContain('SetErrorLevel 35')
    expect(installer).toContain('!insertmacro eshopVerifyManagedAddonLifecycle')
    expect(installer).toContain('The managed Network Print Add-on lifecycle artifacts are incomplete. Stopping.')
    expect(installer).toContain('$DESKTOP\\店小二收银.lnk')
    expect(installer).toContain('$SMPROGRAMS\\店小二\\管理与维护\\Network 打印设置.lnk')
    expect(installer).toContain('$SMPROGRAMS\\店小二\\管理与维护\\Desktop 门店绑定.lnk')
    expect(installer).toContain('$SMPROGRAMS\\店小二\\管理与维护\\卸载 Network Print.lnk')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_MARKER_KEY')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_VERSION')
    expect(installer).toContain('The installed Network Print Add-on version is not compatible. Stopping.')
    expect(installer).toContain('An independently installed Network Print Add-on cannot be adopted. Stopping.')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_UNINSTALLER')
    expect(installer).toContain('ExecWait \'"${ESHOP_NETWORK_ADDON_UNINSTALLER}" /S\' $R2')
    expect(installer).toContain('!insertmacro eshopRequestManagedAddonExit ${id}')
    expect(installer).toContain('The managed Network Print Add-on did not exit safely before timeout. Stopping.')
    expect(installer).toContain('The managed Network Print Add-on executable is missing. Stopping.')
    const install = installer.split('!macro eshopPrepareNetworkAddon\n')[1].split('!macroend')[0]
    expect(install.indexOf('!insertmacro eshopVerifyAddonPrerequisite')).toBeGreaterThan(install.indexOf('ExecWait'))
    expect(install).not.toContain('!insertmacro eshopVerifyManagedAddonLifecycle')
    expect(install).not.toContain('"Managed" "true"')
    expect(install).not.toContain('"Version" "${ESHOP_NETWORK_ADDON_VERSION}"')
    const complete = installer.split('!macro eshopCompleteNetworkAddon\n')[1].split('!macroend')[0]
    expect(complete).toContain('--desktop-install-complete')
    expect(complete.indexOf('!insertmacro eshopVerifyManagedAddonLifecycle')).toBeGreaterThan(complete.indexOf('ExecWait'))
    expect(complete).not.toContain('"Managed" "true"')
    const commit = installer.split('!macro customInstall\n')[1].split('!macroend')[0]
    expect(commit.indexOf('!insertmacro eshopCompleteNetworkAddon')).toBeLessThan(commit.indexOf('WriteRegStr'))
    expect(commit.indexOf('"Managed" "true"')).toBeGreaterThan(commit.indexOf('ESHOP_DESKTOP_AUTOSTART_VALUE'))
    expect(commit.indexOf('"Managed" "true"')).toBeLessThan(commit.indexOf('DeleteRegValue'))
    expect(installer).toContain('${IfNot} ${isUpdated}')
    const init = installer.split('!macro customInit\n')[1].split('!macroend')[0]
    const running = installer.split('!macro customCheckAppRunning\n')[1].split('!macroend')[0]
    const uninit = installer.split('!macro eshopConfirmedUninstall\n')[1].split('!macroend')[0]
    expect(init).not.toContain('!insertmacro eshopCheckNetworkAddonInstallState')
    expect(running.indexOf('!insertmacro eshopCheckNetworkAddonInstallState')).toBeGreaterThan(
      running.indexOf('!insertmacro eshopCheckNetworkAddonProcess'),
    )
    expect(running.indexOf('!insertmacro eshopCheckNetworkAddonInstallState')).toBeGreaterThan(
      running.indexOf('  ${EndIf}\n\n  !ifndef BUILD_UNINSTALLER'),
    )
    expect(running.indexOf('!insertmacro eshopCheckNetworkAddonInstallState')).toBeLessThan(
      running.indexOf('!insertmacro eshopUninstallPriorVersion'),
    )
    expect(running).toContain('${If} $eshopDesktopInstallerPhase == "install"')
    expect(uninit.indexOf('!insertmacro eshopUninstallCurrentUserAddon')).toBeLessThan(
      uninit.indexOf('SetOutPath "$TEMP"'),
    )
    expect(installer).toMatch(/\$\{IfNot\} \$\{isUpdated\}[\s\S]*?DeleteRegKey HKCU "\$\{ESHOP_NETWORK_ADDON_MARKER_KEY\}"/)
    expect(contract).not.toContain('adc273c99a823d6dd640aa40bca6e385d0f651c7a10248e7471d508fadbf5456')
    expect(contract).not.toContain('304a341f43fa633ce70699917c12bade0ff9aa19')
    expect(contract).toContain("merchantDelivery: 'single-desktop-installer'")
    expect(contract).toContain("PRODUCT_CANDIDATE_COMMIT = '11b268d436da12015c97390dc38ab97230db3607'")
    expect(contract).toContain("GOVERNANCE_HEAD_COMMIT = 'e4563bbf0dd0e61606dcd6bcb37cc83862abdb30'")
  })

  it('fails closed for independent merchant Add-on delivery claims', () => {
    const contract = read('scripts/single-installer-contract.mjs')
    const verifier = read('scripts/verify-single-installer.mjs')
    expect(contract).toContain("releaseReady: false")
    expect(verifier).toContain('SINGLE_INSTALLER_EMBEDDED_ADDON_HASH_MISMATCH')
    expect(verifier).toContain('SINGLE_INSTALLER_ADDON_RESOURCE_MISSING')
    expect(verifier).toContain('embedded.desktopSourceCommit !== sourceCommit')
    expect(verifier).toContain('SINGLE_INSTALLER_BINDING_REQUIRED')
    expect(verifier).toContain('SINGLE_INSTALLER_BINDING_MISMATCH')
    expect(verifier).toContain('embedded.addon?.sourceCommit !== GOVERNANCE_HEAD_COMMIT')
    expect(verifier).toContain('embedded.productCandidateCommit !== PRODUCT_CANDIDATE_COMMIT')
    expect(verifier).toContain('embedded.governanceHeadCommit !== GOVERNANCE_HEAD_COMMIT')
    expect(contract).toContain('SINGLE_INSTALLER_GOVERNANCE_SOURCE_MISMATCH')
  })
})

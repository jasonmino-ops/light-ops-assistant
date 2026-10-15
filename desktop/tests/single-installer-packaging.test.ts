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
    expect(config).toContain('E-Shop-Network-Print-Addon-TEST-0.1.0-commercial-rc.10-x64.exe')
    expect(installer).toContain('ExecWait \'"${ESHOP_NETWORK_ADDON_INSTALLER}" /S\' $R0')
    expect(installer).toContain('ExecWait \'"${ESHOP_NETWORK_ADDON_ROOT}\\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts\' $R6')
    expect(installer).toContain('The managed Network Print Add-on shortcut contract could not be verified or repaired. Stopping.')
    expect(installer).toContain('SetErrorLevel 35')
    expect(installer).toContain('!insertmacro eshopVerifyManagedAddonLifecycle')
    expect(installer).toContain('The managed Network Print Add-on lifecycle artifacts are incomplete. Stopping.')
    expect(installer).toContain('$DESKTOP\\店小二收银.lnk')
    expect(installer).toContain('$SMPROGRAMS\\店小二\\管理与维护\\Network 打印设置.lnk')
    expect(installer).toContain('$SMPROGRAMS\\店小二\\Desktop 门店绑定.lnk')
    expect(installer).toContain('$SMPROGRAMS\\店小二\\卸载 Network Print.lnk')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_MARKER_KEY')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_INSTALL_REGISTRY_KEY')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_UNINSTALL_REGISTRY_KEY')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_VERSION')
    expect(installer).toContain('The installed Network Print Add-on version is not compatible. Stopping.')
    expect(installer).toContain('An independently installed Network Print Add-on cannot be adopted. Stopping.')
    expect(installer).toContain('ESHOP_NETWORK_ADDON_UNINSTALLER')
    expect(installer).toContain('ExecWait \'"${ESHOP_NETWORK_ADDON_UNINSTALLER}" /S\' $R2')
    expect(installer).toContain('Call eshopRequestManagedAddonExit')
    expect(installer).toContain('The managed Network Print Add-on did not exit safely before timeout. Stopping.')
    expect(installer).toContain('The managed Network Print Add-on executable is missing. Stopping.')
    const install = installer.split('!macro customInstall\n')[1].split('!macroend')[0]
    expect(install.indexOf('!insertmacro eshopVerifyManagedAddonLifecycle')).toBeGreaterThan(
      install.indexOf('ExecWait \'"${ESHOP_NETWORK_ADDON_INSTALLER}" /S\' $R0'),
    )
    expect(install.indexOf('ExecWait \'"${ESHOP_NETWORK_ADDON_ROOT}\\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts\' $R6')).toBeGreaterThan(
      install.indexOf('ExecWait \'"${ESHOP_NETWORK_ADDON_INSTALLER}" /S\' $R0'),
    )
    expect(install.indexOf('ExecWait \'"${ESHOP_NETWORK_ADDON_ROOT}\\E-Shop-Network-Print-Addon.exe" --install-shortcuts --silent-shortcuts\' $R6')).toBeLessThan(
      install.indexOf('!insertmacro eshopVerifyManagedAddonLifecycle'),
    )
    expect(install.indexOf('!insertmacro eshopVerifyManagedAddonLifecycle')).toBeLessThan(
      install.indexOf('WriteRegStr HKCU "${ESHOP_NETWORK_ADDON_MARKER_KEY}" "Managed" "true"'),
    )
    expect(installer).toContain('${IfNot} ${isUpdated}')
    const init = installer.split('!macro customInit\n')[1].split('!macroend')[0]
    const running = installer.split('!macro customCheckAppRunning\n')[1].split('!macroend')[0]
    const uninit = installer.split('!macro customUnInit\n')[1].split('!macroend')[0]
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
    expect(uninit.indexOf('!insertmacro eshopPrepareManagedAddonUninstall')).toBeLessThan(
      uninit.indexOf('SetOutPath "$TEMP"'),
    )
    expect(installer).toMatch(/\$\{IfNot\} \$\{isUpdated\}[\s\S]*?DeleteRegKey HKCU "\$\{ESHOP_NETWORK_ADDON_MARKER_KEY\}"/)
    expect(contract).not.toContain('adc273c99a823d6dd640aa40bca6e385d0f651c7a10248e7471d508fadbf5456')
    expect(contract).not.toContain('304a341f43fa633ce70699917c12bade0ff9aa19')
    expect(contract).toContain("merchantDelivery: 'single-desktop-installer'")
    expect(contract).toContain("PRODUCT_CANDIDATE_COMMIT = '60209a74ab036bddeaf6279c062a769a4ea2db77'")
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

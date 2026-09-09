'use strict'

// Independent packaging profile over the existing Tray modules/toolchain.
// Formal defaults always require signing. Only build-network-addon.mjs
// --candidate derives the explicit, trusted-snapshot-gated TEST-only profile.
// No automatic updater. --release stays closed until legitimate signing and
// trusted exact release authorization are wired.
module.exports = {
  appId: 'com.elife.eshop.networkprint.addon',
  productName: 'E-Shop Network Print Add-on',
  executableName: 'E-Shop-Network-Print-Addon',
  // Verified against https://releases.electronjs.org/release/v44.3.0 on 2026-09-09.
  // This does not change the frozen/shared Windows Tray Electron dependency.
  electronVersion: '44.3.0',
  extends: null,
  directories: { app: '.', output: '../signed-artifacts', buildResources: __dirname },
  files: [
    'package.json', 'build-manifest.json', 'main.cjs', 'preload.cjs',
    'ui.js', 'ui.html', 'ui.css', 'network-render.cjs', 'network-render.html', 'icon.png',
  ],
  extraResources: [],
  extraFiles: [],
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  forceCodeSigning: true,
  publish: null,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'E-Shop-Network-Print-Addon',
    requestedExecutionLevel: 'asInvoker',
    signAndEditExecutable: true,
    verifyUpdateCodeSignature: true,
    artifactName: 'E-Shop-Network-Print-Addon-Setup-${version}-x64.exe',
    publish: null,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    packElevateHelper: false,
    runAfterFinish: false,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'E-Shop Network Print Add-on',
    uninstallDisplayName: 'E-Shop Network Print Add-on',
    include: 'installer.nsh',
    artifactName: 'E-Shop-Network-Print-Addon-Setup-${version}-x64.exe',
  },
}

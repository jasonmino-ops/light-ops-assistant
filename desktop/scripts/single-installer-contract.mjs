import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

export const DESKTOP_VERSION = '0.2.0-pilot.2'
export const ADDON_VERSION = '0.1.0-commercial-rc.10'
export const ADDON_INSTALLER_FILENAME = `E-Shop-Network-Print-Addon-TEST-${ADDON_VERSION}-x64.exe`
export const ADDON_INSTALLER_SHA256 = 'adc273c99a823d6dd640aa40bca6e385d0f651c7a10248e7471d508fadbf5456'
export const ADDON_SOURCE_COMMIT = '304a341f43fa633ce70699917c12bade0ff9aa19'
export const ADDON_MANIFEST_FILENAME = 'network-print-addon-manifest.json'

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function readRegularFile(file, label) {
  const info = await lstat(file)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label}_MUST_BE_REGULAR_FILE`)
  return readFile(file)
}

export function assertManifest(manifest, installerHash) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.product !== 'E-Shop Network Print Add-on (TEST ONLY)'
    || manifest.version !== ADDON_VERSION || manifest.testOnly !== true || manifest.releaseReady !== false
    || manifest.published !== false || manifest.sourceCommit !== ADDON_SOURCE_COMMIT
    || manifest.installerFile !== ADDON_INSTALLER_FILENAME
    || manifest.artifactsSha256?.[ADDON_INSTALLER_FILENAME] !== installerHash) {
    throw new Error('SINGLE_INSTALLER_ADDON_MANIFEST_MISMATCH')
  }
  return {
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    testOnly: manifest.testOnly,
    releaseReady: manifest.releaseReady,
    installerFile: manifest.installerFile,
    installerSha256: installerHash,
  }
}

export async function verifyAddonInput(installerPath, manifestPath) {
  const installer = await readRegularFile(installerPath, 'SINGLE_INSTALLER_ADDON_INSTALLER')
  const installerHash = sha256(installer)
  if (installerHash !== ADDON_INSTALLER_SHA256) throw new Error('SINGLE_INSTALLER_ADDON_HASH_MISMATCH')
  const manifest = JSON.parse((await readRegularFile(manifestPath, 'SINGLE_INSTALLER_ADDON_MANIFEST')).toString('utf8'))
  return { ...assertManifest(manifest, installerHash), installerBytes: installer.length,
    installerPath: path.resolve(installerPath), manifestPath: path.resolve(manifestPath) }
}

export function createEmbeddedManifest({ desktopSourceCommit, addon }) {
  if (!/^[a-f0-9]{40}$/.test(desktopSourceCommit)) throw new Error('SINGLE_INSTALLER_DESKTOP_SOURCE_INVALID')
  return {
    schemaVersion: 1,
    product: 'E-Shop Desktop Single Installer',
    desktopVersion: DESKTOP_VERSION,
    desktopSourceCommit,
    addon: {
      product: 'E-Shop Network Print Add-on (TEST ONLY)',
      version: addon.version,
      sourceCommit: addon.sourceCommit,
      installerFile: ADDON_INSTALLER_FILENAME,
      installerSha256: addon.installerSha256,
      testOnly: true,
      releaseReady: false,
      published: false,
    },
    merchantDelivery: 'single-desktop-installer',
    addonRuntime: 'separate-process',
  }
}

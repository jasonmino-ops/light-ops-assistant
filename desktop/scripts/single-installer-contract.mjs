import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'

export const DESKTOP_VERSION = '0.2.0-pilot.2'
export const ADDON_VERSION = '0.1.0-commercial-rc.10'
export const ADDON_INSTALLER_FILENAME = `E-Shop-Network-Print-Addon-TEST-${ADDON_VERSION}-x64.exe`
export const ADDON_MANIFEST_FILENAME = 'network-print-addon-manifest.json'
export const PRODUCT_CANDIDATE_COMMIT = '60209a74ab036bddeaf6279c062a769a4ea2db77'
export const GOVERNANCE_HEAD_COMMIT = 'e4563bbf0dd0e61606dcd6bcb37cc83862abdb30'

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
    || manifest.published !== false || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
    || manifest.sourceCommit !== GOVERNANCE_HEAD_COMMIT
    || manifest.buildClass !== 'unsigned-test-candidate' || manifest.installer !== true || manifest.runtimeIncluded !== true
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
  const manifest = JSON.parse((await readRegularFile(manifestPath, 'SINGLE_INSTALLER_ADDON_MANIFEST')).toString('utf8'))
  return { ...assertManifest(manifest, installerHash), installerBytes: installer.length,
    installerPath: path.resolve(installerPath), manifestPath: path.resolve(manifestPath) }
}

export function createEmbeddedManifest({ desktopSourceCommit, addon }) {
  if (!/^[a-f0-9]{40}$/.test(desktopSourceCommit)) throw new Error('SINGLE_INSTALLER_DESKTOP_SOURCE_INVALID')
  if (addon.sourceCommit !== GOVERNANCE_HEAD_COMMIT) throw new Error('SINGLE_INSTALLER_GOVERNANCE_SOURCE_MISMATCH')
  return {
    schemaVersion: 1,
    product: 'E-Shop Desktop Single Installer',
    desktopVersion: DESKTOP_VERSION,
    desktopSourceCommit,
    productCandidateCommit: PRODUCT_CANDIDATE_COMMIT,
    governanceHeadCommit: GOVERNANCE_HEAD_COMMIT,
    addon: {
      product: 'E-Shop Network Print Add-on (TEST ONLY)',
      version: addon.version,
      sourceCommit: addon.sourceCommit,
      installerFile: addon.installerFile,
      installerSha256: addon.installerSha256,
      testOnly: true,
      releaseReady: false,
      published: false,
    },
    merchantDelivery: 'single-desktop-installer',
    addonRuntime: 'separate-process',
  }
}

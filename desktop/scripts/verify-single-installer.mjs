import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADDON_INSTALLER_FILENAME, ADDON_MANIFEST_FILENAME, ADDON_VERSION, GOVERNANCE_HEAD_COMMIT, PRODUCT_CANDIDATE_COMMIT, assertManifest, readRegularFile, sha256 } from './single-installer-contract.mjs'
import { inspectCandidateInstaller } from '../../e-shop-tray/scripts/build-network-addon.mjs'

const require = createRequire(import.meta.url)
const { getPath7za } = require('builder-util')
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024

function fail(code) { throw new Error(code) }

async function archiveMembers(archive, env) {
  const { spawnSync } = require('node:child_process')
  const result = spawnSync(await getPath7za(), ['l', '-slt', '-bd', '-bso0', '-bsp0', '-bse2', archive], {
    cwd: path.dirname(archive), env, encoding: 'utf8', maxBuffer: MAX_ARCHIVE_BYTES,
  })
  if (result.error || result.status !== 0) fail('SINGLE_INSTALLER_ARCHIVE_LIST_FAILED')
  return [...result.stdout.matchAll(/^Path = (.+)$/gm)].map(match => match[1].replaceAll('\\', '/'))
}

async function extractMember(archive, member, env) {
  const { spawnSync } = require('node:child_process')
  const result = spawnSync(await getPath7za(), ['x', '-so', '-bd', '-bso0', '-bsp0', '-bse2', archive, member], {
    cwd: path.dirname(archive), env, maxBuffer: MAX_ARCHIVE_BYTES,
  })
  if (result.error || result.status !== 0 || !result.stdout?.length) fail('SINGLE_INSTALLER_ARCHIVE_MEMBER_READ_FAILED')
  return result.stdout
}

export async function verifySingleInstaller(installerPath, expectedBinding) {
  if (!expectedBinding) fail('SINGLE_INSTALLER_BINDING_REQUIRED')
  const installer = await readRegularFile(installerPath, 'SINGLE_INSTALLER')
  const inspected = inspectCandidateInstaller(installer)
  if (inspected.applicationArchives.length !== 1) fail('SINGLE_INSTALLER_APPLICATION_ARCHIVE_MISMATCH')
  const stage = await mkdtemp(path.join(tmpdir(), 'eshop-single-verify-'))
  try {
    const archivePath = path.join(stage, 'application.7z')
    await writeFile(archivePath, inspected.applicationArchives[0], { flag: 'wx' })
    const env = { ...process.env, ELECTRON_BUILDER_DISABLE_UPDATE_CHECK: 'true' }
    const members = await archiveMembers(archivePath, env)
    const manifestMember = `resources/network-print-addon/${ADDON_MANIFEST_FILENAME}`
    if (!members.includes(manifestMember)) fail('SINGLE_INSTALLER_ADDON_RESOURCE_MISSING')
    const embedded = JSON.parse((await extractMember(archivePath, manifestMember, env)).toString('utf8'))
    if (embedded.addon?.installerFile !== ADDON_INSTALLER_FILENAME) fail('SINGLE_INSTALLER_EMBEDDED_MANIFEST_MISMATCH')
    const addonMember = `resources/network-print-addon/${embedded.addon.installerFile}`
    if (!members.includes(addonMember)) fail('SINGLE_INSTALLER_ADDON_RESOURCE_MISSING')
    const addonBytes = await extractMember(archivePath, addonMember, env)
    if (sha256(addonBytes) !== embedded.addon.installerSha256) fail('SINGLE_INSTALLER_EMBEDDED_ADDON_HASH_MISMATCH')
    let sourceCommit
    try {
      sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
    } catch {
      fail('SINGLE_INSTALLER_SOURCE_CONTEXT_UNAVAILABLE')
    }
    if (embedded.product !== 'E-Shop Desktop Single Installer' || embedded.desktopVersion !== '0.2.0-pilot.2'
      || embedded.desktopSourceCommit !== sourceCommit
      || embedded.productCandidateCommit !== PRODUCT_CANDIDATE_COMMIT
      || embedded.governanceHeadCommit !== GOVERNANCE_HEAD_COMMIT
      || embedded.merchantDelivery !== 'single-desktop-installer' || embedded.addonRuntime !== 'separate-process'
      || embedded.addon?.product !== 'E-Shop Network Print Add-on (TEST ONLY)'
      || embedded.addon?.version !== ADDON_VERSION || !/^[a-f0-9]{64}$/.test(embedded.addon?.installerSha256 ?? '')
      || embedded.addon?.installerFile !== ADDON_INSTALLER_FILENAME || embedded.addon?.published !== false) {
      fail('SINGLE_INSTALLER_EMBEDDED_MANIFEST_MISMATCH')
    }
    if (embedded.addon?.sourceCommit !== GOVERNANCE_HEAD_COMMIT || expectedBinding.desktopSourceCommit !== sourceCommit
      || expectedBinding.productCandidateCommit !== PRODUCT_CANDIDATE_COMMIT
      || expectedBinding.governanceHeadCommit !== GOVERNANCE_HEAD_COMMIT
      || expectedBinding.addon?.sourceCommit !== GOVERNANCE_HEAD_COMMIT) fail('SINGLE_INSTALLER_SOURCE_BINDING_MISMATCH')
    if (JSON.stringify(embedded) !== JSON.stringify(expectedBinding)) fail('SINGLE_INSTALLER_BINDING_MISMATCH')
    assertManifest({ schemaVersion: 1, product: embedded.addon.product, version: embedded.addon.version,
      testOnly: embedded.addon.testOnly, releaseReady: embedded.addon.releaseReady, published: false,
      sourceCommit: embedded.addon.sourceCommit, installerFile: embedded.addon.installerFile,
      buildClass: 'unsigned-test-candidate', installer: true, runtimeIncluded: true,
      artifactsSha256: { [embedded.addon.installerFile]: embedded.addon.installerSha256 } }, sha256(addonBytes))
    return { installerPath: path.resolve(installerPath), installerSha256: sha256(installer),
      installerBytes: installer.length, addonMember, manifestMember, embedded }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const installerPath = process.argv[2]
  const bindingPath = process.argv[3]
  if (!installerPath || !bindingPath) { console.error('Usage: node scripts/verify-single-installer.mjs <installer.exe> <binding.json>'); process.exit(2) }
  readFile(bindingPath, 'utf8').then(raw => JSON.parse(raw)).then(binding => verifySingleInstaller(installerPath, binding.embedded ?? binding)).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(error.message); process.exit(1)
  })
}

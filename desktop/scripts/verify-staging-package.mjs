import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const releaseDir = resolve(process.argv[2] ?? 'release-staging')
const sourceCommit = process.argv[3] ?? 'LOCAL'
const version = '0.2.0-staging.1'
const installerName = `E-Shop-Desktop-STAGING-Setup-${version}.exe`
const installerPath = resolve(releaseDir, installerName)
const asarPath = resolve(releaseDir, 'win-unpacked/resources/app.asar')
const profilePath = resolve(releaseDir, 'win-unpacked/resources/desktop-build-profile.json')

const profile = JSON.parse(await readFile(profilePath, 'utf8'))
if (
  profile.channel !== 'STAGING' ||
  profile.buildLabel !== 'STAGING TEST ONLY' ||
  profile.storeCode !== 'PREV06C' ||
  !/^https:\/\//.test(profile.baseUrl) ||
  !/^[0-9a-f]{40}$/.test(profile.deploymentCommit)
) {
  throw new Error('packaged staging build profile mismatch')
}

const packageJson = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'))
if (
  packageJson.name !== 'eshop-desktop-staging' ||
  packageJson.productName !== 'E-Shop Desktop STAGING' ||
  packageJson.version !== version
) {
  throw new Error('packaged staging identity mismatch')
}

const configSource = asar.extractFile(asarPath, 'dist/main/config.js').toString('utf8')
const mainSource = asar.extractFile(asarPath, 'dist/main/main.js').toString('utf8')
const rendererSource = asar.extractFile(asarPath, 'dist/renderer/activation/activationRenderer.js').toString('utf8')
const rendererHtml = asar.extractFile(asarPath, 'dist/renderer/activation/index.html').toString('utf8')
if (!configSource.includes('buildProfile.locked')) throw new Error('staging origin lock missing from packaged config')
if (!mainSource.includes('resourcesPath: process.resourcesPath') || !mainSource.includes('buildChannel: config.buildChannel')) {
  throw new Error('staging dist overlay missing from packaged main process')
}
if (!rendererSource.includes('E-Shop Desktop STAGING') || !rendererHtml.includes('environment-badge')) {
  throw new Error('packaged STAGING marker missing')
}

const topLevelFiles = await readdir(releaseDir)
if (topLevelFiles.some((name) => /^E-Shop-Desktop-Setup-/.test(name))) {
  throw new Error('production-named installer present in staging release directory')
}

const installer = await readFile(installerPath)
const sha256 = createHash('sha256').update(installer).digest('hex')
const manifest = {
  schemaVersion: 1,
  channel: 'STAGING',
  version,
  productName: packageJson.productName,
  installer: basename(installerPath),
  sha256,
  sourceCommit,
  deploymentCommit: profile.deploymentCommit,
  storeCode: profile.storeCode,
  productionImpact: 'NONE',
}
await writeFile(resolve(releaseDir, 'STAGING-BUILD-MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))

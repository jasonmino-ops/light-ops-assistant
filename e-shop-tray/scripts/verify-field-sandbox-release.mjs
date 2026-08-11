import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { extractFile } from '@electron/asar'

const releaseDir = path.resolve(process.cwd(), 'release-field-sandbox')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const installerName = `E-Shop-Tray-Setup-${packageJson.version}-FIELD-SANDBOX.exe`
const previewOrigin = 'https://light-ops-assistant-kly7gvtbe-sunxiaojian0910-2556s-projects.vercel.app'
const installerPath = path.join(releaseDir, installerName)
if (!existsSync(installerPath) || statSync(installerPath).size < 1_000_000) {
  throw new Error(`Missing or invalid FIELD-SANDBOX installer: ${installerPath}`)
}

const unpackedResources = path.join(releaseDir, 'win-unpacked', 'resources')
for (const resource of ['Write-RawPrint.ps1', 'icon.png']) {
  const resourcePath = path.join(unpackedResources, resource)
  if (!existsSync(resourcePath)) throw new Error(`Missing packaged resource: ${resourcePath}`)
}

const asarPath = path.join(unpackedResources, 'app.asar')
if (!existsSync(asarPath)) throw new Error(`Missing packaged app.asar: ${asarPath}`)
const packagedMetadata = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'))
if (packagedMetadata.main !== 'dist/main.fieldSandbox.js') {
  throw new Error(`FIELD-SANDBOX entry point not packaged: ${String(packagedMetadata.main)}`)
}
const packagedFieldEntry = extractFile(asarPath, 'dist/main.fieldSandbox.js').toString('utf8')
const packagedLocalApi = extractFile(asarPath, 'dist/localApi.js').toString('utf8')
if (!packagedFieldEntry.includes('ESHOP_TRAY_ALLOWED_ORIGINS.add')) {
  throw new Error('Packaged FIELD-SANDBOX entry does not enable its isolated allowlist')
}
if (packagedLocalApi.split(previewOrigin).length !== 2) {
  throw new Error('Packaged Local API does not contain the one exact Preview Origin')
}
if (packagedLocalApi.includes('*.vercel.app')) {
  throw new Error('Packaged Local API contains a forbidden Vercel wildcard')
}

const digest = createHash('sha256').update(readFileSync(installerPath)).digest('hex')
console.log(JSON.stringify({
  ok: true,
  installer: installerName,
  bytes: statSync(installerPath).size,
  sha256: digest,
  packagedMain: packagedMetadata.main,
  previewOrigin,
  releaseFiles: readdirSync(releaseDir).sort(),
}, null, 2))

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const releaseDir = path.resolve(process.cwd(), 'release')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const installerName = `E-Shop-Tray-Setup-${packageJson.version}.exe`
const installerPath = path.join(releaseDir, installerName)
if (!existsSync(installerPath) || statSync(installerPath).size < 1_000_000) {
  throw new Error(`Missing or invalid installer: ${installerPath}`)
}
for (const resource of ['Write-RawPrint.ps1', 'icon.png']) {
  const resourcePath = path.join(releaseDir, 'win-unpacked', 'resources', resource)
  if (!existsSync(resourcePath)) throw new Error(`Missing packaged resource: ${resourcePath}`)
}
const digest = createHash('sha256').update(readFileSync(installerPath)).digest('hex')
console.log(JSON.stringify({
  ok: true,
  installer: installerName,
  bytes: statSync(installerPath).size,
  sha256: digest,
  releaseFiles: readdirSync(releaseDir).sort(),
}, null, 2))

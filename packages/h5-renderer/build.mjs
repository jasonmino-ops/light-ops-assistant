import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const root = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(root, '../..')
const sha = b => createHash('sha256').update(b).digest('hex')
const [assetArg, outputArg] = process.argv.slice(2)
if (!assetArg || !outputArg || process.argv.length !== 4) throw Error('Usage: node build.mjs <reviewed-asset-root> <NEW-EXTERNAL-output-directory>')
const assetRoot = fs.realpathSync(assetArg)
const out = path.resolve(outputArg)
if (out === repo || out.startsWith(repo + path.sep) || out === assetRoot || out.startsWith(assetRoot + path.sep) || fs.existsSync(out)) throw Error('OUTPUT_MUST_BE_NEW_AND_OUTSIDE_REPO_AND_ASSETS')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'artifact-manifest.json')))
for (const [relative, expected] of Object.entries(manifest.assets)) {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw Error('ASSET_PATH_INVALID')
  const file = fs.realpathSync(path.join(assetRoot, relative))
  if (!file.startsWith(assetRoot + path.sep) || sha(fs.readFileSync(file)) !== expected) throw Error('ASSET_HASH_MISMATCH:' + relative)
}
for (const [relative, expected] of Object.entries(manifest.sourceContracts)) {
  if (sha(fs.readFileSync(path.join(repo, relative))) !== expected) throw Error('FROZEN_ENCODER_CHANGED:' + relative)
}
const require = createRequire(import.meta.url)
for (const [name, version] of Object.entries(manifest.dependencies)) {
  if (require(name + '/package.json').version !== version) throw Error('DEPENDENCY_VERSION:' + name)
}
fs.mkdirSync(out, { mode: 0o700 })
// Explicit manifest only. No dependency install, downloads, arbitrary globs or
// writes to source/old experiment. Licenses travel with unchanged font bytes.
for (const relative of Object.keys(manifest.assets)) {
  const destination = path.join(out, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(path.join(assetRoot, relative), destination)
  fs.chmodSync(destination, relative === 'browser/headless_shell' || relative === 'browser/chrome_sandbox' ? 0o755 : 0o644)
}
for (const name of ['module.mjs', 'service.mjs', 'controller.mjs', 'package.json', 'package-lock.json', 'artifact-manifest.json']) fs.copyFileSync(path.join(root, name), path.join(out, name))
fs.mkdirSync(path.join(out, 'dist'), { recursive: true })
await build({ stdin: { contents: `import {renderTicketHtmlToEscPosRaw} from './lib/qzHtmlBitmapRenderer';import {qzRawBytesToBase64} from './lib/qzEscPosBitImage';window.pocRender=async html=>qzRawBytesToBase64(await renderTicketHtmlToEscPosRaw(html));`, resolveDir: repo, loader: 'ts' }, bundle: true, platform: 'browser', format: 'iife', minify: false, outfile: path.join(out, 'dist/renderer.js') })
// Playwright's Linux driver is JavaScript; copy the exact installed package,
// then hash every copied file. Browser binaries come ONLY from the manifest.
fs.cpSync(path.dirname(require.resolve('playwright-core/package.json')), path.join(out, 'node_modules/playwright-core'), { recursive: true, dereference: false })
const records = {}
function visit(directory, prefix = '') {
  for (const name of fs.readdirSync(directory).sort()) {
    const relative = prefix + name, file = path.join(directory, name)
    const st = fs.lstatSync(file)
    if (st.isSymbolicLink()) throw Error('ARTIFACT_SYMLINK:' + relative)
    if (st.isDirectory()) visit(file, relative + '/')
    else records[relative] = sha(fs.readFileSync(file))
  }
}
visit(out)
const profile = { version: 1, environment: manifest.environment, files: records, startupReference: manifest.startupReference }
const bytes = JSON.stringify(profile, null, 2) + '\n'
const profileId = sha(bytes)
fs.writeFileSync(path.join(out, 'profile.json'), bytes, { flag: 'wx' })
fs.writeFileSync(path.join(out, 'profile.sha256'), profileId + '\n', { flag: 'wx' })
console.log(JSON.stringify({ output: out, profileId, files: Object.keys(records).length, productionReleased: false }))

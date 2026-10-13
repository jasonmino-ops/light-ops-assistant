import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ADDON_INSTALLER_FILENAME, ADDON_MANIFEST_FILENAME, DESKTOP_VERSION, createEmbeddedManifest, verifyAddonInput } from './single-installer-contract.mjs'
import { verifySingleInstaller } from './verify-single-installer.mjs'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopDir, '..')
const stageDir = path.join(desktopDir, 'build', 'network-print-addon')

function fail(code) { throw new Error(code) }
function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.error || result.status !== 0) fail('SINGLE_INSTALLER_GIT_CHECK_FAILED')
  return result.stdout.trim()
}
function run(command, args, cwd = desktopDir) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, ELECTRON_BUILDER_DISABLE_UPDATE_CHECK: 'true' } })
  if (result.error || result.status !== 0) fail(`SINGLE_INSTALLER_COMMAND_FAILED:${command}`)
}
function parseArgs(args) {
  const values = {}
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    if (!['--addon-installer', '--addon-manifest', '--output'].includes(key) || !args[index + 1]) fail('SINGLE_INSTALLER_ARGUMENTS_INVALID')
    values[key.slice(2)] = args[++index]
  }
  if (!values['addon-installer'] || !values['addon-manifest']) fail('SINGLE_INSTALLER_INPUTS_REQUIRED')
  return values
}

export async function stageSingleInstallerInputs({ installerPath, manifestPath }) {
  const addon = await verifyAddonInput(installerPath, manifestPath)
  const sourceCommit = git(['rev-parse', 'HEAD'])
  if (git(['status', '--porcelain=v1', '--untracked-files=all'])) fail('SINGLE_INSTALLER_SOURCE_DIRTY')
  await rm(stageDir, { recursive: true, force: true })
  await mkdir(stageDir, { recursive: true })
  await copyFile(installerPath, path.join(stageDir, ADDON_INSTALLER_FILENAME))
  const embedded = createEmbeddedManifest({ desktopSourceCommit: sourceCommit, addon })
  const manifestPathInStage = path.join(stageDir, ADDON_MANIFEST_FILENAME)
  await writeFile(manifestPathInStage, `${JSON.stringify(embedded, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return { addon, embedded, sourceCommit, stageDir }
}

export async function buildSingleInstaller(options) {
  const staged = await stageSingleInstallerInputs(options)
  try {
    run('npm', ['run', 'compile'])
    run('npx', ['electron-builder', '--win', '--x64', '--publish', 'never'])
    const installer = path.join(desktopDir, 'release', `E-Shop-Desktop-Setup-${DESKTOP_VERSION}.exe`)
    const verified = await verifySingleInstaller(installer)
    if (options.output) {
      await mkdir(options.output, { recursive: true })
      await copyFile(installer, path.join(options.output, path.basename(installer)))
      await writeFile(path.join(options.output, 'single-installer-evidence.json'), `${JSON.stringify({
        schemaVersion: 1, desktop: { version: DESKTOP_VERSION, sourceCommit: staged.sourceCommit, installerSha256: verified.installerSha256,
          installer: path.basename(installer) }, addon: { version: staged.addon.version, sourceCommit: staged.addon.sourceCommit,
          installerFile: staged.addon.installerFile, installerSha256: staged.addon.installerSha256, testOnly: staged.addon.testOnly,
          releaseReady: staged.addon.releaseReady }, embedded: verified.embedded, delivery: 'single-desktop-installer',
      }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    }
    return { ...verified, staged, installer }
  } finally {
    await rm(stageDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  buildSingleInstaller({ installerPath: path.resolve(args['addon-installer']), manifestPath: path.resolve(args['addon-manifest']), output: args.output && path.resolve(args.output) })
    .then(result => console.log(JSON.stringify({ installer: result.installer, installerSha256: result.installerSha256, embedded: result.embedded }, null, 2)))
    .catch(error => { console.error(error.message); process.exit(1) })
}

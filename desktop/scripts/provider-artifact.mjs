#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

export const PROVIDER_ARTIFACT_MANIFEST = 'provider-artifact-manifest.json'
const SCHEMA_VERSION = 'eshop.windows-provider-artifact.v1'

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--') || !argv[index + 1]) throw new Error(`invalid argument: ${token}`)
    args[token.slice(2)] = argv[index + 1]
    index += 1
  }
  return args
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function walk(root, directory, output) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Provider artifact must not contain symlinks: ${path}`)
    if (entry.isDirectory() && entry.name === 'node_modules') {
      throw new Error('Provider artifact must not contain node_modules')
    }
    if (entry.isDirectory()) await walk(root, path, output)
    else if (entry.isFile()) output.push(path)
    else throw new Error(`Provider artifact contains unsupported entry: ${path}`)
  }
}

function isMissing(error) {
  return error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

async function assertPathIsFile(path, label) {
  const info = await lstat(path)
  if (!info.isFile()) throw new Error(`${label} must be a regular file: ${path}`)
}

async function assertArtifactRootLayout(root) {
  const entries = await readdir(root, { withFileTypes: true })
  if (entries.some((entry) => entry.name === 'node_modules')) {
    throw new Error('Provider artifact must not contain node_modules')
  }
  const allowed = new Set(['dist', 'package.json', PROVIDER_ARTIFACT_MANIFEST])
  const unexpected = entries.map((entry) => entry.name).filter((name) => !allowed.has(name)).sort()
  if (unexpected.length > 0) {
    throw new Error(`Provider artifact contains non-runtime root entries: ${unexpected.join(', ')}`)
  }
}

async function assertRuntimePackage(artifactDir) {
  const packagePath = join(artifactDir, 'package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  const allowed = new Set(['main', 'name', 'private', 'type', 'version'])
  const unexpected = Object.keys(packageJson).filter((key) => !allowed.has(key)).sort()
  if (unexpected.length > 0) {
    throw new Error(`Provider runtime package contains non-runtime metadata: ${unexpected.join(', ')}`)
  }
  if (
    packageJson.name !== 'eshop-windows-provider' ||
    typeof packageJson.version !== 'string' ||
    packageJson.private !== true ||
    packageJson.type !== 'commonjs' ||
    packageJson.main !== 'dist/index.js'
  ) {
    throw new Error('Provider runtime package identity is invalid')
  }
  return packageJson
}

async function collectArtifactFiles(artifactDir) {
  const packagePath = join(artifactDir, 'package.json')
  const entryPath = join(artifactDir, 'dist', 'index.js')
  await access(packagePath)
  await access(entryPath)
  const files = [packagePath]
  await walk(artifactDir, join(artifactDir, 'dist'), files)
  return files
}

function normalizedRelative(root, path) {
  const value = relative(root, path).split(sep).join('/')
  if (!value || value.startsWith('../') || value.includes('/../')) throw new Error(`unsafe Provider artifact path: ${path}`)
  return value
}

async function artifactDescriptor(artifactDir, path) {
  const info = await lstat(path)
  if (!info.isFile()) throw new Error(`Provider artifact entry is not a file: ${path}`)
  return {
    path: normalizedRelative(artifactDir, path),
    byteSize: info.size,
    sha256: await sha256(path),
  }
}

async function expectedManifest(artifactDir, providerCommit) {
  if (!/^[a-f0-9]{40}$/.test(providerCommit)) throw new Error('provider commit must be a full lowercase Git SHA')
  const packageJson = await assertRuntimePackage(artifactDir)
  const files = []
  for (const path of await collectArtifactFiles(artifactDir)) files.push(await artifactDescriptor(artifactDir, path))
  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return {
    schemaVersion: SCHEMA_VERSION,
    providerCommit,
    packageName: packageJson.name,
    packageVersion: packageJson.version,
    entrypoint: 'dist/index.js',
    files,
  }
}

export async function stageProviderArtifact(sourceDir, artifactDir) {
  const sourceRoot = resolve(sourceDir)
  const destinationRoot = resolve(artifactDir)
  if (sourceRoot === destinationRoot) throw new Error('Provider staging source and destination must differ')

  try {
    await lstat(destinationRoot)
    throw new Error(`Provider staging destination already exists: ${destinationRoot}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Provider staging destination already exists:')) throw error
    if (!isMissing(error)) throw error
  }

  const sourcePackagePath = join(sourceRoot, 'package.json')
  const sourceEntryPath = join(sourceRoot, 'dist', 'index.js')
  await assertPathIsFile(sourcePackagePath, 'Provider source package.json')
  await assertPathIsFile(sourceEntryPath, 'Provider compiled entrypoint')
  const sourcePackage = JSON.parse(await readFile(sourcePackagePath, 'utf8'))
  if (sourcePackage.name !== 'eshop-windows-provider' || typeof sourcePackage.version !== 'string') {
    throw new Error('Provider staging source package identity is invalid')
  }

  await mkdir(dirname(destinationRoot), { recursive: true })
  const temporaryRoot = await mkdtemp(join(dirname(destinationRoot), '.eshop-provider-stage-'))
  try {
    const stagedEntryPath = join(temporaryRoot, 'dist', 'index.js')
    await mkdir(dirname(stagedEntryPath), { recursive: true })
    const bundle = await build({
      absWorkingDir: sourceRoot,
      entryPoints: ['dist/index.js'],
      outfile: stagedEntryPath,
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      minify: true,
      legalComments: 'none',
      metafile: true,
      logLevel: 'silent',
    })
    const outputs = Object.values(bundle.metafile.outputs)
    if (outputs.length !== 1) throw new Error(`Provider staging must produce one bundled entrypoint, got ${outputs.length}`)
    const externalImports = [...new Set(outputs[0].imports.filter((entry) => entry.external).map((entry) => entry.path))].sort()
    const nonBuiltinImports = externalImports.filter((entry) => !entry.startsWith('node:'))
    if (nonBuiltinImports.length > 0) {
      throw new Error(`Provider bundle contains external package imports: ${nonBuiltinImports.join(', ')}`)
    }

    const runtimePackage = {
      name: sourcePackage.name,
      version: sourcePackage.version,
      private: true,
      type: 'commonjs',
      main: 'dist/index.js',
    }
    await writeFile(join(temporaryRoot, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8')
    await rename(temporaryRoot, destinationRoot)
    return {
      sourceDir: sourceRoot,
      artifactDir: destinationRoot,
      entrypoint: 'dist/index.js',
      entrySha256: await sha256(join(destinationRoot, 'dist', 'index.js')),
      bundledInputs: Object.keys(bundle.metafile.inputs).length,
      externalImports,
      result: 'PASS',
    }
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true })
    throw error
  }
}

export async function writeProviderArtifactManifest(artifactDir, providerCommit) {
  const root = resolve(artifactDir)
  const manifest = await expectedManifest(root, providerCommit)
  const path = join(root, PROVIDER_ARTIFACT_MANIFEST)
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { artifactDir: root, manifest: basename(path), files: manifest.files.length, result: 'PASS' }
}

export async function verifyProviderArtifact(artifactDir, providerCommit) {
  const root = resolve(artifactDir)
  await assertArtifactRootLayout(root)
  const path = join(root, PROVIDER_ARTIFACT_MANIFEST)
  const actual = JSON.parse(await readFile(path, 'utf8'))
  const expected = await expectedManifest(root, providerCommit)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Provider artifact manifest does not match the staged self-contained input')
  }
  try {
    await access(join(root, 'node_modules'))
    throw new Error('Provider artifact must not contain node_modules')
  } catch (error) {
    if (error instanceof Error && error.message === 'Provider artifact must not contain node_modules') throw error
    if (!isMissing(error)) throw error
  }
  return {
    artifactDir: root,
    providerCommit,
    manifest: basename(path),
    manifestSha256: await sha256(path),
    entrySha256: actual.files.find((file) => file.path === actual.entrypoint)?.sha256,
    files: actual.files.length,
    result: 'PASS',
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const options = parseArgs(rest)
  if (typeof options['artifact-dir'] !== 'string') {
    throw new Error('usage: provider-artifact.mjs <stage|write|verify> --artifact-dir <path> [--source-dir <path>] [--provider-commit <sha>]')
  }
  let result = null
  if (command === 'stage') {
    if (typeof options['source-dir'] !== 'string') throw new Error('stage requires --source-dir')
    result = await stageProviderArtifact(options['source-dir'], options['artifact-dir'])
  } else if (command === 'write' || command === 'verify') {
    if (typeof options['provider-commit'] !== 'string') throw new Error(`${command} requires --provider-commit`)
    result = command === 'write'
      ? await writeProviderArtifactManifest(options['artifact-dir'], options['provider-commit'])
      : await verifyProviderArtifact(options['artifact-dir'], options['provider-commit'])
  }
  if (!result) throw new Error(`unsupported command: ${command}`)
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    if (entry.isDirectory()) await walk(root, path, output)
    else if (entry.isFile()) output.push(path)
    else throw new Error(`Provider artifact contains unsupported entry: ${path}`)
  }
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
  const packageJson = JSON.parse(await readFile(join(artifactDir, 'package.json'), 'utf8'))
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error('Provider artifact package identity is invalid')
  }
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

export async function writeProviderArtifactManifest(artifactDir, providerCommit) {
  const root = resolve(artifactDir)
  const manifest = await expectedManifest(root, providerCommit)
  const path = join(root, PROVIDER_ARTIFACT_MANIFEST)
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return { artifactDir: root, manifest: basename(path), files: manifest.files.length, result: 'PASS' }
}

export async function verifyProviderArtifact(artifactDir, providerCommit) {
  const root = resolve(artifactDir)
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
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
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
  if (typeof options['artifact-dir'] !== 'string' || typeof options['provider-commit'] !== 'string') {
    throw new Error('usage: provider-artifact.mjs <write|verify> --artifact-dir <path> --provider-commit <sha>')
  }
  const result = command === 'write'
    ? await writeProviderArtifactManifest(options['artifact-dir'], options['provider-commit'])
    : command === 'verify'
      ? await verifyProviderArtifact(options['artifact-dir'], options['provider-commit'])
      : null
  if (!result) throw new Error(`unsupported command: ${command}`)
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}

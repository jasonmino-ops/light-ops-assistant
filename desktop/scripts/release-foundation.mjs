#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const desktopDir = resolve(scriptDir, '..')
const repoRoot = resolve(desktopDir, '..')

const BASELINE_FREEZE_TAG = 'ep-mb3-06b-desktop-activation-runtime-v1.0-final'
const DEFAULT_PROVIDER_COMMIT = '7785be145d5259991038d17839d322e2694e338c'
const PROVENANCE_SCHEMA = 'ep-mb3-07a.release-provenance.v1'
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const HASH_LINE_PATTERN = /^([a-fA-F0-9]{64})  (.+)$/
const SECRET_PATTERN =
  /(GH_TOKEN|GITHUB_TOKEN|SECRET|PASSWORD|Authorization|Bearer|deviceToken|activation credential|certificate password|WIN_CSC|CSC_KEY)/i

const FROZEN_BOUNDARY_GROUPS = [
  {
    label: '06A Cloud Activation Contract',
    paths: ['docs/milestone-b/EP-MB3-06A-CLOUD-DESKTOP-ACTIVATION-API-CONTRACT.md'],
  },
  {
    label: 'ActivationRuntime',
    paths: ['desktop/src/main/activation/activationRuntime.ts'],
  },
  {
    label: 'CredentialStore',
    paths: ['desktop/src/main/activation/credentialStore.ts'],
  },
  {
    label: 'main startup gate',
    paths: ['desktop/src/main/main.ts'],
  },
  {
    label: 'WindowManager',
    paths: ['desktop/src/main/windowManager.ts'],
  },
  {
    label: 'Runtime Core',
    paths: ['desktop/src/main/hrt'],
  },
  {
    label: 'Provider Contract',
    paths: ['packages/hrt-contract'],
  },
  {
    label: 'Prisma',
    paths: ['prisma'],
  },
  {
    label: 'Payment',
    paths: ['app/api/payments', 'app/api/sales', 'app/api/orders'],
  },
  {
    label: 'Printer',
    paths: ['lib/cloudPrinter.ts', 'app/api/print', 'app/api/printer'],
  },
  {
    label: 'Scanner',
    paths: ['app/sale', 'app/components/Scanner', 'desktop/src/main/hardware'],
  },
  {
    label: 'cashier/customer/mobile business',
    paths: ['app/cashier', 'app/menu', 'app/m', 'app/home', 'app/invite', 'app/table-qrcodes', 'app/records'],
  },
]

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) {
      throw new Error(`unexpected argument: ${value}`)
    }
    const key = value.slice(2)
    const next = argv[index + 1]
    if (next == null || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      index += 1
    }
  }
  return args
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function validateSemver(version) {
  const match = version.match(SEMVER_PATTERN)
  if (!match) throw new Error(`invalid Desktop semver: ${version}`)
  return {
    version,
    prerelease: match[4] ?? null,
  }
}

function inferReleaseChannel(version) {
  const parsed = validateSemver(version)
  if (parsed.prerelease == null) return 'stable'
  const prereleaseParts = parsed.prerelease.split('.')
  if (prereleaseParts[0] === 'pilot') return 'pilot'
  throw new Error(`unsupported prerelease channel for Desktop version ${version}`)
}

function expectedUpdateMetadataName(channel) {
  if (channel === 'pilot') return 'pilot.yml'
  if (channel === 'stable') return 'latest.yml'
  throw new Error(`unsupported release channel: ${channel}`)
}

function expectedTag(version) {
  return `desktop-v${version}`
}

function expectedInstallerName(version) {
  return `E-Shop-Desktop-Setup-${version}.exe`
}

async function sha256(path) {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function fileDescriptor(path) {
  const info = await stat(path)
  return {
    fileName: basename(path),
    byteSize: info.size,
    sha256: await sha256(path),
  }
}

async function assertExists(path, label) {
  try {
    await access(path)
  } catch {
    throw new Error(`missing ${label}: ${path}`)
  }
}

function assertNoDuplicateNames(files) {
  const names = new Set()
  for (const file of files) {
    const name = basename(file)
    if (names.has(name)) throw new Error(`duplicate release asset filename: ${name}`)
    names.add(name)
  }
}

function assertNoSecrets(text, label) {
  if (SECRET_PATTERN.test(text)) {
    throw new Error(`${label} contains forbidden secret-like text`)
  }
}

async function loadReleaseFacts() {
  const desktopPackage = await readJson(join(desktopDir, 'package.json'))
  const rootPackage = await readJson(join(repoRoot, 'package.json'))
  const electronPackage = await readJson(join(desktopDir, 'node_modules/electron/package.json'))
  const electronBuilderPackage = await readJson(join(desktopDir, 'node_modules/electron-builder/package.json'))
  const builderConfig = await readFile(join(desktopDir, 'electron-builder.yml'), 'utf8')
  const version = desktopPackage.version
  const channel = inferReleaseChannel(version)

  return {
    packageName: desktopPackage.name,
    productName: desktopPackage.productName,
    version,
    rootPackageName: rootPackage.name,
    rootPackageVersion: rootPackage.version,
    channel,
    defaultRuntimeChannel: 'stable',
    distributionClass: channel === 'pilot' ? 'unsigned-internal' : 'signed-commercial',
    tag: expectedTag(version),
    installerName: expectedInstallerName(version),
    updateMetadataName: expectedUpdateMetadataName(channel),
    electronVersion: electronPackage.version,
    electronBuilderVersion: electronBuilderPackage.version,
    builderConfig,
  }
}

function validateBuilderConfig(facts) {
  const config = facts.builderConfig
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
  if (!/artifactName:\s*["']?E-Shop-Desktop-Setup-\$\{version\}\.\$\{ext\}["']?/.test(config)) {
    throw new Error('electron-builder artifactName must include ${version}')
  }
  if (/publish:\s*null/.test(config)) {
    throw new Error('electron-builder publish must not be null for Phase 1 update metadata')
  }
  if (!/provider:\s*github/.test(config)) {
    throw new Error('electron-builder publish provider must be github')
  }
  if (!/owner:\s*jasonmino-ops/.test(config) || !/repo:\s*light-ops-assistant/.test(config)) {
    throw new Error('electron-builder GitHub publish owner/repo mismatch')
  }
  if (/signed-commercial/.test(config)) {
    throw new Error('electron-builder config must not mark unsigned Phase 1 as signed-commercial')
  }
}

async function runPolicy(options) {
  const facts = await loadReleaseFacts()
  if (facts.packageName !== 'eshop-desktop') {
    throw new Error(`unexpected Desktop package name: ${facts.packageName}`)
  }
  if (facts.rootPackageName === facts.packageName) {
    throw new Error('root package cannot be the Desktop version source')
  }
  if (facts.channel !== 'pilot' || facts.version !== '0.2.0-pilot.1') {
    throw new Error(`Phase 1 must use 0.2.0-pilot.1, got ${facts.version}`)
  }
  validateBuilderConfig(facts)

  const desktopBuildWorkflow = await readFile(join(repoRoot, '.github/workflows/desktop-windows-build.yml'), 'utf8')
  if (/gh\s+release\s+create|gh\s+release\s+upload|contents:\s*write/.test(desktopBuildWorkflow)) {
    throw new Error('ordinary desktop-windows-build workflow must not publish GitHub Releases')
  }

  const pilotWorkflowPath = join(repoRoot, '.github/workflows/desktop-release-pilot.yml')
  let pilotWorkflow = ''
  try {
    pilotWorkflow = await readFile(pilotWorkflowPath, 'utf8')
  } catch {
    if (options['allow-missing-pilot-workflow'] !== true) {
      throw new Error('missing pilot release workflow')
    }
  }
  if (pilotWorkflow) {
    if (!/workflow_dispatch:/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must be manually dispatched')
    }
    if (/\n\s+push:/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must not run on push')
    }
    if (!/environment:\s*pilot-release/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must reference pilot-release environment')
    }
    if (!/contents:\s*write/.test(pilotWorkflow)) {
      throw new Error('pilot release job must explicitly request contents: write')
    }
    if (!/--prerelease/.test(pilotWorkflow)) {
      throw new Error('pilot release must create a GitHub prerelease')
    }
  }

  const baseline = options.baseline ?? BASELINE_FREEZE_TAG
  const frozenBoundary = []
  for (const group of FROZEN_BOUNDARY_GROUPS) {
    const changed = git(['diff', '--name-only', baseline, '--', ...group.paths])
      .split('\n')
      .filter(Boolean)
    frozenBoundary.push({
      label: group.label,
      status: changed.length === 0 ? 'PASS' : 'FAIL',
      changed,
    })
  }
  const failed = frozenBoundary.filter((group) => group.status !== 'PASS')
  if (failed.length > 0) {
    throw new Error(`frozen boundary changed: ${failed.map((group) => group.label).join(', ')}`)
  }

  return {
    versionSource: 'desktop/package.json',
    rootPackageVersion: facts.rootPackageVersion,
    desktopVersion: facts.version,
    releaseChannel: facts.channel,
    defaultRuntimeChannel: facts.defaultRuntimeChannel,
    distributionClass: 'unsigned-internal',
    tag: facts.tag,
    installerName: facts.installerName,
    updateMetadataName: facts.updateMetadataName,
    frozenBoundary,
  }
}

async function listReleaseFiles(releaseDir, facts) {
  const installer = join(releaseDir, facts.installerName)
  const blockmap = `${installer}.blockmap`
  const metadataName = expectedUpdateMetadataName(facts.channel)

  await assertExists(installer, 'versioned installer')
  await assertExists(blockmap, 'installer blockmap')

  const allEntries = await readdir(releaseDir)
  const ymlFiles = allEntries.filter((entry) => entry.endsWith('.yml') && entry !== 'builder-debug.yml')
  if (!ymlFiles.includes(metadataName)) {
    if (ymlFiles.length !== 1) {
      throw new Error(
        `expected update metadata ${metadataName}; actual metadata files: ${ymlFiles.join(', ') || '(none)'}`,
      )
    }
    console.warn(`using actual update metadata ${ymlFiles[0]} instead of inferred ${metadataName}`)
  }

  return {
    installer,
    blockmap,
    metadataFiles: ymlFiles.map((entry) => join(releaseDir, entry)).sort(),
  }
}

async function writeReleaseNotes(releaseDir, facts) {
  const fileName = `release-notes-${facts.version}.md`
  const filePath = join(releaseDir, fileName)
  const content = [
    `# E-Shop Desktop ${facts.version}`,
    '',
    'EP-MB3-07A Phase 1 unsigned internal pilot release foundation.',
    '',
    '- Distribution class: unsigned-internal',
    '- Channel: pilot',
    '- Store pilot / commercial release: not ready until Signed Distribution Gate passes',
    '',
  ].join('\n')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

async function writeManifests(options) {
  const facts = await loadReleaseFacts()
  validateBuilderConfig(facts)
  if (facts.channel !== 'pilot') {
    throw new Error(`Phase 1 write supports pilot only, got ${facts.channel}`)
  }

  const distributionClass = options['distribution-class'] ?? 'unsigned-internal'
  if (distributionClass !== 'unsigned-internal') {
    throw new Error(`Phase 1 distributionClass must be unsigned-internal, got ${distributionClass}`)
  }
  const signingStatus = options['signing-status'] ?? 'unsigned-internal'
  if (signingStatus !== 'unsigned-internal') {
    throw new Error(`Phase 1 signingStatus must be unsigned-internal, got ${signingStatus}`)
  }

  const releaseDir = resolve(desktopDir, options['release-dir'] ?? 'release')
  await mkdir(releaseDir, { recursive: true })
  const releaseFiles = await listReleaseFiles(releaseDir, facts)
  const releaseNotes = await writeReleaseNotes(releaseDir, facts)
  const tag = options.tag ?? facts.tag
  if (tag !== facts.tag) throw new Error(`release tag must be ${facts.tag}, got ${tag}`)

  const baseAssetFiles = [
    releaseFiles.installer,
    releaseFiles.blockmap,
    ...releaseFiles.metadataFiles,
    releaseNotes,
  ]
  assertNoDuplicateNames(baseAssetFiles)
  const artifacts = []
  for (const file of baseAssetFiles) artifacts.push(await fileDescriptor(file))

  const provenanceFileName = `release-provenance-${facts.version}.json`
  const provenancePath = join(releaseDir, provenanceFileName)
  const provenance = {
    schemaVersion: PROVENANCE_SCHEMA,
    packageName: facts.packageName,
    desktopVersion: facts.version,
    releaseChannel: facts.channel,
    defaultRuntimeChannel: facts.defaultRuntimeChannel,
    distributionClass,
    gitCommitSha: options.commit ?? process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']),
    gitTag: tag,
    workflowName: options['workflow-name'] ?? process.env.GITHUB_WORKFLOW ?? 'local-dry-run',
    workflowRunId: String(options['workflow-run-id'] ?? process.env.GITHUB_RUN_ID ?? 'local-dry-run'),
    buildTimestamp: options['build-timestamp'] ?? process.env.BUILD_TIMESTAMP ?? new Date().toISOString(),
    nodeVersion: process.version,
    electronVersion: facts.electronVersion,
    electronBuilderVersion: facts.electronBuilderVersion,
    artifactFilenames: artifacts.map((artifact) => artifact.fileName),
    artifacts,
    signingStatus,
    providerPinnedCommit: options['provider-commit'] ?? process.env.EP_MB3_PROVIDER_COMMIT ?? DEFAULT_PROVIDER_COMMIT,
    baselineFreezeTag: options['baseline-freeze-tag'] ?? BASELINE_FREEZE_TAG,
  }

  const provenanceText = `${JSON.stringify(provenance, null, 2)}\n`
  assertNoSecrets(provenanceText, provenanceFileName)
  await writeFile(provenancePath, provenanceText, 'utf8')

  const shaFiles = [...baseAssetFiles, provenancePath]
  assertNoDuplicateNames(shaFiles)
  const shaLines = []
  for (const file of shaFiles.sort((a, b) => basename(a).localeCompare(basename(b)))) {
    shaLines.push(`${await sha256(file)}  ${basename(file)}`)
  }
  const shaManifestPath = join(releaseDir, 'SHA256SUMS.txt')
  await writeFile(shaManifestPath, `${shaLines.join('\n')}\n`, 'utf8')

  return verifyManifests({ ...options, 'release-dir': releaseDir })
}

async function parseShaManifest(path) {
  const text = await readFile(path, 'utf8')
  assertNoSecrets(text, basename(path))
  const entries = []
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    const match = line.match(HASH_LINE_PATTERN)
    if (!match) throw new Error(`invalid SHA256SUMS line ${index + 1}: ${line}`)
    entries.push({ sha256: match[1].toLowerCase(), fileName: match[2] })
  }
  assertNoDuplicateNames(entries.map((entry) => entry.fileName))
  return entries
}

async function verifyManifests(options) {
  const facts = await loadReleaseFacts()
  const releaseDir = resolve(desktopDir, options['release-dir'] ?? 'release')
  const shaManifestPath = join(releaseDir, 'SHA256SUMS.txt')
  const provenancePath = join(releaseDir, `release-provenance-${facts.version}.json`)

  await assertExists(shaManifestPath, 'SHA256SUMS.txt')
  await assertExists(provenancePath, 'release provenance manifest')

  const entries = await parseShaManifest(shaManifestPath)
  for (const entry of entries) {
    const filePath = join(releaseDir, entry.fileName)
    await assertExists(filePath, `SHA asset ${entry.fileName}`)
    const actual = await sha256(filePath)
    if (actual !== entry.sha256) {
      throw new Error(`SHA mismatch for ${entry.fileName}: expected ${entry.sha256}, got ${actual}`)
    }
  }

  const provenanceText = await readFile(provenancePath, 'utf8')
  assertNoSecrets(provenanceText, basename(provenancePath))
  const provenance = JSON.parse(provenanceText)
  const requiredFields = [
    'schemaVersion',
    'packageName',
    'desktopVersion',
    'releaseChannel',
    'defaultRuntimeChannel',
    'distributionClass',
    'gitCommitSha',
    'gitTag',
    'workflowName',
    'workflowRunId',
    'buildTimestamp',
    'nodeVersion',
    'electronVersion',
    'electronBuilderVersion',
    'artifactFilenames',
    'artifacts',
    'signingStatus',
    'providerPinnedCommit',
    'baselineFreezeTag',
  ]
  for (const field of requiredFields) {
    if (provenance[field] == null) throw new Error(`provenance missing field: ${field}`)
  }
  if (provenance.schemaVersion !== PROVENANCE_SCHEMA) throw new Error('provenance schema mismatch')
  if (provenance.desktopVersion !== facts.version) throw new Error('provenance version mismatch')
  if (provenance.releaseChannel !== facts.channel) throw new Error('provenance channel mismatch')
  if (provenance.gitTag !== facts.tag) throw new Error(`provenance tag must be ${facts.tag}`)
  if (provenance.distributionClass !== 'unsigned-internal') {
    throw new Error(`Phase 1 provenance must be unsigned-internal, got ${provenance.distributionClass}`)
  }
  if (provenance.signingStatus !== 'unsigned-internal') {
    throw new Error(`Phase 1 signingStatus must be unsigned-internal, got ${provenance.signingStatus}`)
  }

  const entryNames = new Set(entries.map((entry) => entry.fileName))
  const metadataArtifactNames = provenance.artifacts
    .map((artifact) => artifact.fileName)
    .filter((fileName) => fileName.endsWith('.yml') && fileName !== 'builder-debug.yml')
  if (metadataArtifactNames.length === 0) {
    throw new Error('provenance missing update metadata artifact')
  }
  for (const expected of [
    facts.installerName,
    `${facts.installerName}.blockmap`,
    `release-notes-${facts.version}.md`,
    `release-provenance-${facts.version}.json`,
    ...metadataArtifactNames,
  ]) {
    if (!entryNames.has(expected)) throw new Error(`SHA manifest missing release asset: ${expected}`)
  }

  const provenanceArtifactNames = new Set(provenance.artifacts.map((artifact) => artifact.fileName))
  for (const expected of [
    facts.installerName,
    `${facts.installerName}.blockmap`,
    `release-notes-${facts.version}.md`,
    ...metadataArtifactNames,
  ]) {
    if (!provenanceArtifactNames.has(expected)) throw new Error(`provenance missing artifact: ${expected}`)
  }

  return {
    version: facts.version,
    releaseChannel: facts.channel,
    distributionClass: provenance.distributionClass,
    tag: facts.tag,
    installerName: facts.installerName,
    updateMetadataName: metadataArtifactNames.join(','),
    shaManifest: basename(shaManifestPath),
    provenance: basename(provenancePath),
    shaEntries: entries.length,
    result: 'PASS',
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  const options = parseArgs(rest)
  let result
  if (command === 'policy') {
    result = await runPolicy(options)
  } else if (command === 'write') {
    result = await writeManifests(options)
  } else if (command === 'verify') {
    result = await verifyManifests(options)
  } else {
    throw new Error(`usage: release-foundation.mjs <policy|write|verify> [--release-dir dir]`)
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

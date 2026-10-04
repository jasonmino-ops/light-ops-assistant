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
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { evaluateFile, validateException } = require('../../scripts/guards/check-change-scope.js')
const { validateRegister, validatePilot, validatePilotSourcePaths } = require('../../scripts/governance/delivery-classification.cjs')

const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const desktopDir = resolve(scriptDir, '..')
const repoRoot = resolve(desktopDir, '..')

const BASELINE_FREEZE_TAG = '439dcac561734d07b9e022c8d99e693c99d26794'
const DEFAULT_PROVIDER_COMMIT = '7785be145d5259991038d17839d322e2694e338c'
const RISK_REGISTER_PATH = 'docs/governance/ES-ENGINEERING-RISK-BASED-DELIVERY-01-register.json'
const PROVENANCE_SCHEMA = 'ep-mb3-07a.release-provenance.v1'
const COMMERCIAL_PILOT_DESKTOP_VERSION = '0.3.0-commercial-pilot.1'
const COMMERCIAL_PILOT_BASELINE = '8b326f7d0bf1add435e36a8518c227d4e9e4c575'
const COMMERCIAL_PILOT_RELEASE_STATUS = 'COMMERCIAL_PILOT_CANDIDATE'
const PHASE1_UPDATE_METADATA_NAME = 'latest.yml'
const SHA_MANIFEST_NAME = 'SHA256SUMS.txt'
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

const FROZEN_BOUNDARY_SUCCESSORS = new Map([
  ['main startup gate', '5756a4476f36f0d847835fd3ea83679240c86856'],
  ['WindowManager', '17c764427f1e53288dedb82a1965b1365c1ded3d'],
  ['Scanner', '8317b4c2bd0ee0a90b7df4b2fe64b3489ebd6a99'],
  ['Prisma', 'cb55c5a9e78cb7f80c8295a0387bb82cb0af8494'],
  ['cashier/customer/mobile business', '8fdf9b310a9b23e1e3c9e02cf88ec2790a9f879c'],
])

const COMMERCIAL_PILOT_AUTHORIZED_BOUNDARIES = new Map([
  ['ActivationRuntime', new Map([
    ['desktop/src/main/activation/activationRuntime.ts', '9f08e00cfb59d0d41015a5a1c20d0627885b6b05a1548cde5049d46fc9b9b8a9'],
  ])],
  ['CredentialStore', new Map([
    ['desktop/src/main/activation/credentialStore.ts', 'f0dafcb93de98d69eab1798c86e61e48b7e33e75e688667cbfd77a8a8c787103'],
  ])],
  ['main startup gate', new Map([
    ['desktop/src/main/main.ts', 'aef3d6426a3be6dee55426e3104071f6118281c37278ee49ab53be07e375113a'],
  ])],
  ['WindowManager', new Map([
    ['desktop/src/main/windowManager.ts', '14497c1c0eac104fe70586a4bd40201cc5284425e3051e9059d7b70c39fce590'],
  ])],
])

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

function gitBytes(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function gitIsAncestor(ancestor, descendant) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
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
  if (prereleaseParts[0] === 'commercial-pilot') return 'commercial-pilot'
  throw new Error(`unsupported prerelease channel for Desktop version ${version}`)
}

function expectedUpdateMetadataName(channel) {
  if (channel === 'pilot' || channel === 'commercial-pilot') return PHASE1_UPDATE_METADATA_NAME
  if (channel === 'stable') return 'latest.yml'
  throw new Error(`unsupported release channel: ${channel}`)
}

function expectedTag(version) {
  return `desktop-v${version}`
}

function expectedInstallerName(version) {
  return `E-Shop-Desktop-Setup-${version}-x64.exe`
}

function expectedReleaseNotesName(version) {
  return `release-notes-${version}.md`
}

function expectedProvenanceName(version) {
  return `release-provenance-${version}.json`
}

function expectedReleaseAssetNames(facts) {
  return [
    facts.installerName,
    `${facts.installerName}.blockmap`,
    facts.updateMetadataName,
    SHA_MANIFEST_NAME,
    expectedProvenanceName(facts.version),
    expectedReleaseNotesName(facts.version),
  ].sort()
}

function expectedShaAssetNames(facts) {
  return expectedReleaseAssetNames(facts).filter((fileName) => fileName !== SHA_MANIFEST_NAME)
}

function expectedProvenanceArtifactNames(facts) {
  return [
    facts.installerName,
    `${facts.installerName}.blockmap`,
    facts.updateMetadataName,
    expectedReleaseNotesName(facts.version),
  ].sort()
}

function isGitHubGeneratedSourceArchive(fileName, facts) {
  const normalized = fileName.toLowerCase()
  const tag = facts.tag.toLowerCase()
  return (
    normalized === `${tag}.zip` ||
    normalized === `${tag}.tar.gz` ||
    normalized === 'source-code.zip' ||
    normalized === 'source-code.tar.gz'
  )
}

function assertSameNames(actualNames, expectedNames, label) {
  const actual = [...actualNames].sort()
  const expected = [...expectedNames].sort()
  assertNoDuplicateNames(actual)
  assertNoDuplicateNames(expected)
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const missing = expected.filter((fileName) => !actualSet.has(fileName))
  const unexpected = actual.filter((fileName) => !expectedSet.has(fileName))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} mismatch; missing: ${missing.join(', ') || '(none)'}; unexpected: ${
        unexpected.join(', ') || '(none)'
      }`,
    )
  }
}

function assertContainsNames(actualNames, expectedNames, label) {
  assertNoDuplicateNames(actualNames)
  const actual = new Set(actualNames)
  const missing = [...expectedNames].sort().filter((fileName) => !actual.has(fileName))
  if (missing.length > 0) {
    throw new Error(`${label} missing release asset: ${missing.join(', ')}`)
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  hash.update(await readFile(path))
  return hash.digest('hex')
}

async function sourceSha256(path) {
  return sha256Bytes((await readFile(path, 'utf8')).replaceAll('\r\n', '\n'))
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertCommitSha(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/.test(value)) {
    throw new Error(`${label} must be a full lowercase commit SHA`)
  }
}

function gitObjectExists(commit) {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

function gitBlobSha256(commit, filePath) {
  try {
    return sha256Bytes(gitBytes(['show', `${commit}:${filePath}`]))
  } catch {
    throw new Error(`missing source file at ${commit}: ${filePath}`)
  }
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
    distributionClass: channel === 'stable' ? 'signed-commercial' : 'unsigned-internal',
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
  if (!/artifactName:\s*["']?E-Shop-Desktop-Setup-\$\{version\}-x64\.\$\{ext\}["']?/.test(config)) {
    throw new Error('electron-builder artifactName must be the versioned x64 commercial-pilot identity')
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
  if (!/provider-artifact-manifest\.json/.test(config) || !/eshop-windows-provider/.test(config)) {
    throw new Error('electron-builder must package the verified Windows Provider artifact and manifest')
  }
}

async function runPolicy(options) {
  const riskRegister = await readJson(join(repoRoot, RISK_REGISTER_PATH))
  validateRegister(riskRegister)
  const facts = await loadReleaseFacts()
  if (facts.packageName !== 'eshop-desktop') {
    throw new Error(`unexpected Desktop package name: ${facts.packageName}`)
  }
  if (facts.rootPackageName === facts.packageName) {
    throw new Error('root package cannot be the Desktop version source')
  }
  if (facts.channel !== 'commercial-pilot' || facts.version !== COMMERCIAL_PILOT_DESKTOP_VERSION) {
    throw new Error(`Commercial Pilot must use ${COMMERCIAL_PILOT_DESKTOP_VERSION}, got ${facts.version}`)
  }
  validateBuilderConfig(facts)

  const desktopBuildWorkflow = await readFile(join(repoRoot, '.github/workflows/desktop-windows-build.yml'), 'utf8')
  if (/gh\s+release\s+create|gh\s+release\s+upload|contents:\s*write/.test(desktopBuildWorkflow)) {
    throw new Error('ordinary desktop-windows-build workflow must not publish GitHub Releases')
  }
  if (!/provider-artifact\.mjs write/.test(desktopBuildWorkflow) ||
    !/verify-installed-resources\.mjs/.test(desktopBuildWorkflow)) {
    throw new Error('ordinary Windows build must verify the deterministic Provider input and installed resources')
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
    if (/builder-debug\.yml/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must not publish builder-debug.yml')
    }
    if (/pilot-release\/\*\.yml|desktop\/release\/\*\.yml|desktop\/release\/\*/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must not publish broad release directory globs')
    }
    if (!/Stage allowlisted pilot release assets/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must stage an explicit release asset allowlist')
    }
    if (!/pilot-release-bundle\/latest\.yml/.test(pilotWorkflow) || !/pilot-release\/latest\.yml/.test(pilotWorkflow)) {
      throw new Error('pilot workflow must upload and publish latest.yml through the explicit allowlist')
    }
    if (!pilotWorkflow.includes(COMMERCIAL_PILOT_DESKTOP_VERSION) ||
      !/provider-artifact\.mjs write/.test(pilotWorkflow) ||
      !/verify-installed-resources\.mjs/.test(pilotWorkflow)) {
      throw new Error('commercial-pilot workflow identity or self-contained verification is missing')
    }
  }

  const desktopRuntimeSources = [
    await readFile(join(desktopDir, 'src/main/printing/printerDiscovery.ts'), 'utf8'),
    await readFile(join(desktopDir, 'src/main/printing/printerSetupService.ts'), 'utf8'),
  ].join('\n')
  if (/powershell\.exe/i.test(desktopRuntimeSources)) {
    throw new Error('Desktop printer onboarding runtime must not depend on PowerShell')
  }

  const baseline = options.baseline ?? COMMERCIAL_PILOT_BASELINE
  const allowAuthorizedSuccessors = options.baseline == null
  const frozenBoundary = []
  for (const group of FROZEN_BOUNDARY_GROUPS) {
    const changed = git(['diff', '--name-only', baseline, '--', ...group.paths])
      .split('\n')
      .filter(Boolean)
    const successorSnapshot = allowAuthorizedSuccessors ? FROZEN_BOUNDARY_SUCCESSORS.get(group.label) : undefined
    const commercialPilotHashes = COMMERCIAL_PILOT_AUTHORIZED_BOUNDARIES.get(group.label)
    const commercialPilotAuthorized = Boolean(
      allowAuthorizedSuccessors &&
      changed.length > 0 &&
      commercialPilotHashes &&
      changed.length === commercialPilotHashes.size &&
      changed.every((filePath) => commercialPilotHashes.has(filePath)) &&
      (await Promise.all(changed.map(async (filePath) =>
        await sourceSha256(join(repoRoot, filePath)) === commercialPilotHashes.get(filePath)))).every(Boolean),
    )
    const matchesAuthorizedSuccessor =
      changed.length > 0 &&
      successorSnapshot != null &&
      gitIsAncestor(successorSnapshot, 'HEAD') &&
      git(['diff', '--name-only', successorSnapshot, '--', ...group.paths]) === ''
    frozenBoundary.push({
      label: group.label,
      status: changed.length === 0 || matchesAuthorizedSuccessor || commercialPilotAuthorized ? 'PASS' : 'FAIL',
      changed,
      ...(matchesAuthorizedSuccessor ? { authorizedSuccessorSnapshot: successorSnapshot } : {}),
      ...(commercialPilotAuthorized && changed.length > 0 ? {
        authorizedCommercialPilotScope: true,
        authorizedPathSha256: Object.fromEntries(commercialPilotHashes),
      } : {}),
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
    releaseStatus: COMMERCIAL_PILOT_RELEASE_STATUS,
    frozenBoundary,
  }
}

function assertExactPathHashes(sourceCommit, paths, hashes, label) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error(`${label}.boundaryPaths must be a non-empty array`)
  }
  if (!hashes || typeof hashes !== 'object' || Array.isArray(hashes)) {
    throw new Error(`${label}.authorizedPathSha256 must be an object`)
  }
  const hashPaths = Object.keys(hashes).sort()
  const expectedPaths = [...paths].sort()
  if (hashPaths.length !== expectedPaths.length || hashPaths.some((path, index) => path !== expectedPaths[index])) {
    throw new Error(`${label}.authorizedPathSha256 must exactly cover boundaryPaths`)
  }
  for (const filePath of paths) {
    if (!/^[a-zA-Z0-9._/-]+$/.test(filePath) || filePath.startsWith('/') || filePath.includes('..')) {
      throw new Error(`${label} contains an invalid exact path: ${filePath}`)
    }
    if (!/^[a-f0-9]{64}$/.test(hashes[filePath])) {
      throw new Error(`${label} has an invalid SHA-256 for ${filePath}`)
    }
    if (gitBlobSha256(sourceCommit, filePath) !== hashes[filePath]) {
      throw new Error(`${label} SHA-256 mismatch for ${filePath}`)
    }
  }
}

async function runSourceAcceptance(options) {
  const taskId = options['task-id']
  const sourceCommit = options['source-commit']
  const productionSha = options['production-sha']
  if (typeof taskId !== 'string' || taskId.trim() === '') throw new Error('source-policy requires --task-id')
  assertCommitSha(sourceCommit, 'source-policy --source-commit')
  assertCommitSha(productionSha, 'source-policy --production-sha')

  const register = await readJson(join(repoRoot, RISK_REGISTER_PATH))
  validateRegister(register)
  if (register.schemaVersion !== 'es-risk-based-delivery.register.v1' || register.status !== 'ACTIVE_AFTER_MAIN_MERGE') {
    throw new Error('risk-based delivery register is not active and valid')
  }
  const pilot = register.sourceAcceptancePilots?.find((entry) => entry.taskId === taskId)
  if (!pilot) throw new Error(`unregistered source acceptance task: ${taskId}`)
  validatePilot(pilot)
  if (pilot.sourceCommit !== sourceCommit) {
    throw new Error(`source commit does not match registered task ${taskId}`)
  }
  assertCommitSha(pilot.baselineOriginMain, `${taskId}.baselineOriginMain`)
  if (!gitObjectExists(sourceCommit)) throw new Error(`source commit is unavailable: ${sourceCommit}`)

  const currentOriginMain = git(['rev-parse', 'origin/main'])
  let trustedRegister
  try {
    trustedRegister = JSON.parse(gitBytes(['show', `origin/main:${RISK_REGISTER_PATH}`]).toString('utf8'))
  } catch {
    throw new Error('risk-based delivery Addendum/register is not active in trusted origin/main')
  }
  if (JSON.stringify(trustedRegister) !== JSON.stringify(register)) {
    throw new Error('working-tree risk-based delivery register differs from trusted origin/main')
  }
  if (!gitIsAncestor(pilot.baselineOriginMain, currentOriginMain)) {
    throw new Error(`registered origin/main baseline is not an ancestor of current origin/main: ${pilot.baselineOriginMain}`)
  }
  if (git(['status', '--porcelain']) !== '') throw new Error('source-policy requires a clean worktree')
  if (!gitIsAncestor(productionSha, currentOriginMain)) {
    throw new Error(`Production SHA is not an ancestor of origin/main: ${productionSha}`)
  }
  if (!gitIsAncestor(pilot.baselineOriginMain, sourceCommit)) {
    throw new Error(`source commit is not a descendant of the registered origin/main: ${sourceCommit}`)
  }

  const exception = await readJson(join(repoRoot, pilot.scopeExceptionPath))
  let validatedException
  try {
    const trustedExceptionText = gitBytes(['show', `origin/main:${pilot.scopeExceptionPath}`])
    const trustedException = JSON.parse(trustedExceptionText.toString('utf8'))
    if (JSON.stringify(trustedException) !== JSON.stringify(exception)) {
      throw new Error('working-tree exception differs from trusted origin/main')
    }
    validatedException = validateException(trustedException, repoRoot)
  } catch (error) {
    throw new Error(`scope exception failed trusted validation: ${error.message}`)
  }
  if (
    validatedException.taskId !== taskId ||
    validatedException.status !== 'ACTIVE' ||
    validatedException.lineageMode !== 'PRE_COMMIT_CONTENT_SHA256' ||
    validatedException.baseOriginMainSha !== pilot.baselineOriginMain ||
    validatedException.featureBranch !== pilot.sourceBranch
  ) {
    throw new Error(`scope exception is not the exact active authorization for ${taskId}`)
  }
  if (
    JSON.stringify([...exception.authorizedPaths].sort()) !== JSON.stringify([...pilot.boundaryPaths].sort()) ||
    JSON.stringify(exception.authorizedPathSha256) !== JSON.stringify(pilot.authorizedPathSha256)
  ) {
    throw new Error(`scope exception does not exactly match registered source acceptance for ${taskId}`)
  }

  const targetGroup = FROZEN_BOUNDARY_GROUPS.find((group) => group.label === pilot.boundaryGroup)
  if (!targetGroup) throw new Error(`unknown frozen boundary group: ${pilot.boundaryGroup}`)
  const changedSourcePaths = git(['diff', '--name-only', pilot.baselineOriginMain, sourceCommit, '--'])
    .split('\n')
    .filter(Boolean)
  validatePilotSourcePaths(changedSourcePaths, pilot)
  const frozenBoundary = []
  for (const group of FROZEN_BOUNDARY_GROUPS) {
    const changed = git(['diff', '--name-only', pilot.baselineOriginMain, sourceCommit, '--', ...group.paths])
      .split('\n')
      .filter(Boolean)
    if (group.label !== targetGroup.label && changed.length > 0) {
      throw new Error(`unregistered frozen boundary change: ${group.label}`)
    }
    frozenBoundary.push({ label: group.label, changed, status: changed.length === 0 ? 'PASS' : 'REGISTERED_SUCCESSOR' })
  }
  const changedTarget = frozenBoundary.find((group) => group.label === targetGroup.label)
  if (JSON.stringify(changedTarget.changed) !== JSON.stringify([...pilot.boundaryPaths].sort())) {
    throw new Error(`registered boundary paths do not match source diff for ${taskId}`)
  }
  assertExactPathHashes(sourceCommit, pilot.boundaryPaths, pilot.authorizedPathSha256, taskId)

  const trustedConfig = JSON.parse(
    gitBytes(['show', 'origin/main:docs/change-gates/gate-config.json']).toString('utf8'),
  )
  const scopeResults = changedSourcePaths.map((filePath) => evaluateFile({
    filePath,
    repoRoot,
    config: trustedConfig,
    taskId,
    currentBranch: pilot.sourceBranch,
    exception: validatedException,
    contentHashResolver: (candidate) => gitBlobSha256(sourceCommit, candidate),
  }))
  const scopeFailures = scopeResults.filter((result) => !result.allowed)
  if (scopeFailures.length > 0) {
    throw new Error(`Scope Guard failed for source commit: ${scopeFailures.map((result) => `${result.filePath} (${result.reason})`).join(', ')}`)
  }

  if (!['L1', 'L2'].includes(pilot.riskClass)) throw new Error(`${taskId} source acceptance pilot must be L1 or L2`)
  if (pilot.fieldStatus !== 'MILESTONE_FIELD_PENDING' || typeof pilot.milestoneTarget !== 'string' || pilot.milestoneTarget.trim() === '') {
    throw new Error(`${taskId} must record FIELD status MILESTONE_FIELD_PENDING and a Milestone target`)
  }
  const fieldDebt = register.fieldDebt?.filter((entry) => entry.task === 'ES-DESKTOP-UX-01 / P1B') ?? []
  if (fieldDebt.some((entry) => entry.status === 'PASS')) throw new Error('FIELD debt register cannot record deferred debt as PASS')

  return {
    mode: 'SOURCE_ACCEPTANCE',
    result: 'PASS',
    taskId,
    riskClass: pilot.riskClass,
    sourceCommit,
    baselineOriginMain: pilot.baselineOriginMain,
    productionSha,
    scopeException: pilot.scopeExceptionPath,
    scopeGuard: 'PASS',
    frozenBoundary,
    fieldStatus: pilot.fieldStatus,
    milestoneTarget: pilot.milestoneTarget,
    fieldDebtCount: fieldDebt.length,
    installerRequired: false,
    fieldVerified: false,
    productionReady: false,
  }
}

async function listReleaseFiles(releaseDir, facts) {
  const installer = join(releaseDir, facts.installerName)
  const blockmap = `${installer}.blockmap`
  const metadata = join(releaseDir, facts.updateMetadataName)

  await assertExists(installer, 'versioned installer')
  await assertExists(blockmap, 'installer blockmap')
  await assertExists(metadata, `update metadata ${facts.updateMetadataName}`)

  return {
    installer,
    blockmap,
    metadataFiles: [metadata],
  }
}

async function writeReleaseNotes(releaseDir, facts) {
  const fileName = expectedReleaseNotesName(facts.version)
  const filePath = join(releaseDir, fileName)
  const content = [
    `# E-Shop Desktop ${facts.version}`,
    '',
    'E-Shop Desktop Single Installer Commercial Pilot candidate.',
    '',
    '- Distribution class: unsigned-internal',
    '- Channel: commercial-pilot',
    `- Release status: ${COMMERCIAL_PILOT_RELEASE_STATUS}`,
    '- FIELD VERIFIED / CLOSED: not claimed; fresh Windows FIELD remains required',
    '',
  ].join('\n')
  await writeFile(filePath, content, 'utf8')
  return filePath
}

async function writeManifests(options) {
  const facts = await loadReleaseFacts()
  validateBuilderConfig(facts)
  if (facts.channel !== 'commercial-pilot') {
    throw new Error(`Commercial Pilot write supports commercial-pilot only, got ${facts.channel}`)
  }

  const distributionClass = options['distribution-class'] ?? 'unsigned-internal'
  if (distributionClass !== 'unsigned-internal') {
    throw new Error(`Commercial Pilot distributionClass must be unsigned-internal, got ${distributionClass}`)
  }
  const signingStatus = options['signing-status'] ?? 'unsigned-internal'
  if (signingStatus !== 'unsigned-internal') {
    throw new Error(`Commercial Pilot signingStatus must be unsigned-internal, got ${signingStatus}`)
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

  const provenanceFileName = expectedProvenanceName(facts.version)
  const provenancePath = join(releaseDir, provenanceFileName)
  let providerArtifactManifestSha256 = options['provider-manifest-sha'] ?? process.env.ESHOP_PROVIDER_ARTIFACT_MANIFEST_SHA256
  if (!providerArtifactManifestSha256) {
    const providerManifest = resolve(desktopDir, options['provider-manifest'] ??
      '../../eshop-windows-provider/artifacts/eshop-windows-provider/provider-artifact-manifest.json')
    await assertExists(providerManifest, 'Provider artifact manifest')
    providerArtifactManifestSha256 = await sha256(providerManifest)
  }
  if (!/^[a-f0-9]{64}$/.test(providerArtifactManifestSha256)) {
    throw new Error('Provider artifact manifest SHA-256 is invalid')
  }
  const provenance = {
    schemaVersion: PROVENANCE_SCHEMA,
    packageName: facts.packageName,
    desktopVersion: facts.version,
    releaseChannel: facts.channel,
    releaseStatus: COMMERCIAL_PILOT_RELEASE_STATUS,
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
    providerArtifactManifestSha256,
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
  const shaManifestPath = join(releaseDir, SHA_MANIFEST_NAME)
  await writeFile(shaManifestPath, `${shaLines.join('\n')}\n`, 'utf8')

  return verifyManifests({ ...options, 'release-dir': releaseDir, 'allow-build-output-extras': true })
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

async function listPublishedReleaseAssetNames(releaseDir, facts) {
  const entries = await readdir(releaseDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => !isGitHubGeneratedSourceArchive(fileName, facts))
    .sort()
}

async function verifyManifests(options) {
  const facts = await loadReleaseFacts()
  const releaseDir = resolve(desktopDir, options['release-dir'] ?? 'release')
  const shaManifestPath = join(releaseDir, SHA_MANIFEST_NAME)
  const provenancePath = join(releaseDir, expectedProvenanceName(facts.version))

  await assertExists(shaManifestPath, 'SHA256SUMS.txt')
  await assertExists(provenancePath, 'release provenance manifest')

  const expectedAssetNames = expectedReleaseAssetNames(facts)
  const publishedAssetNames = await listPublishedReleaseAssetNames(releaseDir, facts)
  if (options['allow-build-output-extras'] === true) {
    assertContainsNames(publishedAssetNames, expectedAssetNames, 'release directory')
  } else {
    assertSameNames(publishedAssetNames, expectedAssetNames, 'release asset allowlist')
  }

  const entries = await parseShaManifest(shaManifestPath)
  assertSameNames(
    entries.map((entry) => entry.fileName),
    expectedShaAssetNames(facts),
    'SHA manifest assets',
  )
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
    'releaseStatus',
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
    'providerArtifactManifestSha256',
    'baselineFreezeTag',
  ]
  for (const field of requiredFields) {
    if (provenance[field] == null) throw new Error(`provenance missing field: ${field}`)
  }
  if (provenance.schemaVersion !== PROVENANCE_SCHEMA) throw new Error('provenance schema mismatch')
  if (provenance.desktopVersion !== facts.version) throw new Error('provenance version mismatch')
  if (provenance.releaseChannel !== facts.channel) throw new Error('provenance channel mismatch')
  if (provenance.releaseStatus !== COMMERCIAL_PILOT_RELEASE_STATUS) throw new Error('provenance release status mismatch')
  if (provenance.gitTag !== facts.tag) throw new Error(`provenance tag must be ${facts.tag}`)
  if (provenance.distributionClass !== 'unsigned-internal') {
    throw new Error(`Commercial Pilot provenance must be unsigned-internal, got ${provenance.distributionClass}`)
  }
  if (provenance.signingStatus !== 'unsigned-internal') {
    throw new Error(`Commercial Pilot signingStatus must be unsigned-internal, got ${provenance.signingStatus}`)
  }
  if (!/^[a-f0-9]{64}$/.test(provenance.providerArtifactManifestSha256)) {
    throw new Error('provenance Provider artifact manifest SHA-256 is invalid')
  }

  assertSameNames(provenance.artifactFilenames, expectedProvenanceArtifactNames(facts), 'provenance artifactFilenames')
  assertSameNames(
    provenance.artifacts.map((artifact) => artifact.fileName),
    expectedProvenanceArtifactNames(facts),
    'provenance artifacts',
  )

  return {
    version: facts.version,
    releaseChannel: facts.channel,
    releaseStatus: provenance.releaseStatus,
    distributionClass: provenance.distributionClass,
    tag: facts.tag,
    installerName: facts.installerName,
    updateMetadataName: facts.updateMetadataName,
    shaManifest: basename(shaManifestPath),
    provenance: basename(provenancePath),
    providerArtifactManifestSha256: provenance.providerArtifactManifestSha256,
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
  } else if (command === 'source-policy') {
    result = await runSourceAcceptance(options)
  } else if (command === 'write') {
    result = await writeManifests(options)
  } else if (command === 'verify') {
    result = await verifyManifests(options)
  } else {
    throw new Error(`usage: release-foundation.mjs <policy|source-policy|write|verify> [options]`)
  }
  console.log(JSON.stringify(result, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

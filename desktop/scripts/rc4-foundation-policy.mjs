// Exact pre-build admission only. Formal release write/verify remain Phase 1.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { FROZEN_BOUNDARY_GROUPS, inspectFrozenBoundary } from './release-foundation.mjs'
import { candidateEnvironment, CANDIDATE_BUILD } from '../../e-shop-tray/scripts/build-network-addon.mjs'

export const TASK = 'ES-DESKTOP-COMMERCIAL-INSTALLER-01'
export const VERSION = '0.3.0-rc.4'
export const PRODUCT = 'b1998289ecd852f411d3e7acc5168385c8dbb5ba'
export const SOURCE_BASE = 'dc9124f75e3f59991d344b4eaa04f2cbf2586176'
export const MAIN_BASE = 'fcde7163ed48a76f4b73d4eaf26c743e8c660425'
export const PROVIDER = '7785be145d5259991038d17839d322e2694e338c'
export const ADDON_BUILD = 'dc9124f75e3f59991d344b4eaa04f2cbf2586176'
export const BRANCH = 'codex/es-desktop-commercial-installer-01-rc4'
export const PREFIX = 'docs/desktop/es-desktop-commercial-installer-01-rc4-foundation'
export const RECORD = `${PREFIX}.json`
export const APPROVAL = `${PREFIX}-approval.json`
export const INPUTS = `${PREFIX}-build-inputs.json`
export const CODE_PATHS = [
  "desktop/scripts/build-single-installer.mjs",
  "desktop/scripts/rc4-foundation-policy.mjs",
  "desktop/scripts/release-foundation.mjs",
  "desktop/tests/rc3-foundation-policy.test.ts",
  "desktop/tests/rc4-foundation-policy.test.ts"
].sort()
export const PRODUCT_PATHS = [
  "desktop/build/installer.nsh",
  "desktop/electron-builder.yml",
  "desktop/package-lock.json",
  "desktop/package.json",
  "desktop/scripts/build-single-installer.mjs",
  "desktop/scripts/desktop-nsis-profile.mjs",
  "desktop/scripts/single-installer-contract.mjs",
  "desktop/scripts/verify-single-installer.mjs",
  "desktop/src/main/managedPrintChildHandoff.ts",
  "desktop/src/main/posSessionBridge.ts",
  "desktop/src/main/windowsPrintChildProtection.ts",
  "desktop/tests/addon-installer-shortcut-contract.test.ts",
  "desktop/tests/desktop-nsis-profile.test.ts",
  "desktop/tests/managed-print-child-handoff.test.ts",
  "desktop/tests/pos-session-bridge-static.test.ts",
  "desktop/tests/print-child-cross-application.test.ts",
  "desktop/tests/rc1-foundation-policy.test.ts",
  "desktop/tests/single-installer-packaging.test.ts",
  "desktop/tests/windows-installer-user-recovery.test.ts",
  "desktop/tests/windows-print-child-protection.test.ts",
  "e-shop-tray/network-addon/installer.nsh",
  "e-shop-tray/network-addon/main.ts",
  "e-shop-tray/network-addon/shortcutLifecycle.ts",
  "e-shop-tray/network-addon/shortcutWindows.ts",
  "e-shop-tray/network-addon/ui.ts",
  "e-shop-tray/scripts/build-network-addon.mjs",
  "e-shop-tray/src/managedPrintChildIdentity.ts",
  "e-shop-tray/src/windowsPrintChildProtection.ts",
  "e-shop-tray/tests/managed-print-child-identity.test.ts",
  "e-shop-tray/tests/network-addon-settings-only.test.ts",
  "e-shop-tray/tests/network-addon-shortcut-windows.test.ts",
  "e-shop-tray/tests/network-addon-shortcuts.test.ts",
  "e-shop-tray/tests/network-addon.test.ts"
].sort()
const EVIDENCE = 'docs/desktop/es-desktop-commercial-installer-01-review-evidence/rc4/'
const DEPENDENCY_LOCKS = ['package-lock.json', 'desktop/package-lock.json', 'e-shop-tray/package-lock.json'].sort()
const REGISTRY = 'docs/change-gates/exceptions/ES-PRINT-NETWORK-FIRST-01.json'
const GRANT = 'DESKTOP-COMMERCIAL-RC4-TEST-BUILD'
const ADDON_INSTALLER_SHA256 = '84fd2606c4d176c6fe392fbd690994d08c302964d6331c066913df9b105124c2'
const ADDON_MANIFEST_SHA256 = '70a2148dc28ed6dca241858e3822f3c93463575883ced678244064a972b6b236'
const PROVIDER_ARTIFACT_SHA256 = '8a408f69e62a811ea4e8349148f46968c6519120e08e3f50bbd265ae00d1e3e1'
const PROVIDER_SOURCE_SHA256 = 'e77615c531bcec49f2de7642fa0c9f3e6cd4b8d1643ace8467a38ed7a9f6a5ca'
const fail = code => { throw new Error(`RC4_${code}`) }
export const hash = bytes => createHash('sha256').update(bytes).digest('hex')
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const equal = (a, b, code) => { if (canonical(a) !== canonical(b)) fail(code) }
export function git(root, args, bytes = false) {
  return execFileSync('git', args, { cwd: root, encoding: bytes ? undefined : 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
}
const text = (root, args) => git(root, args).trim()
function ancestor(root, a, b) {
  try { git(root, ['merge-base', '--is-ancestor', a, b]) } catch { fail('LINEAGE_MISMATCH') }
}
function regular(file) {
  // Refuse links in any path component, not only at the leaf.
  let current = path.parse(path.resolve(file)).root
  for (const part of path.resolve(file).slice(current.length).split(path.sep)) {
    current = path.join(current, part)
    if (lstatSync(current).isSymbolicLink()) fail('SYMLINK_INPUT')
  }
  if (!lstatSync(file).isFile()) fail('NON_REGULAR_INPUT')
  return readFileSync(file)
}
const json = file => JSON.parse(regular(file).toString('utf8'))
function trusted(root, file) {
  let blob
  try { blob = git(root, ['show', `origin/main:${file}`], true) } catch { fail('TRUSTED_RECORD_NOT_REGISTERED') }
  if (!regular(path.join(root, file)).equals(blob)) fail('TRUSTED_RECORD_MISMATCH')
  return JSON.parse(blob.toString('utf8'))
}
export function directoryHashes(directory) {
  const result = {}
  function walk(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), name = `${prefix}${entry.name}`
      if (entry.isSymbolicLink()) fail('SYMLINK_INPUT')
      if (entry.isDirectory()) walk(file, `${name}/`)
      else result[name] = hash(regular(file))
    }
  }
  if (lstatSync(directory).isSymbolicLink()) fail('SYMLINK_INPUT')
  walk(directory)
  return result
}
export function frozenSnapshot(root) {
  return FROZEN_BOUNDARY_GROUPS.map(group => {
    const files = git(root, ['ls-files', '-z', '--', ...group.paths]).split('\0').filter(Boolean)
    return { label: group.label, paths: group.paths,
      fileSha256: Object.fromEntries(files.sort().map(file => [file, hash(regular(path.join(root, file)))])) }
  })
}

export function runRc4FoundationPolicy(root, options) {
  try { candidateEnvironment() } catch { fail('UNSAFE_BUILD_ENVIRONMENT') }
  const keys = Object.keys(options).sort()
  equal(keys, ['addon-installer', 'addon-manifest'], 'INPUT_ARGUMENTS_REQUIRED')
  if (keys.some(key => typeof options[key] !== 'string' || !options[key])) fail('INPUT_ARGUMENTS_REQUIRED')
  const record = trusted(root, RECORD), approval = trusted(root, APPROVAL), inputs = trusted(root, INPUTS)
  if (record.schemaVersion !== 1 || approval.schemaVersion !== 1 || inputs.schemaVersion !== 1) fail('SCHEMA')
  equal({ taskId: record.taskId, version: record.version, productCommit: record.productCommit,
    sourceBase: record.sourceBase, mainBase: record.mainBase, branch: record.branch },
  { taskId: TASK, version: VERSION, productCommit: PRODUCT, sourceBase: SOURCE_BASE,
    mainBase: MAIN_BASE, branch: BRANCH }, 'EXACT_CANDIDATE_REQUIRED')
  equal(record.build, { mode: 'INTERNAL TEST ONLY', platform: 'win32', arch: 'x64',
    installationScope: 'current-user', elevated: false, published: false, releaseReady: false }, 'BUILD_SCOPE')
  if (approval.status !== 'ACTIVE' || approval.taskId !== TASK || approval.version !== VERSION
    || approval.payloadSha256 !== hash(canonical(record))
    || approval.frozenSnapshotSha256 !== hash(canonical(record.frozenSnapshot))) fail('FORMAL_APPROVAL_REQUIRED')
  if (approval.formalApproval?.approvedBy !== 'Founder'
    || typeof approval.formalApproval?.signedAt !== 'string'
    || !Number.isFinite(Date.parse(approval.formalApproval.signedAt))
    || typeof approval.formalApproval?.sourceReference !== 'string'
    || !approval.formalApproval.sourceReference.trim() || !approval.formalApproval?.candidateCommit
    || !/^[a-f0-9]{40}$/.test(approval.formalApproval.candidateCommit)) fail('FORMAL_APPROVAL_REQUIRED')
  ancestor(root, MAIN_BASE, 'origin/main')
  ancestor(root, PRODUCT, SOURCE_BASE)
  ancestor(root, SOURCE_BASE, approval.formalApproval.candidateCommit)
  ancestor(root, approval.formalApproval.candidateCommit, 'HEAD')
  if (text(root, ['branch', '--show-current']) !== BRANCH) fail('WRONG_BRANCH')
  if (text(root, ['status', '--porcelain=v1', '--untracked-files=all'])) fail('CLEAN_SOURCE_REQUIRED')
  equal(Object.keys(record.candidateSourceSha256).sort(), CODE_PATHS, 'SOURCE_SCOPE')
  const changed = git(root, ['diff', '--name-only', '-z', SOURCE_BASE, '--']).split('\0').filter(Boolean)
  for (const file of changed) {
    if (CODE_PATHS.includes(file) || [RECORD, APPROVAL, INPUTS].includes(file)) continue
    if (file.startsWith(EVIDENCE) && /\.(md|json|log|txt|patch)$/.test(file)) continue
    fail(`UNKNOWN_SOURCE_CHANGE: ${JSON.stringify(file)}`)
  }
  for (const file of CODE_PATHS) {
    const current = regular(path.join(root, file))
    if (hash(current) !== record.candidateSourceSha256[file]
      || hash(git(root, ['show', `${approval.formalApproval.candidateCommit}:${file}`], true))
        !== record.candidateSourceSha256[file]) fail('SOURCE_HASH_MISMATCH')
  }
  // Pin the complete reviewed Product/packaging surface, including NSIS,
  // composition inspection and metadata. Code-policy test paths may advance
  // only through this exact candidate seal; all other Product bytes must also
  // equal the already reviewed immutable source base.
  equal(Object.keys(record.productSourceSha256).sort(), PRODUCT_PATHS, 'PRODUCT_SOURCE_SCOPE')
  for (const file of PRODUCT_PATHS) {
    const current = hash(regular(path.join(root, file)))
    if (current !== record.productSourceSha256[file]
      || (!CODE_PATHS.includes(file)
        && hash(git(root, ['show', `${SOURCE_BASE}:${file}`], true)) !== current)) fail('PRODUCT_SOURCE_MISMATCH')
  }
  equal(json(path.join(root, 'desktop/package.json')).version, VERSION, 'VERSION_MISMATCH')
  const lock = json(path.join(root, 'desktop/package-lock.json'))
  equal([lock.version, lock.packages[''].version], [VERSION, VERSION], 'VERSION_MISMATCH')
  equal(frozenSnapshot(root), record.frozenSnapshot, 'FROZEN_SNAPSHOT_MISMATCH')
  if (hash(regular(path.join(root, INPUTS))) !== record.buildInputManifestSha256) fail('BUILD_INPUT_MANIFEST_MISMATCH')
  equal({ taskId: inputs.taskId, purpose: inputs.purpose, version: inputs.version,
    productCommit: inputs.productCommit, installerGenerated: inputs.installerGenerated, build: inputs.build },
  { taskId: TASK, purpose: 'pre-build-input-manifest', version: VERSION, productCommit: PRODUCT,
    installerGenerated: false, build: record.build }, 'BUILD_INPUT_MANIFEST_MISMATCH')

  equal(Object.keys(inputs.dependencyLocks ?? {}).sort(), DEPENDENCY_LOCKS, 'DEPENDENCY_LOCK_SCOPE')
  for (const file of DEPENDENCY_LOCKS) {
    if (hash(regular(path.join(root, file))) !== inputs.dependencyLocks[file]
      || hash(git(root, ['show', `${SOURCE_BASE}:${file}`], true)) !== inputs.dependencyLocks[file]) fail('DEPENDENCY_LOCK_MISMATCH')
  }

  const registry = trusted(root, REGISTRY)
  const require = createRequire(path.join(root, 'package.json'))
  const guard = require(path.join(root, 'scripts/guards/check-change-scope.js'))
  const validated = guard.validateException(registry, root)
  const matches = validated.additionalAuthorizations.filter(a => a.featureBranch === BRANCH)
  if (matches.length !== 1) fail('ADDON_AUTHORIZATION_REQUIRED')
  const grant = matches[0]
  if (grant.authorizationId !== GRANT || grant.status !== 'ACTIVE'
    || grant.lineageMode !== 'PRE_COMMIT_CONTENT_SHA256') fail('ADDON_AUTHORIZATION_REQUIRED')
  equal(grant.candidateBuild, CANDIDATE_BUILD, 'ADDON_AUTHORIZATION_REQUIRED')
  equal(grant.approvedContentMappingSha256, inputs.addon.approvedContentMappingSha256, 'ADDON_AUTHORIZATION_REQUIRED')
  for (const file of ['scripts/guards/check-change-scope.js', 'docs/change-gates/gate-config.json']) {
    if (!regular(path.join(root, file)).equals(git(root, ['show', `origin/main:${file}`], true))) fail('TRUSTED_GUARD_MISMATCH')
  }
  const scope = execFileSync(process.execPath, [path.join(root, 'scripts/guards/check-change-scope.js'),
    '--task-id', 'ES-PRINT-NETWORK-FIRST-01', '--files', grant.authorizedPaths.join(',')],
  { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (!scope.endsWith('PASS\n')) fail('SCOPE_BLOCKED')

  const addonManifestBytes = regular(options['addon-manifest'])
  const addonBytes = regular(options['addon-installer']), addon = JSON.parse(addonManifestBytes.toString('utf8'))
  if (inputs.addon.manifestSha256 !== ADDON_MANIFEST_SHA256 || inputs.addon.installerSha256 !== ADDON_INSTALLER_SHA256
    || hash(addonManifestBytes) !== inputs.addon.manifestSha256 || hash(addonBytes) !== inputs.addon.installerSha256
    || addon.implementationCommit !== ADDON_BUILD || addon.testOnly !== true || addon.releaseReady !== false
    || addon.published !== false || addon.installer !== true || addon.runtimeIncluded !== true
    || addon.artifactsSha256?.[addon.installerFile] !== inputs.addon.installerSha256
    || addon.candidateAuthorization?.authorizationId !== GRANT) fail('ADDON_INPUT_MISMATCH')
  if (inputs.addon.implementationCommit !== ADDON_BUILD || inputs.provider.sourceCommit !== PROVIDER) fail('COMPONENT_SOURCE_MISMATCH')
  const provider = path.resolve(root, '../eshop-windows-provider')
  if (text(provider, ['rev-parse', 'HEAD']) !== PROVIDER || text(provider, ['status', '--porcelain'])) fail('PROVIDER_SOURCE_MISMATCH')
  if (hash(canonical(inputs.provider.sourceFileSha256)) !== PROVIDER_SOURCE_SHA256
    || hash(canonical(inputs.provider.artifactFileSha256)) !== PROVIDER_ARTIFACT_SHA256) fail('PROVIDER_SOURCE_MISMATCH')
  for (const [file, expected] of Object.entries(inputs.provider.sourceFileSha256)) {
    if (hash(regular(path.join(provider, file))) !== expected
      || hash(git(provider, ['show', `${PROVIDER}:${file}`], true)) !== expected) fail('PROVIDER_SOURCE_MISMATCH')
  }
  equal(directoryHashes(path.join(provider, 'artifacts/eshop-windows-provider')),
    inputs.provider.artifactFileSha256, 'PROVIDER_ARTIFACT_MISMATCH')
  return { result: 'PASS', mode: 'INTERNAL TEST ONLY', version: VERSION, taskId: TASK,
    productCommit: PRODUCT, sourceCommit: text(root, ['rev-parse', 'HEAD']),
    trustedMain: text(root, ['rev-parse', 'origin/main']), approvalPayloadSha256: approval.payloadSha256,
    signingStatus: 'unsigned-test-only', published: false, releaseReady: false,
    frozenBoundary: inspectFrozenBoundary().map(group => ({ ...group,
      legacyStatus: group.status, status: 'EXACT_RC4_FORMALLY_SIGNED_SNAPSHOT' })),
    formalReleaseWriteVerify: 'NOT_AUTHORIZED_UNCHANGED_PHASE1_RULES', installerGenerated: false }
}

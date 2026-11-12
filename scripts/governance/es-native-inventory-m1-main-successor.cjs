'use strict'

const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const TASK = 'ES-NATIVE-INVENTORY-V1'
const BASE = 'd385e97540416c849ad1ff872be4ce3d658702b5'
const PRODUCT = 'cf2e1888ef6a42e67878d0a1f9e8546643c2b08b'
const SIGNATURE = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SIGNATURE.json'
const SIGNATURE_SHA = 'ecfe94be4744bf4ec0ea8751d51cb4cd5d630b1f8ee7be25be79894b098c83eb'
const ACTIVE = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SUCCESSOR.json'
const RECORD = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-MAIN-SUCCESSOR.json'
const SCOPE = 'docs/change-gates/exceptions/ES-NATIVE-INVENTORY-V1.json'
const CONFIG = 'docs/change-gates/gate-config.json'
const GUARD = 'scripts/guards/check-change-scope.js'
const CASHIER = 'app/cashier/page.tsx'
const HANDOFF_EXECUTABLES = [
  'scripts/governance/es-native-inventory-m1-main-successor.cjs',
  'scripts/governance/es-native-inventory-m1-successor.cjs',
  'tests/cashier-realtime-integration.test.ts',
  'tests/native-inventory-m1-successor.test.cjs',
]
const RECORD_KEYS = ['schemaVersion', 'taskId', 'status', 'requiredApprover', 'activationCondition', 'baseOriginMainSha',
  'productCommitSha', 'priorSignatureSha256', 'deadlineExclusive', 'closedScopeSha256', 'executablePathsSha256']
const CLOSED_SCOPE_SHA = 'ea4e49bff0749310c80b20222fca57d10f01c02742022ceea7fec0538cd5a55e'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const samePaths = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(path => b.includes(path))

// Existing Desktop freeze groups include files not changed by
// the signed candidate. Preserve additions as well as edits within them.
const FROZEN_PREFIXES = [
  'docs/milestone-b/EP-MB3-06A-CLOUD-DESKTOP-ACTIVATION-API-CONTRACT.md',
  'desktop/src/main/activation/activationRuntime.ts', 'desktop/src/main/activation/credentialStore.ts',
  'desktop/src/main/main.ts', 'desktop/src/main/windowManager.ts', 'desktop/src/main/hrt', 'packages/hrt-contract',
  'prisma', 'app/api/payments', 'app/api/sales', 'app/api/orders', 'app/api/printer',
  'app/sale', 'app/components/Scanner', 'desktop/src/main/hardware',
  'app/cashier', 'app/menu', 'app/m', 'app/home', 'app/invite', 'app/table-qrcodes', 'app/records',
]
const OLD_ACTIVATION = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-FROZEN-SUCCESSOR.json'

function readNativeInventoryM1MainSuccessor(root) {
  if (['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_GRAFT_FILE']
    .some(key => process.env[key])) return null
  try {
    const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const text = (...args) => git(...args).toString('utf8').trim()
    const blob = (ref, path) => git('show', `${ref}:${path}`)
    const parents = ref => text('rev-list', '--parents', '-1', ref).split(' ').slice(1)
    const stamp = ref => Number(text('show', '-s', '--format=%ct', ref)) * 1000
    const pathsBetween = (base, tip) => git('diff', '--no-renames', '--name-only', '-z', base, tip)
      .toString('utf8').split('\0').filter(Boolean)
    const matches = (ref, path, digest) =>
      /^[a-f0-9]{64}$/.test(digest) &&
      text('ls-tree', ref, '--', path).startsWith('100644 blob ') && sha(blob(ref, path)) === digest
    const atHead = (path, digest) => matches('HEAD', path, digest) &&
      lstatSync(resolve(root, path)).isFile() && sha(blob('', path)) === digest &&
      sha(readFileSync(resolve(root, path))) === digest

    const trusted = text('rev-parse', '--verify', 'refs/remotes/origin/main')
    const head = text('rev-parse', '--verify', 'HEAD')
    const branch = text('branch', '--show-current')
    const mainline = head === trusted && ['main', ''].includes(branch)
    if ((!mainline && (!branch || branch === 'main')) ||
        existsSync(resolve(root, text('rev-parse', '--git-path', 'info/grafts'))) ||
        text('status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none') ||
        /^[a-zS] /m.test(text('ls-files', '-v'))) return null

    git('merge-base', '--is-ancestor', PRODUCT, trusted)
    git('merge-base', '--is-ancestor', trusted, head)
    const [handoff, closure] = text('rev-list', '--first-parent', '--reverse', `${PRODUCT}..${trusted}`)
      .split('\n').filter(Boolean)
    if (!handoff || parents(handoff).join(' ') !== PRODUCT ||
        !samePaths(pathsBetween(PRODUCT, handoff), [RECORD, ...HANDOFF_EXECUTABLES])) return null

    const signedBytes = blob(BASE, SIGNATURE)
    if (sha(signedBytes) !== SIGNATURE_SHA) return null
    const signature = JSON.parse(signedBytes)
    const original = JSON.parse(blob(BASE, ACTIVE))
    const [integration, ...otherParents] = parents(PRODUCT)
    if (!integration || otherParents.length || parents(integration).join(' ') !== `${signature.businessParent} ${BASE}` ||
        original.status !== 'ACTIVE' || original.approvedBy !== 'Founder' || original.signatureSha256 !== SIGNATURE_SHA ||
        !samePaths(pathsBetween(integration, PRODUCT), Object.keys(signature.candidatePathsSha256))) return null
    const productPatch = git('diff', '--binary', '--full-index', '--no-renames', '--no-ext-diff', '--no-textconv',
      '--src-prefix=a/', '--dst-prefix=b/', integration, PRODUCT)
    if (sha(productPatch) !== signature.candidatePatchSha256 ||
        Object.entries(signature.candidatePathsSha256).some(([path, hash]) => !matches(PRODUCT, path, hash))) return null

    const recordBytes = blob(handoff, RECORD)
    const record = JSON.parse(recordBytes)
    const deadline = Date.parse(original.deadlineExclusive)
    const now = Date.now()
    if (!samePaths(Object.keys(record), RECORD_KEYS) ||
        record.schemaVersion !== 1 || record.taskId !== TASK || record.status !== 'CONDITIONAL' ||
        record.requiredApprover !== 'Founder' ||
        record.activationCondition !== 'EXACT_HANDOFF_AND_CLOSURE_SIGNATURE_BEFORE_CANONICAL_MAIN_UPDATE' ||
        record.baseOriginMainSha !== BASE || record.productCommitSha !== PRODUCT ||
        record.priorSignatureSha256 !== SIGNATURE_SHA || record.deadlineExclusive !== original.deadlineExclusive ||
        record.closedScopeSha256 !== CLOSED_SCOPE_SHA ||
        !(stamp(handoff) >= stamp(PRODUCT) && stamp(handoff) < deadline && stamp(handoff) <= now) ||
        !samePaths(Object.keys(record.executablePathsSha256), HANDOFF_EXECUTABLES) ||
        !atHead(RECORD, sha(recordBytes))) return null
    for (const path of HANDOFF_EXECUTABLES) {
      const hash = record.executablePathsSha256[path]
      if (!matches(handoff, path, hash) || !atHead(path, hash)) return null
    }

    const activeBytes = blob(BASE, SCOPE)
    const activeScope = JSON.parse(activeBytes)
    if (![GUARD, CONFIG].every(path => atHead(path, sha(blob(BASE, path))))) return null
    const { validateException, evaluateFile, matchAbsolute, matchGlob } = require(resolve(root, GUARD))
    const config = JSON.parse(blob(BASE, CONFIG))
    const activeHash = sha(activeBytes)
    const parsedActive = validateException(activeScope, root)
    git('merge-base', '--is-ancestor', activeScope.baseOriginMainSha, BASE)
    if (activeScope.status !== 'ACTIVE' || activeScope.approvedBy !== 'Founder' ||
        activeScope.featureBranch !== signature.featureBranch ||
        activeScope.sealedCandidatePatchSha256 !== signature.candidatePatchSha256 ||
        original.executablePathsSha256[SCOPE] !== activeHash || !matches(PRODUCT, SCOPE, activeHash) ||
        activeScope.authorizedPaths.some(path => !matches(PRODUCT, path, activeScope.authorizedPathSha256[path]) ||
          !evaluateFile({
            filePath: path, repoRoot: root, taskId: TASK, currentBranch: signature.featureBranch,
            config, exception: parsedActive, contentHashResolver: file => sha(blob(PRODUCT, file)),
          }).allowed)) return null

    let scopeStatus = 'ACTIVE'
    if (closure) {
      if (parents(closure).join(' ') !== handoff || !samePaths(pathsBetween(handoff, closure), [SCOPE]) ||
          !matches(closure, SCOPE, CLOSED_SCOPE_SHA) || !atHead(SCOPE, CLOSED_SCOPE_SHA)) return null
      const closedScope = JSON.parse(blob(closure, SCOPE))
      const { closedAt, featureMergeCommitSha, ...fields } = closedScope
      if (closedScope.status !== 'CLOSED' || featureMergeCommitSha !== PRODUCT ||
          Date.parse(closedAt) !== stamp(closure) ||
          !(stamp(closure) >= stamp(handoff) && stamp(closure) < deadline && stamp(closure) <= now) ||
          JSON.stringify({ ...fields, status: 'ACTIVE' }) !== JSON.stringify(activeScope)) return null
      const parsedClosed = validateException(closedScope, root)
      if (closedScope.authorizedPaths.some(path => evaluateFile({
        filePath: path, repoRoot: root, taskId: TASK, currentBranch: signature.featureBranch,
        config, exception: parsedClosed,
      }).reason !== 'exception is not ACTIVE')) return null
      scopeStatus = 'CLOSED'
    } else if (!mainline || trusted !== handoff || !(now < deadline) || !atHead(SCOPE, activeHash)) return null

    const corePaths = pathsBetween(BASE, PRODUCT)
    const prior = JSON.parse(blob(BASE, OLD_ACTIVATION))
    const inherited = new Set([...corePaths, GUARD, CONFIG, OLD_ACTIVATION, ACTIVE,
      ...Object.keys(prior.executablePathsSha256), ...Object.keys(original.executablePathsSha256)])
    for (const path of inherited) {
      if (path !== SCOPE && !HANDOFF_EXECUTABLES.includes(path) && !atHead(path, sha(blob(PRODUCT, path)))) return null
    }

    const { absolute, glob_patterns: globs } = config.forbidden_paths
    const protectedFiles = new Set([...inherited, RECORD, ...HANDOFF_EXECUTABLES].map(path => path.toLowerCase()))
    const prefixes = FROZEN_PREFIXES.map(path => path.toLowerCase())
    const absoluteRules = absolute.map(path => path.toLowerCase())
    const globRules = globs.map(path => path.toLowerCase())
    const isFrozen = path => protectedFiles.has(path) || matchAbsolute(path, absoluteRules) || matchGlob(path, globRules) ||
      prefixes.some(prefix => path === prefix || path.startsWith(prefix + '/'))

    // Git status omits ignored files. Keep dependency/build output in the
    // existing contract package, but reject ignored files in frozen sources.
    const ignored = git('ls-files', '--others', '--ignored', '--exclude-standard', '--directory',
      '--no-empty-directory', '-z').toString('utf8').split('\0').filter(Boolean)
    if (ignored.some(entry => {
      const path = entry.toLowerCase().replace(/\/$/, '')
      if (['packages/hrt-contract/node_modules', 'packages/hrt-contract/dist'].some(dir =>
        path === dir || path.startsWith(dir + '/'))) return false
      if (isFrozen(path)) return true
      return entry.endsWith('/') && [...protectedFiles, ...prefixes, ...absoluteRules, ...globRules]
        .some(frozen => frozen.startsWith(path + '/'))
    })) return null

    // Check commits introduced after closing, including side history brought
    // in by merges. Checking only the tip would allow a protected edit+revert.
    if (closure) {
      const later = text('rev-list', '--parents', `${closure}..${head}`).split('\n').filter(Boolean)
      for (const item of later) {
        const [commit, parent] = item.split(' ')
        if (!parent || pathsBetween(parent, commit).some(path => isFrozen(path.toLowerCase()))) return null
      }
    }

    return {
      registrationSha: handoff,
      trustedMainSha: trusted,
      productCommitSha: PRODUCT,
      scopeStatus,
      cashierHash: signature.candidatePathsSha256[CASHIER],
      scannerPath: 'app/sale/page.tsx',
      corePaths: new Set(corePaths),
      mainline,
      closedBaseline: scopeStatus === 'CLOSED',
    }
  } catch {
    return null
  }
}

module.exports = { readNativeInventoryM1MainSuccessor }

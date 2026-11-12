'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { appendFileSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { readNativeInventoryM1Successor, verifyNativeInventoryM1Remote } = require('../scripts/governance/es-native-inventory-m1-successor.cjs')

const ROOT = resolve(__dirname, '..')
const BRANCH = 'codex/es-native-inventory-v1-01'
const ORIGINAL_ACTIVATION = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-FROZEN-SUCCESSOR.json'
const RUNTIME_ACTIVATION = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SUCCESSOR.json'
const RUNTIME_SIGNATURE = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-RUNTIME-SIGNATURE.json'
const RUNTIME_MIGRATION = 'prisma/migrations/20261112133000_isolate_native_inventory_capability/migration.sql'
const RUNTIME_CASHIER_HASH = 'ec6926988be7cf7df7c78047fefbad4e1fd1a1de39aab08f37a54dcece656325'
const SCOPE = 'docs/change-gates/exceptions/ES-NATIVE-INVENTORY-V1.json'
const INTEGRATION = 'scripts/test/manifests/root-integration-tests.json'
const CASHIER = 'app/cashier/page.tsx'
const CASHIER_HASH = 'e053f220726f0b698cd37009d897ec36dcb3eaaee814869a8617ba2461fe0707'
const run = (root, args, options = {}) => execFileSync('git', ['--no-replace-objects', ...args], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'], ...options,
}).toString().trim()

test('M1 exact successor admits only the sealed product on the registered development branch', async t => {
  if (run(ROOT, ['branch', '--show-current']) !== BRANCH) {
    assert.equal(readNativeInventoryM1Successor(ROOT), null)
    return
  }

  const registered = readNativeInventoryM1Successor(ROOT)
  assert.ok(registered, 'the M1 branch must have an exact trusted activation')
  const activationPath = registered.runtimeRoleSuccessor ? RUNTIME_ACTIVATION : ORIGINAL_ACTIVATION
  const expectedCashierHash = registered.runtimeRoleSuccessor ? RUNTIME_CASHIER_HASH : CASHIER_HASH
  assert.equal(registered.cashierHash, expectedCashierHash)
  assert.ok(registered.corePaths.has(CASHIER))

  const directory = mkdtempSync(join(tmpdir(), 'eshop-m1-successor-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'repo')
  run(directory, ['clone', '--shared', '--quiet', '--no-checkout', ROOT, root])
  const git = (args, options) => run(root, args, options)
  git(['config', 'user.name', 'Isolated freeze test'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  const head = run(ROOT, ['rev-parse', 'HEAD'])
  const trusted = run(ROOT, ['rev-parse', 'refs/remotes/origin/main'])
  const predecessor = git(['rev-parse', `${trusted}^`])
  const integration = git(['rev-parse', `${head}^`])
  const business = git(['rev-parse', `${integration}^1`])
  const activate = (headSha = head, mainSha = trusted, branch = BRANCH) => {
    git(['update-ref', 'refs/remotes/origin/main', mainSha])
    git(['checkout', '--force', '--quiet', '-B', branch, headSha])
    git(['clean', '-fd'])
  }
  const reject = () => assert.equal(readNativeInventoryM1Successor(root), null)
  const commitTree = (base, files, parents) => {
    const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'fixture-index') }
    git(['read-tree', base], { env })
    for (const [path, bytes] of files) {
      const blob = git(['hash-object', '-w', '--stdin'], { input: bytes, env })
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env })
    }
    const tree = git(['write-tree'], { env })
    return git(['commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'Isolated negative test'])
  }

  await t.test('the exact registered commit is accepted', () => {
    activate()
    assert.equal(readNativeInventoryM1Successor(root)?.cashierHash, expectedCashierHash)
  })
  await t.test('synthetic authority cannot pass live remote validation', () => {
    activate()
    assert.throws(() => verifyNativeInventoryM1Remote(root, registered), /canonical GitHub origin/)
  })
  await t.test('wrong branch, absent trusted registration and main drift are denied', () => {
    activate(head, trusted, 'codex/wrong-branch')
    reject()
    activate(head, predecessor)
    reject()
    activate(head, commitTree(trusted, [], [trusted]))
    reject()
  })
  await t.test('dirty, staged, untracked, hidden and committed changes are denied', () => {
    activate()
    appendFileSync(join(root, CASHIER), '\n')
    reject()
    git(['add', '--', CASHIER])
    reject()
    activate()
    writeFileSync(join(root, 'unexpected-source.ts'), 'export {}\n')
    reject()
    activate()
    git(['update-index', '--assume-unchanged', '--', CASHIER])
    reject()
    git(['update-index', '--no-assume-unchanged', '--', CASHIER])
    activate(commitTree(head, [[CASHIER, 'unexpected cashier bytes']], [integration]))
    reject()
    activate(commitTree(head, [['unexpected-source.ts', 'export {}']], [integration]))
    reject()
  })
  await t.test('wrong integration ancestry and missing executable bytes are denied', () => {
    activate(commitTree(head, [], [integration, predecessor]))
    reject()
    activate(commitTree(head, [], [trusted]))
    reject()
    activate(commitTree(head, [[activationPath, '{}']], [integration]))
    reject()
    activate(commitTree(head, [[INTEGRATION, '{}']], [integration]))
    reject()
  })
  if (registered.runtimeRoleSuccessor) {
    await t.test('runtime activation rejects a changed migration and replaced Founder signature', () => {
      activate(commitTree(head, [[RUNTIME_MIGRATION, 'SELECT 1;']], [integration]))
      reject()
      const forged = [[RUNTIME_SIGNATURE, '{}']]
      const alteredMain = commitTree(trusted, forged, [predecessor])
      const merged = commitTree(integration, forged, [business, alteredMain])
      activate(commitTree(head, forged, [merged]), alteredMain)
      reject()
      activate(commitTree(head, [], [business]), trusted)
      reject()
    })
  }
  await t.test('expired, malformed and widened authority is denied even on matching ancestry', () => {
    const authority = JSON.parse(git(['show', `${trusted}:${activationPath}`]))
    const scope = JSON.parse(git(['show', `${trusted}:${SCOPE}`]))
    for (const [record, extra] of [
      [{ ...authority, deadlineExclusive: '2000-01-01T00:00:00Z' }, []],
      [{ ...authority, reviewedBy: '' }, []],
      [{ ...authority, reviewSha256: '0'.repeat(64) }, []],
      [{ ...authority, candidatePatchSha256: '0'.repeat(64) }, []],
      [authority, [['unexpected-governance-file', 'x']]],
    ]) {
      const files = [[activationPath, JSON.stringify(record)], ...extra]
      const alteredMain = commitTree(trusted, files, [predecessor])
      const merged = commitTree(integration, files, [business, alteredMain])
      const alteredHead = commitTree(head, files, [merged])
      activate(alteredHead, alteredMain)
      reject()
    }
    const { createHash } = require('node:crypto')
    for (const altered of [
      { ...scope, authorizedPaths: [...scope.authorizedPaths, 'unapproved.ts'],
        authorizedPathSha256: { ...scope.authorizedPathSha256, 'unapproved.ts': '0'.repeat(64) } },
      { ...scope, additionalAuthorizations: [{ featureBranch: 'codex/unapproved-branch' }] },
      { ...scope, baseOriginMainSha: predecessor },
    ]) {
      const bytes = JSON.stringify(altered)
      const digest = createHash('sha256').update(bytes).digest('hex')
      const files = [[SCOPE, bytes], [activationPath, JSON.stringify({
        ...authority, executablePathsSha256: { ...authority.executablePathsSha256, [SCOPE]: digest },
      })]]
      const widerMain = commitTree(trusted, files, [predecessor])
      const merged = commitTree(integration, files, [business, widerMain])
      activate(commitTree(head, files, [merged]), widerMain)
      reject()
    }
  })
})

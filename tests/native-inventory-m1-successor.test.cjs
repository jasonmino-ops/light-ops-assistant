'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { readNativeInventoryM1Successor, verifyNativeInventoryM1Remote } = require('../scripts/governance/es-native-inventory-m1-successor.cjs')

const MAIN_RECORD = 'docs/change-gates/ES-NATIVE-INVENTORY-V1-M1-MAIN-SUCCESSOR.json'
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

function hasMainRecord(root) {
  try {
    run(root, ['cat-file', '-e', 'refs/remotes/origin/main:' + MAIN_RECORD])
    return true
  } catch {
    return false
  }
}

test('M1 exact successor admits only the sealed product on the registered development branch', async t => {
  if (run(ROOT, ['branch', '--show-current']) !== BRANCH) {
    if (!hasMainRecord(ROOT)) assert.equal(readNativeInventoryM1Successor(ROOT), null)
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

test('M1 mainline handoff preserves exact product and closed freeze authority', async t => {
  if (!hasMainRecord(ROOT)) return
  const registered = readNativeInventoryM1Successor(ROOT)
  assert.ok(registered?.mainline || registered?.closedBaseline, 'trusted M1 history must verify its exact handoff')
  const trusted = run(ROOT, ['rev-parse', 'refs/remotes/origin/main'])
  const product = registered.productCommitSha
  const handoff = registered.registrationSha
  const [first, closure] = run(ROOT, ['rev-list', '--first-parent', '--reverse', product + '..' + trusted]).split('\n')
  assert.equal(first, handoff)
  assert.equal(registered.cashierHash, RUNTIME_CASHIER_HASH)

  const directory = mkdtempSync(join(tmpdir(), 'eshop-m1-main-successor-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const root = join(directory, 'repo')
  run(directory, ['clone', '--shared', '--quiet', '--no-checkout', ROOT, root])
  const git = (args, options) => run(root, args, options)
  git(['config', 'user.name', 'Isolated main freeze test'])
  git(['config', 'user.email', 'fixture@example.invalid'])
  const activate = (head, main = head, branch = 'main') => {
    git(['update-ref', 'refs/remotes/origin/main', main])
    git(['checkout', '--force', '--quiet', '-B', branch, head])
    git(['clean', '-fd'])
  }
  const reject = () => assert.equal(readNativeInventoryM1Successor(root), null)
  const base = JSON.parse(git(['show', handoff + ':' + MAIN_RECORD])).baseOriginMainSha
  const expire = Date.parse(JSON.parse(git(['show', handoff + ':' + MAIN_RECORD])).deadlineExclusive) + 1000
  const duringHandoff = Date.parse(git(['show', '-s', '--format=%cI', handoff]))
  const commitTree = (from, edits, parents, time) => {
    const env = {
      ...process.env, GIT_INDEX_FILE: join(directory, 'fixture-index'),
      ...(time ? { GIT_AUTHOR_DATE: time, GIT_COMMITTER_DATE: time } : {}),
    }
    git(['read-tree', from], { env })
    for (const [path, bytes] of edits) {
      const blob = git(['hash-object', '-w', '--stdin'], { input: bytes, env })
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env })
    }
    return git(['commit-tree', git(['write-tree'], { env }),
      ...parents.flatMap(parent => ['-p', parent]), '-m', 'Isolated main handoff probe'], { env })
  }

  await t.test('original ACTIVE development path and exact main handoff both work', t => {
    t.mock.method(Date, 'now', () => duringHandoff)
    activate(product, base, BRANCH)
    const feature = readNativeInventoryM1Successor(root)
    assert.equal(feature?.registrationSha, base)
    assert.equal(feature?.cashierHash, RUNTIME_CASHIER_HASH)
    activate(handoff)
    const main = readNativeInventoryM1Successor(root)
    assert.equal(main?.scopeStatus, 'ACTIVE')
    assert.equal(main?.trustedMainSha, handoff)
    assert.equal(main?.productCommitSha, product)
  })
  await t.test('synthetic remote and mismatched trusted refs cannot establish main authority', t => {
    t.mock.method(Date, 'now', () => duringHandoff)
    activate(handoff)
    assert.throws(() => verifyNativeInventoryM1Remote(root, readNativeInventoryM1Successor(root)), /atomic CLOSED handoff/)
    if (closure) {
      activate(closure)
      assert.throws(() => verifyNativeInventoryM1Remote(root, readNativeInventoryM1Successor(root)), /canonical GitHub origin/)
    }
    activate(handoff, base)
    reject()
    activate(handoff, handoff, 'codex/not-main')
    reject()
  })
  await t.test('extra handoff paths, wrong parent chain and falsified candidate lineage are refused', () => {
    const at = git(['show', '-s', '--format=%cI', handoff])
    activate(commitTree(handoff, [['unexpected-source.ts', 'export {}\n']], [product], at))
    reject()
    activate(commitTree(handoff, [], [base], at))
    reject()
    activate(commitTree(handoff, [], [product, base], at))
    reject()
    const changedProduct = commitTree(product, [[CASHIER, 'fake cashier\n']], [git(['rev-parse', product + '^'])], at)
    activate(commitTree(handoff, [], [changedProduct], at))
    reject()
  })
  await t.test('expired ACTIVE proof and expired handoff commit are refused', t => {
    activate(handoff)
    t.mock.method(Date, 'now', () => expire)
    reject()
    activate(commitTree(handoff, [], [product], new Date(expire).toISOString()))
    reject()
  })

  if (closure) {
    await t.test('CLOSED proof survives expiry and ordinary later main commits', t => {
      activate(closure)
      assert.equal(readNativeInventoryM1Successor(root)?.scopeStatus, 'CLOSED')
      const later = commitTree(closure, [['docs/ordinary-fixture.md', 'Unrelated\n']], [closure])
      activate(later)
      t.mock.method(Date, 'now', () => expire)
      const verified = readNativeInventoryM1Successor(root)
      assert.equal(verified?.scopeStatus, 'CLOSED')
      assert.equal(verified?.trustedMainSha, later)
    })
    await t.test('later branch can read CLOSED history and cannot obtain a live grant', () => {
      const later = commitTree(closure, [['docs/ordinary-branch-fixture.md', 'Unrelated\n']], [closure])
      activate(later, closure, 'codex/later-feature')
      const baseline = readNativeInventoryM1Successor(root)
      assert.equal(baseline?.closedBaseline, true)
      assert.equal(baseline?.mainline, false)
      assert.throws(() => verifyNativeInventoryM1Remote(root, baseline), /atomic CLOSED handoff/)
      activate(commitTree(later, [[CASHIER, 'fake cashier\n']], [later]), closure, 'codex/later-feature')
      reject()
    })
    await t.test('wrong CLOSED record, extra closure paths and out-of-order closing are refused', () => {
      const closedBytes = git(['show', closure + ':' + SCOPE])
      const at = git(['show', '-s', '--format=%cI', closure])
      const wrong = { ...JSON.parse(closedBytes), featureMergeCommitSha: base }
      activate(commitTree(closure, [[SCOPE, JSON.stringify(wrong)]], [handoff], at))
      reject()
      activate(commitTree(closure, [['unexpected-source.ts', 'export {}\n']], [handoff], at))
      reject()
      activate(commitTree(closure, [], [product], at))
      reject()
    })
    await t.test('closed task never grants a new Cashier edit even on its old feature branch', () => {
      activate(closure, closure, BRANCH)
      assert.throws(() => execFileSync(process.execPath, ['scripts/guards/check-change-scope.js',
        '--task-id', 'ES-NATIVE-INVENTORY-V1', '--files', CASHIER],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }),
      error => error.status === 1 && error.stdout.toString().includes('exception is not ACTIVE'))
    })
    await t.test('post-closure Cashier edits, reverts and new frozen namespace paths are refused', () => {
      activate(closure)
      appendFileSync(join(root, CASHIER), '\n')
      reject()
      activate(closure)
      git(['update-index', '--assume-unchanged', '--', CASHIER])
      appendFileSync(join(root, CASHIER), '\n')
      reject()
      git(['update-index', '--no-assume-unchanged', '--', CASHIER])
      activate(closure)
      const tampered = commitTree(closure, [[CASHIER, 'fake cashier\n']], [closure])
      activate(tampered)
      reject()
      const reverted = commitTree(closure, [], [tampered])
      activate(reverted)
      reject()
      activate(commitTree(closure, [], [closure, reverted]))
      reject()
      activate(commitTree(closure, [['prisma/migrations/forged/migration.sql', 'SELECT 1;\n']], [closure]))
      reject()
      activate(commitTree(closure, [[SCOPE, git(['show', handoff + ':' + SCOPE]) + '\n']], [closure]))
      reject()
      activate(commitTree(closure, [['desktop/src/main/main.ts', 'fake Desktop startup\n']], [closure]))
      reject()
    })
    await t.test('an altered Scope Guard is refused before its code can run', () => {
      const guard = 'scripts/guards/check-change-scope.js'
      const bad = "require('node:fs').writeFileSync('untrusted-guard-ran', 'executed')\n"
      activate(commitTree(closure, [[guard, bad]], [closure]))
      assert.throws(() => execFileSync(process.execPath,
        ['scripts/governance/es-native-inventory-m1-successor.cjs', '--check-local'],
        { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }), error => error.status === 1)
      assert.equal(existsSync(join(root, 'untrusted-guard-ran')), false)
    })
    await t.test('ignored files in frozen source directories are refused', () => {
      activate(closure)
      appendFileSync(join(root, '.git/info/exclude'), '\n/app/cashier/ignored-extra.ts\n')
      writeFileSync(join(root, 'app/cashier/ignored-extra.ts'), 'export {}\n')
      assert.equal(git(['status', '--porcelain']), '')
      reject()
    })
  }
})

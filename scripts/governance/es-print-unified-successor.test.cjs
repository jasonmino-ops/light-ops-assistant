'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { readUnifiedPrintSuccessor } = require('./es-print-unified-integration-01.cjs')

const ROOT = resolve(__dirname, '../..')
const REGISTRATION = '948d31b396602a18e515e7fab1cf629491b0a9b3'
const PRODUCT = 'a8c13b2da80ce3311945cb6ad3f4ab1672c7b044'
const RECORD = 'docs/freezes/ES-PRINT-UNIFIED-INTEGRATION-01.md'
const ACTIVATION = 'docs/change-gates/ES-PRINT-UNIFIED-INTEGRATION-01-EXECUTABLE-SUCCESSOR.json'
const STARTUP = 'desktop/src/main/main.ts'
const ANCHOR = '227146b9e215e1441082c04e8941de8611592226'
const FILES = [
  'desktop/scripts/release-foundation.mjs',
  'scripts/governance/es-print-unified-integration-01.cjs',
  'tests/cashier-realtime-integration.test.ts',
  'scripts/governance/es-print-unified-successor.test.cjs',
]
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

test('exact unified successor in an isolated Git fixture', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'unified-print-successor-'))
  const root = join(directory, 'repo')
  try {
    execFileSync('git', ['clone', '--quiet', '--shared', '--no-checkout', ROOT, root], { stdio: 'pipe' })
    const git = (args, options = {}) => execFileSync('git', args, { cwd: root, stdio: 'pipe', ...options })
    const text = (args, options) => git(args, options).toString('utf8').trim()
    git(['config', 'core.autocrlf', 'false'])
    git(['config', 'core.fileMode', 'true'])
    git(['config', 'user.name', 'Isolated successor test'])
    git(['config', 'user.email', 'fixture@example.invalid'])
    const index = { env: { ...process.env, GIT_INDEX_FILE: join(directory, 'fixture-index') } }
    const setFiles = (base, entries) => {
      git(['read-tree', base], index)
      for (const [path, bytes, mode = '100644'] of entries) {
        const oid = text(['hash-object', '-w', '--stdin'], { input: bytes })
        git(['update-index', '--add', '--cacheinfo', `${mode},${oid},${path}`], index)
      }
      return text(['write-tree'], index)
    }
    const commit = (tree, parents) => text([
      'commit-tree', tree, ...parents.flatMap(parent => ['-p', parent]), '-m', 'Synthetic fixture, no Founder authority',
    ])
    const contents = FILES.map(path => [path, readFileSync(join(ROOT, path))])
    const executable = commit(setFiles(REGISTRATION, contents), [REGISTRATION])
    const activation = {
      schemaVersion: 1, taskId: 'ES-PRINT-UNIFIED-INTEGRATION-01', status: 'ACTIVE', approvedBy: 'Founder', reviewedBy: 'Claude',
      registrationCommit: REGISTRATION, executableCommit: executable, productCommit: PRODUCT,
      productTree: text(['rev-parse', `${PRODUCT}^{tree}`]),
      requestSha256: hash('synthetic request'), reviewSha256: hash('synthetic review'),
      deadlineExclusive: '2099-01-01T00:00:00Z',
      executablePathsSha256: Object.fromEntries(contents.map(([path, bytes]) => [path, hash(bytes)])),
    }
    const authority = (value = activation, base = executable, extra = []) =>
      commit(setFiles(base, [[ACTIVATION, JSON.stringify(value)], ...extra]), [base])
    const active = authority()
    const paths = [...text(['show', `${REGISTRATION}:${RECORD}`])
      .matchAll(/^\| `([^`]+)` \| `[a-f0-9]{64}` \|$/gm)].map(([, path]) => path)
    const merge = (first, second = PRODUCT, mutate = []) => {
      const tree = text(['merge-tree', '--write-tree', first, second])
      return commit(mutate.length ? setFiles(tree, mutate) : tree, [first, second])
    }
    const merged = merge(active)
    const check = (head, trusted) => {
      git(['update-ref', 'refs/remotes/origin/main', trusted])
      git(['checkout', '--force', '--quiet', '--detach', head])
      return readUnifiedPrintSuccessor(root)
    }

    await t.test('only exact committed authority admits the exact assertion and startup group', () => {
      for (const trusted of [active, merged]) {
        const successor = check(merged, trusted)
        assert.ok(successor)
        assert.deepEqual(successor.corePaths(paths, paths), new Set(paths))
        assert.equal(successor.corePaths(paths, paths.slice(1)), null)
        assert.equal(successor.corePaths([...paths, 'extra'], paths), null)
        assert.equal(successor.admitsStartup('main startup gate', ANCHOR, [STARTUP]), true)
        assert.equal(successor.admitsStartup('Runtime Core', ANCHOR, [STARTUP]), false)
        assert.equal(successor.admitsStartup('main startup gate', REGISTRATION, [STARTUP]), false)
        assert.equal(successor.admitsStartup('main startup gate', ANCHOR, [STARTUP, 'extra']), false)
      }
    })

    await t.test('missing activation, untrusted activation and moved main remain closed', () => {
      assert.equal(check(merge(executable), executable), null)
      assert.equal(check(merged, REGISTRATION), null)
      const later = commit(text(['rev-parse', `${merged}^{tree}`]), [merged])
      assert.equal(check(merged, later), null)
    })

    await t.test('expired, malformed, inactive and unreviewed authority are rejected', () => {
      for (const override of [
        { deadlineExclusive: '2000-01-01T00:00:00Z' },
        { deadlineExclusive: '2099-02-30T00:00:00Z' },
        { deadlineExclusive: undefined },
        { status: 'SEALED_INACTIVE' },
        { reviewSha256: undefined },
        { reviewedBy: 'unexpected' },
        { productTree: 'a'.repeat(40) },
        { extra: true },
      ]) {
        const rejected = authority({ ...activation, ...override })
        assert.equal(check(merge(rejected), rejected), null)
      }
    })

    await t.test('wrong parent, extra activation file, governance drift and wrong executable hash are rejected', () => {
      const wrongParent = authority(activation, REGISTRATION)
      const extraPath = authority(activation, executable, [['unexpected.txt', 'not approved']])
      const wrongHash = authority({ ...activation,
        executablePathsSha256: { ...activation.executablePathsSha256, [FILES[0]]: '0'.repeat(64) },
      })
      for (const rejected of [wrongParent, extraPath, wrongHash]) {
        assert.equal(check(merge(rejected), rejected), null)
      }
      const wrongProduct = commit(text(['rev-parse', `${PRODUCT}^{tree}`]), [PRODUCT])
      assert.equal(check(merge(active, wrongProduct), active), null)
      const extraParent = commit(text(['rev-parse', `${merged}^{tree}`]), [active, PRODUCT, REGISTRATION])
      assert.equal(check(extraParent, active), null)
    })

    await t.test('changed bytes, changed mode and extra paths are rejected', () => {
      const original = git(['show', `${PRODUCT}:${STARTUP}`])
      for (const change of [
        [STARTUP, Buffer.concat([original, Buffer.from('\n// changed\n')])],
        [STARTUP, original, '100755'],
        ['unexpected.txt', 'not approved'],
        [FILES[0], 'modified checker'],
        [RECORD, 'modified record'],
      ]) {
        assert.equal(check(merge(active, PRODUCT, [change]), active), null)
      }
    })

    await t.test('dirty, hidden and staged inputs are rejected', () => {
      check(merged, active)
      const target = join(root, STARTUP)
      const original = readFileSync(target)
      writeFileSync(target, '\n', { flag: 'a' })
      assert.equal(readUnifiedPrintSuccessor(root), null)
      git(['add', '--', STARTUP])
      assert.equal(readUnifiedPrintSuccessor(root), null)
      git(['reset', '--hard', 'HEAD'])
      for (const flag of ['--assume-unchanged', '--skip-worktree']) {
        git(['update-index', flag, '--', STARTUP])
        assert.equal(readUnifiedPrintSuccessor(root), null)
        git(['update-index', flag.replace('--', '--no-'), '--', STARTUP])
      }
      writeFileSync(target, original)
      writeFileSync(join(root, 'unexpected.txt'), 'untracked')
      assert.equal(readUnifiedPrintSuccessor(root), null)
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

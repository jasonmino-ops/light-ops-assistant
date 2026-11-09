import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const { evaluateUsbFrontSuccessor } = createRequire(__filename)('../../scripts/governance/es-print-usb-baseline-01.cjs')
const root = resolve(__dirname, '../..')
const registered = 'd95fc930dfaf6169961f60ae5fcb1faca547c896'
const product = 'c50bd967c59452b3ecae602f0624dccf10244127'
const trusted = '1'.repeat(40)
const replay = '2'.repeat(40)
const executable = '3'.repeat(40)
const activationPath = 'docs/change-gates/ES-PRINT-USB-BASELINE-01-EXECUTABLE-SUCCESSOR.json'
const governancePaths = [
  'desktop/scripts/release-foundation.mjs',
  'desktop/tests/es-print-usb-baseline-01.test.ts',
  'scripts/governance/es-print-usb-baseline-01.cjs',
  'tests/cashier-realtime-integration.test.ts',
]
const realGit = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
const record = realGit('show', `${registered}:docs/freezes/ES-PRINT-USB-BASELINE-01.md`).toString()
const productDigests = new Map([...record.matchAll(/^\| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
  .map(([, path, digest]) => [path!, digest!]))
const productPaths = [...productDigests.keys()]
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const governanceDigests = Object.fromEntries(governancePaths.map(path => [path, sha256(Buffer.from(path))]))
const historyDigests = new Map([...record.matchAll(/^\| [^|]+ \| `([^`]+)` \| `([a-f0-9]{64})` \|$/gm)]
  .map(([, path, digest]) => [path!, digest!]))
const activation = {
  schemaVersion: 1,
  taskId: 'ES-PRINT-USB-BASELINE-01',
  status: 'ACTIVE',
  approvedBy: 'Founder',
  registrationCommit: registered,
  productCommit: product,
  requestSha256: 'a53cbad30f822934cfac20af9182871fd1dfa5402a07e6b7c78b0b05fa57c44a',
  executableCommit: executable,
  deadlineExclusive: new Date(Date.now() + 3_600_000).toISOString(),
  executablePathsSha256: governanceDigests,
  historicalPathsSha256: Object.fromEntries([
    'prisma/migrations/20261014000000_add_desktop_print_child_identity/migration.sql',
    'prisma/migrations/20261101090000_add_retail_multi_unit/migration.sql',
    'prisma/schema.prisma',
    'app/api/sales/lookup/route.ts',
    'app/api/sales/route.ts',
    'app/sale/page.tsx',
    'app/cashier/page.tsx',
    'app/records/page.tsx',
  ].map(path => [path, historyDigests.get(path)])),
}
const groups = [
  ['Prisma', 'cb55c5a9e78cb7f80c8295a0387bb82cb0af8494', ['prisma']],
  ['Payment', '0d5e221aaec8a325a71372591c39e4fdb4c914a3', ['app/api/payments', 'app/api/sales', 'app/api/orders']],
  ['Scanner', '8317b4c2bd0ee0a90b7df4b2fe64b3489ebd6a99', ['app/sale', 'app/components/Scanner', 'desktop/src/main/hardware']],
  ['cashier/customer/mobile business', '8fdf9b310a9b23e1e3c9e02cf88ec2790a9f879c',
    ['app/cashier', 'app/menu', 'app/m', 'app/home', 'app/invite', 'app/table-qrcodes', 'app/records']],
] as const

// Simulate the future Git graph and expected product digests. Read the
// registered document, historical blobs and grants from trusted Git objects.
function futureGit(override?: (args: string[]) => Buffer | undefined) {
  return (...args: string[]) => {
    const replacement = override?.(args)
    if (replacement !== undefined) return replacement
    if (args[0] === 'rev-parse') return Buffer.from(trusted)
    if (args[0] === 'status') return Buffer.alloc(0)
    if (args[0] === 'rev-list') {
      if (args[3] === trusted) return Buffer.from(`${trusted} ${executable}`)
      if (args[3] === executable) return Buffer.from(`${executable} ${registered}`)
      return Buffer.from(`${replay} ${trusted} ${product}`)
    }
    if (args[0] === 'diff' && args[2] === '--name-status') return Buffer.from(`A\t${activationPath}`)
    if (args[0] === 'diff' && args[3] === registered) return Buffer.from(governancePaths.join('\n'))
    if (args[0] === 'diff' && args[3] === trusted) return Buffer.from(productPaths.join('\n'))
    if (args[0] === 'diff' && args[4] === replay) return realGit(...args.map(arg => arg === replay ? registered : arg))
    if (args[0] === 'show') {
      const [ref, ...parts] = args[1]!.split(':')
      const path = parts.join(':')
      if (ref === trusted && path === activationPath) return Buffer.from(JSON.stringify(activation))
      if (ref === trusted) return realGit('show', `${registered}:${path}`)
      if (ref === replay) return realGit('show', `${registered}:${path}`)
    }
    return realGit(...args)
  }
}

function evaluate(override?: (args: string[]) => Buffer | undefined) {
  const git = futureGit(override)
  const digest = (ref: string, path: string) => {
    const replacement = override?.(['show', `${ref}:${path}`])
    return replacement !== undefined ? sha256(replacement)
      : productDigests.get(path) ?? governanceDigests[path] ?? sha256(git('show', `${ref}:${path}`))
  }
  return evaluateUsbFrontSuccessor(git, {
    committedDigest: digest,
    worktreeDigest: (path: string) => {
      const replacement = override?.(['worktree', path])
      return replacement !== undefined ? sha256(replacement) : digest(replay, path)
    },
  })
}

describe('ES-PRINT-USB-BASELINE-01 executable successor', () => {
  it('does not activate from the actual trusted declarative registration alone', () => {
    expect(evaluate(args => args[0] === 'rev-parse' ? Buffer.from(registered) : undefined)).toBeNull()
  })

  it('recognizes the eight exact product paths in the future registered integration graph', () => {
    const result = evaluate()
    expect([...result.productPaths].sort()).toEqual([...productPaths].sort())
    expect(result.productPaths.size).toBe(8)
  })

  it('keeps the same exact admission when the release checkout is the integration commit on main', () => {
    const result = evaluate(args => args[0] === 'rev-parse' ? Buffer.from(replay) : undefined)
    expect([...result.productPaths].sort()).toEqual([...productPaths].sort())
    const [label, anchor, paths] = groups[1]
    expect(result.evaluateReleaseGroup(label, anchor, paths).admitted).toBe(true)
  })

  it.each([
    ['advanced trusted main', (args: string[]) => args[0] === 'rev-parse' ? '4'.repeat(40) : undefined],
    ['extra activation parent', (args: string[]) => args[0] === 'rev-list' && args[3] === trusted ? `${trusted} ${executable} ${product}` : undefined],
    ['extra executable parent', (args: string[]) => args[0] === 'rev-list' && args[3] === executable ? `${executable} ${registered} ${product}` : undefined],
    ['pending activation record', (args: string[]) => args[0] === 'show' && args[1] === `${trusted}:${activationPath}`
      ? JSON.stringify({ ...activation, status: 'PENDING' }) : undefined],
    ['expired activation record', (args: string[]) => args[0] === 'show' && args[1] === `${trusted}:${activationPath}`
      ? JSON.stringify({ ...activation, deadlineExclusive: '2000-01-01T00:00:00Z' }) : undefined],
    ['unapproved executable bytes', (args: string[]) => args[0] === 'show' && args[1] === `${executable}:${governancePaths[0]}` ? 'replaced' : undefined],
    ['unapproved trusted path', (args: string[]) => args[0] === 'diff' && args[3] === registered ? [...governancePaths, 'other'].join('\n') : undefined],
    ['wrong product parent', (args: string[]) => args[0] === 'rev-list' && args[3] === 'HEAD' ? `${replay} ${trusted} ${'4'.repeat(40)}` : undefined],
    ['dirty or untracked worktree', (args: string[]) => args[0] === 'status' ? '?? extra' : undefined],
    ['hidden index flags', (args: string[]) => args[0] === 'ls-files' ? 'S other' : undefined],
    ['extra product path', (args: string[]) => args[0] === 'diff' && args[3] === trusted ? [...productPaths, 'extra'].join('\n') : undefined],
    ['missing product path', (args: string[]) => args[0] === 'diff' && args[3] === trusted ? productPaths.slice(1).join('\n') : undefined],
    ['modified registered record', (args: string[]) => args[0] === 'show' && args[1]?.endsWith('docs/freezes/ES-PRINT-USB-BASELINE-01.md') ? 'replaced' : undefined],
    ['modified checkout bytes', (args: string[]) => args[0] === 'worktree' && args[1] === productPaths[0] ? 'replaced' : undefined],
    ['modified product blob', (args: string[]) => args[0] === 'show' && args[1] === `${replay}:${productPaths[0]}` ? 'replaced' : undefined],
  ])('fails closed for %s', (_label, tamper) => {
    const result = evaluate(args => {
      const value = tamper(args)
      return value === undefined ? undefined : Buffer.from(value)
    })
    expect(result).toBeNull()
  })

  it('assesses all sixteen paths without reopening CLOSED or pending authority', () => {
    const successor = evaluate()
    const result = groups.map(([label, anchor, paths]) => successor.evaluateReleaseGroup(label, anchor, paths))
    expect(result.map(group => group.admitted)).toEqual([false, true, true, false])
    const byPath = new Map<string, string>(result.flatMap(group => group.paths.map(
      ({ path, status }: { path: string; status: string }) => [path, status] as const,
    )))
    expect(byPath.size).toBe(16)
    expect([...byPath.values()].filter(status => status === 'ACTIVE_EXACT_MATCH')).toHaveLength(8)
    expect([...byPath.values()].filter(status => status === 'HISTORICAL_CLOSED')).toHaveLength(6)
    expect(byPath.get('app/home/page.tsx')).toBe('DRAFT_PENDING')
    expect(byPath.get('app/home/computer-client/page.tsx')).toBe('NO_ACTIVE_PATH_GRANT')
  })

  it('rejects an unexpected group path and mismatched exact historical bytes', () => {
    const [label, anchor, paths] = groups[1]
    const unexpected = evaluate(args =>
      args[0] === 'diff' && args[3] === anchor && args[4] === replay
        ? Buffer.from('app/api/sales/route.ts\napp/api/sales/lookup/route.ts\napp/api/sales/extra.ts\n')
        : undefined)
    expect(unexpected.evaluateReleaseGroup(label, anchor, paths)).toMatchObject({
      admitted: false, paths: expect.arrayContaining([{ path: 'app/api/sales/extra.ts', status: 'UNREGISTERED_DELTA' }]),
    })
    const changed = evaluate(args =>
      args[0] === 'show' && args[1] === `${replay}:app/api/sales/route.ts` ? Buffer.from('changed') : undefined)
    expect(changed.evaluateReleaseGroup(label, anchor, paths)).toMatchObject({
      admitted: false, paths: expect.arrayContaining([{ path: 'app/api/sales/route.ts', status: 'BYTE_MISMATCH' }]),
    })
  })

  it('does not reuse old ACTIVE authority without the new per-path grant', () => {
    const [label, anchor, paths] = groups[1]
    const successor = evaluate(args => args[0] === 'show' && args[1] === `${trusted}:${activationPath}`
      ? Buffer.from(JSON.stringify({ ...activation, historicalPathsSha256: {} })) : undefined)
    expect(successor.evaluateReleaseGroup(label, anchor, paths)).toMatchObject({
      admitted: false, paths: expect.arrayContaining([{ path: 'app/api/sales/route.ts', status: 'SUCCESSOR_PATH_NOT_ACTIVE' }]),
    })
  })

  it('keeps an expired or altered exact registry entry out of the admission result', () => {
    const registryPath = 'docs/change-gates/exceptions/ES-RETAIL-MULTI-UNIT-01.json'
    const [label, anchor, paths] = groups[1]
    for (const status of ['CLOSED', 'DRAFT', 'PENDING', 'EXPIRED', 'WRONG_BYTES']) {
      const candidate = evaluate(args => {
        if (args[0] !== 'show' || args[1] !== `${trusted}:${registryPath}`) return undefined
        const registry = JSON.parse(realGit('show', `${registered}:${registryPath}`).toString())
        if (status === 'EXPIRED') registry.deadlineExclusive = '2000-01-01T00:00:00Z'
        else if (status === 'WRONG_BYTES') registry.authorizedPathSha256['app/api/sales/route.ts'] = '0'.repeat(64)
        else registry.status = status
        return Buffer.from(JSON.stringify(registry))
      })
      expect(candidate.evaluateReleaseGroup(label, anchor, paths).admitted).toBe(false)
    }
  })
})

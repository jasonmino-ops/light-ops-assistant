// V2-INVARIANCE-02 / I-1 —— v2 行为不变性的端到端快照比对套件。
//
// 依据：ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Design Freeze V1.4 §4（技术不变式）
// 目的：I-2a/I-2b/I-3 的静态指纹只能证明"v2 代码未被编辑"；当 I-3 允许对共享
//       分发点做纯新增分支扩展、且 service.ts 的 enqueue 扩展点被使用后，唯一能
//       证明"v2 既有运行时行为逐字段不变"的是本套件。
//
// ── 数据库安全边界（必须先读完再执行） ──────────────────────────────────
// 本套件写真实 PostgreSQL。它只接受一个显式声明的、本机隔离的测试库，
// 并在进程入口 fail-closed；任何一项不满足即抛错退出，不做降级、不做猜测。
//
//   必须全部成立，否则拒绝运行：
//     1. V2_INVARIANCE_TEST_DATABASE === '1'（本套件专属开关，不与其他套件共用）
//     2. DATABASE_URL 的 hostname ∈ { 127.0.0.1, localhost, ::1 }
//     3. DATABASE_URL 的 database 名 === 'light_ops_test'（仓库既定隔离库名）
//     4. DATABASE_URL 不含生产连接特征（prod / neon / supabase / rds.amazonaws
//        / pooler / sslmode=require）
//     5. process.env.VERCEL_ENV 未设置
//     6. process.env.NODE_ENV !== 'production'
//     7. COMPUTER_CLIENT_TOKEN_SECRET 已设置
//
// ── 写入 golden 的三道 fail-closed 门槛（G-1 / G-2 / G-3） ────────────────
//   G-1 确定性：同一隔离库上连续跑两遍完整场景（两遍之间彻底清理、各自新建
//       租户/门店/绑定），两份 JSON 的 SHA-256 必须完全相同。不同则拒绝写入，
//       并指出第一处差异的场景名。
//   G-2 内容审计：对将要写入的 JSON 做结构化白名单审计 + 明文黑名单扫描，
//       任何一条违规即拒绝写入（明细见下方 auditSnapshot）。
//   G-3 顺序：只有 G-1 与 G-2 全部通过，才允许落盘 golden。
//   比对模式同样对磁盘上的 golden 跑 G-2，防止 golden 被手工污染后仍然"通过"。
//
// ── 数据足迹：创建 / 修改 / 清理 ────────────────────────────────────────
// 创建（每一遍都全新建立，带随机后缀，绝不复用既有行）：
//   · Tenant            4 行（name 前缀 v2inv-）
//   · Store             4 行（每个 Tenant 一个）
//   · ComputerBinding   4 行（每个 Store 一个，status=APPROVED）
//   · EshopTrayPrintJob 5 行（3 行经 enqueueRelayPrintJob 生产，
//                              2 行为 v2 阻断场景直接写入夹具行）
//   生成 golden 时跑两遍，因此总计上述数量的两倍，两遍之间已完整清理。
// 修改：
//   · 仅修改上面这 5 行 EshopTrayPrintJob（claim / executing / 终态 / lease 过期）。
//   · 被调用的 service 层写操作（recoverTimedOutJobs 等）全部以
//     tenantId + storeId 为 WHERE 前缀，作用域严格限定在本次创建的 store 内。
//   · 不修改任何本次运行之外既有的行；不执行任何全表 DELETE/TRUNCATE。
// 清理（每一遍结束后按 FK 安全顺序执行，只删本遍记录在案的 id）：
//   1. EshopTrayPrintJob  —— 必须先删；它对 ComputerBinding 是 onDelete: Restrict
//   2. ComputerBinding
//   3. Store
//   4. Tenant
//   清理失败不会被吞掉：会打印残留 id 清单并以非零码退出。
//
// ── 首次使用（必须在 v2 冻结基线上执行一次，生成 golden） ────────────────
//   UPDATE_V2_ENDTOEND_SNAPSHOT=1 V2_INVARIANCE_TEST_DATABASE=1 \
//   DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/light_ops_test' \
//   COMPUTER_CLIENT_TOKEN_SECRET=... npx tsx tests/v2-relay-endtoend-snapshot.test.ts
// 之后每次运行都与 golden 逐字段比对；任何差异即 I-1 违约。
//
// ── 已知覆盖缺口（G2 阶段补充，不得静默忽略） ───────────────────────────
//   - 未经由 lib/es-tray-relay/cashier-network-producer.ts 生产 v2 网络任务，
//     v2 阻断场景由测试夹具直接写入；当 G3 把 enqueue 扩展点变为 mode-aware 时，
//     必须在本套件补一组"生产者 → enqueue → 队列"的快照场景。
//   - 未覆盖 HTTP 路由层（route.ts）的 header 协商分支，仅覆盖 service 层契约。
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { RelayTimingConfig } from '../lib/es-tray-relay/config'
import type { EshopTrayPrintRequest } from '../lib/es-tray-relay/contract'

// ── fail-closed 隔离守卫 ────────────────────────────────────────────────
const ISOLATED_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]']
const ISOLATED_DATABASE = 'light_ops_test'
const PRODUCTION_MARKERS = /(prod|neon|supabase|rds\.amazonaws|pooler|sslmode=require)/i

const rawDatabaseUrl = process.env.DATABASE_URL ?? ''
let databaseUrl: URL
try {
  databaseUrl = new URL(rawDatabaseUrl)
} catch {
  databaseUrl = new URL('http://invalid')
}

if (
  process.env.V2_INVARIANCE_TEST_DATABASE !== '1'
  || !ISOLATED_HOSTS.includes(databaseUrl.hostname)
  || databaseUrl.pathname !== `/${ISOLATED_DATABASE}`
  || PRODUCTION_MARKERS.test(rawDatabaseUrl)
  || Boolean(process.env.VERCEL_ENV)
  || process.env.NODE_ENV === 'production'
  || !process.env.COMPUTER_CLIENT_TOKEN_SECRET
) {
  throw new Error(
    'Explicit LOCAL test database is required: '
    + `V2_INVARIANCE_TEST_DATABASE=1 + DATABASE_URL on 127.0.0.1/localhost with database "${ISOLATED_DATABASE}" `
    + '+ no production markers + no VERCEL_ENV + NODE_ENV!=production + COMPUTER_CLIENT_TOKEN_SECRET. '
    + 'I-1 写真实数据库，拒绝在 Production 或任何非隔离连接上运行。',
  )
}

// Runtime project modules are intentionally loaded only after the local test database
// guard above has passed. The `typeof import(...)` annotations are erased by TypeScript
// and do not load any project module at process startup.
let hashClaimSecret = undefined as unknown as typeof import('../lib/computer-client/crypto').hashClaimSecret
let hashDeviceSecret = undefined as unknown as typeof import('../lib/computer-client/crypto').hashDeviceSecret
let hashInstallationId = undefined as unknown as typeof import('../lib/computer-client/crypto').hashInstallationId
let prisma = undefined as unknown as typeof import('../lib/prisma').prisma
let parsePrintRequest = undefined as unknown as typeof import('../lib/es-tray-relay/contract').parsePrintRequest
let claimNextRelayPrintJob = undefined as unknown as typeof import('../lib/es-tray-relay/service').claimNextRelayPrintJob
let completeRelayPrintJob = undefined as unknown as typeof import('../lib/es-tray-relay/service').completeRelayPrintJob
let enqueueRelayPrintJob = undefined as unknown as typeof import('../lib/es-tray-relay/service').enqueueRelayPrintJob
let markRelayPrintJobExecuting = undefined as unknown as typeof import('../lib/es-tray-relay/service').markRelayPrintJobExecuting
let RelayServiceError = undefined as unknown as typeof import('../lib/es-tray-relay/service').RelayServiceError
let runtimeLoaded = false

async function loadRuntimeDependencies() {
  const [cryptoModule, prismaModule, contractModule, serviceModule] = await Promise.all([
    import('../lib/computer-client/crypto'),
    import('../lib/prisma'),
    import('../lib/es-tray-relay/contract'),
    import('../lib/es-tray-relay/service'),
  ])
  hashClaimSecret = cryptoModule.hashClaimSecret
  hashDeviceSecret = cryptoModule.hashDeviceSecret
  hashInstallationId = cryptoModule.hashInstallationId
  prisma = prismaModule.prisma
  parsePrintRequest = contractModule.parsePrintRequest
  claimNextRelayPrintJob = serviceModule.claimNextRelayPrintJob
  completeRelayPrintJob = serviceModule.completeRelayPrintJob
  enqueueRelayPrintJob = serviceModule.enqueueRelayPrintJob
  markRelayPrintJobExecuting = serviceModule.markRelayPrintJobExecuting
  RelayServiceError = serviceModule.RelayServiceError
  runtimeLoaded = true
}

const SNAPSHOT_PATH = path.join('tests', '__snapshots__', 'v2-relay-endtoend-snapshot.json')
const UPDATING = process.env.UPDATE_V2_ENDTOEND_SNAPSHOT === '1'
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

const timing: RelayTimingConfig = {
  claimLeaseMs: 30_000,
  executionTimeoutMs: 60_000,
  jobTtlMs: 86_400_000,
  maxAttempts: 3,
}

// ── 数据足迹登记：每一遍独立，只清理登记在案的 id ───────────────────────
type Footprint = {
  tenantIds: string[]
  storeIds: string[]
  bindingIds: string[]
  jobIds: string[]
}
const newFootprint = (): Footprint => ({ tenantIds: [], storeIds: [], bindingIds: [], jobIds: [] })

/** 把易变字段替换成稳定占位符；其余字段必须逐字段比对。 */
function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null
  if (value instanceof Date) return '<TIMESTAMP>'
  if (Array.isArray(value)) return value.map(normalize)
  if (typeof value === 'string') {
    if (/^[0-9a-f]{64}$/i.test(value)) return '<SHA256>'
    if (/^ect_v1_/.test(value)) return '<CLAIM_TOKEN>'
    if (/^c[a-z0-9]{24,}$/i.test(value)) return '<CUID>'
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return '<TIMESTAMP>'
    return value
  }
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (['id', 'tenantId', 'storeId', 'claimedByComputerBindingId', 'idempotencyKey', 'orderNo'].includes(key)) {
        output[key] = source[key] === null ? null : `<${key.toUpperCase()}>`
        continue
      }
      output[key] = normalize(source[key])
    }
    return output
  }
  return value
}

// ── G-2 快照内容审计 ────────────────────────────────────────────────────
// 白名单原则：golden 里允许出现的叶子值只有两类——归一化占位符 `<FOO>` 与
// SCREAMING_SNAKE 的枚举/错误码。任何 UUID、时间戳、连接串、base64、含空格
// 或非 ASCII 的文本（小票正文、顾客信息、商品名）都不满足这两条，直接违规。
const PLACEHOLDER_VALUE = /^<[A-Z0-9_]+>$/
const ENUM_LIKE_VALUE = /^[A-Z][A-Z0-9_]{1,63}$/
const ALLOWED_LITERALS = new Set<string>([])

// 这些键一旦带有非 null 值，说明请求体/小票内容/自由文本被带进了快照。
// 允许键存在但取值为 null（例如 serializeJob 的 result.message 恒为 null）。
const PAYLOAD_KEYS = new Set([
  'request', 'payload', 'commandStream', 'data', 'items', 'orderItems',
  'customer', 'customerName', 'customerPhone', 'documentName', 'queueName',
  'target', 'relayVersion', 'requestId', 'message', 'resultMessage', 'stack',
])

const VOLATILE_PATTERNS: Array<[string, RegExp]> = [
  ['UUID', /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i],
  ['ISO 时间戳', /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
  ['epoch 毫秒', /\b1[0-9]{12}\b/],
  ['连接串', /postgres(ql)?:\/\//i],
  ['测试租户后缀', /v2inv-/],
  ['ESC/POS 初始化字节', /(\\u001b@|\u001b@|G0A=|\b1b40\b)/i],
]

type Violation = { gate: string; where: string; detail: string }

function auditSnapshot(json: string, label: string): Violation[] {
  const violations: Violation[] = []

  // (a) 明文黑名单：密钥与其可逆/派生形式、连接串及其各组成部分。
  const secret = process.env.COMPUTER_CLIENT_TOKEN_SECRET ?? ''
  const secretForms: Array<[string, string]> = [
    ['COMPUTER_CLIENT_TOKEN_SECRET 明文', secret],
    ['COMPUTER_CLIENT_TOKEN_SECRET base64', Buffer.from(secret, 'utf8').toString('base64')],
    ['COMPUTER_CLIENT_TOKEN_SECRET hex', Buffer.from(secret, 'utf8').toString('hex')],
    ['COMPUTER_CLIENT_TOKEN_SECRET sha256', secret ? sha256(secret) : ''],
  ]
  const urlForms: Array<[string, string]> = [
    ['DATABASE_URL 全串', rawDatabaseUrl],
    ['DATABASE_URL host', databaseUrl.hostname],
    ['DATABASE_URL port', databaseUrl.port],
    ['DATABASE_URL user', databaseUrl.username],
    ['DATABASE_URL password', databaseUrl.password],
    ['DATABASE_URL database', ISOLATED_DATABASE],
  ]
  for (const [name, form] of [...secretForms, ...urlForms]) {
    if (form.length >= 6 && json.includes(form)) {
      violations.push({ gate: 'G-2(a) 明文泄漏', where: label, detail: `${name} 出现在快照中` })
    }
  }

  // (b) 未归一化的易变值 / 载荷指纹。
  for (const [name, pattern] of VOLATILE_PATTERNS) {
    const hit = json.match(pattern)
    if (hit) {
      violations.push({ gate: 'G-2(b) 未归一化', where: label, detail: `${name}：${hit[0].slice(0, 60)}` })
    }
  }

  // (c) 结构化白名单：逐叶子校验键名与取值。
  const walk = (value: unknown, at: string) => {
    if (value === null || typeof value === 'boolean') return
    if (typeof value === 'number') {
      if (!Number.isInteger(value) || Math.abs(value) > 100_000) {
        violations.push({ gate: 'G-2(c) 数值越界', where: `${label}${at}`, detail: `疑似时间戳/随机数：${value}` })
      }
      return
    }
    if (typeof value === 'string') {
      if (PLACEHOLDER_VALUE.test(value) || ENUM_LIKE_VALUE.test(value) || ALLOWED_LITERALS.has(value)) return
      violations.push({
        gate: 'G-2(c) 非白名单取值',
        where: `${label}${at}`,
        detail: `只允许 <PLACEHOLDER> 或 SCREAMING_SNAKE 枚举，实际："${value.slice(0, 80)}"`,
      })
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${at}[${index}]`))
      return
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (PAYLOAD_KEYS.has(key) && child !== null) {
        violations.push({
          gate: 'G-2(c) 载荷字段',
          where: `${label}${at}.${key}`,
          detail: `小票正文/顾客信息/商品明细/ESC-POS 或自由文本字段不得进入 golden（实际取值 ${JSON.stringify(child).slice(0, 60)}）`,
        })
        continue
      }
      walk(child, `${at}.${key}`)
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    violations.push({ gate: 'G-2 解析失败', where: label, detail: (error as Error).message })
    return violations
  }
  walk(parsed, '')

  return violations
}

function reportViolations(violations: Violation[], headline: string): never {
  const lines = violations.map((v) => `  [${v.gate}] ${v.where}\n      ${v.detail}`)
  throw new Error(`${headline}\n${lines.join('\n')}\n共 ${violations.length} 条违规；G-2 未通过，拒绝写入/接受 golden。`)
}

/** 只取对 v2 行为有意义的列，避免无关 schema 变动造成噪声失败。 */
const OBSERVED_COLUMNS = [
  'schemaVersion', 'status', 'claimAttempt', 'attemptCount', 'maxAttempts',
  'resultStatus', 'resultCode', 'effectBoundary', 'physicalCompletionKnown',
  'kitchenJobSuppressed',
] as const

async function observeJob(jobId: string) {
  const row = await prisma.eshopTrayPrintJob.findUnique({ where: { id: jobId } })
  if (!row) return { present: false }
  const picked: Record<string, unknown> = { present: true }
  for (const column of OBSERVED_COLUMNS) picked[column] = (row as Record<string, unknown>)[column]
  picked.hasLease = row.leaseExpiresAt !== null
  picked.hasClaimTokenHash = row.claimTokenHash !== null
  return picked
}

/**
 * 捕获一次调用的结果。非 RelayServiceError 的异常只记录错误类名，不记录
 * message —— message 可能携带连接串或行内容，且不可控，进入 golden 即污染。
 */
async function capture(run: () => Promise<unknown>) {
  try {
    return { outcome: 'RESOLVED', value: normalize(await run()) }
  } catch (error) {
    if (error instanceof RelayServiceError) {
      return { outcome: 'RELAY_SERVICE_ERROR', code: error.code, status: error.status }
    }
    console.error(`UNEXPECTED ERROR（不会写入快照的原始信息）：${(error as Error).stack}`)
    return { outcome: 'UNEXPECTED_ERROR', name: (error as Error).name.toUpperCase() }
  }
}

function request(id = `request-${randomUUID()}`, bytes = Buffer.from([0x1b, 0x40])): EshopTrayPrintRequest {
  return parsePrintRequest({
    relayVersion: '0.1',
    requestId: id,
    orderNo: `ORDER-${randomUUID()}`,
    documentName: 'v2 invariance snapshot',
    target: { transport: 'windows-queue', queueName: '前台' },
    commandStream: {
      encoding: 'base64',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      data: bytes.toString('base64'),
    },
  })
}

async function seedScope(label: string, fp: Footprint) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const tenant = await prisma.tenant.create({
    data: { name: `${label}-${suffix}`, status: 'ACTIVE', tier: 'STANDARD' },
  })
  fp.tenantIds.push(tenant.id)
  const store = await prisma.store.create({
    data: { tenantId: tenant.id, code: `${label}-${suffix}`.slice(0, 80), name: `${label} store`, status: 'ACTIVE' },
  })
  fp.storeIds.push(store.id)
  const installationId = `installation_${randomUUID().replaceAll('-', '_')}`
  const deviceSecret = `ecc_v1_${'d'.repeat(32)}${randomUUID().replaceAll('-', '')}`
  const claimSecret = `ecr_v1_${'c'.repeat(32)}${randomUUID().replaceAll('-', '')}`
  const binding = await prisma.computerBinding.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      installationIdHash: hashInstallationId(installationId),
      computerName: `${label}-computer`,
      agentVersion: '0.1.3',
      status: 'APPROVED',
      expiresAt: new Date(Date.now() + 86_400_000),
      claimSecretHash: hashClaimSecret(claimSecret),
      deviceSecretHash: hashDeviceSecret(deviceSecret),
      credentialStatus: 'ACTIVE',
      credentialActivatedAt: new Date(),
      credentialExpiresAt: new Date(Date.now() + 86_400_000),
      boundAt: new Date(),
    },
  })
  fp.bindingIds.push(binding.id)
  return {
    tenant,
    store,
    scope: { tenantId: tenant.id, storeId: store.id },
    agent: { tenantId: tenant.id, storeId: store.id, computerBindingId: binding.id },
  }
}

/** FK 安全顺序清理，只删登记在案的 id；残留必须显式报告，不得吞掉。 */
async function teardown(fp: Footprint, pass: string) {
  const leftovers: string[] = []

  try {
    if (fp.tenantIds.length > 0) {
      // EshopTrayPrintJob → ComputerBinding 是 onDelete: Restrict，必须先删任务行。
      // 按本遍创建的 tenantId 限定，既覆盖夹具行也覆盖 service 层生产的行。
      await prisma.eshopTrayPrintJob.deleteMany({ where: { tenantId: { in: fp.tenantIds } } })
    }
  } catch (error) { leftovers.push(`EshopTrayPrintJob: ${(error as Error).message}`) }

  try {
    if (fp.bindingIds.length > 0) {
      await prisma.computerBinding.deleteMany({ where: { id: { in: fp.bindingIds } } })
    }
  } catch (error) { leftovers.push(`ComputerBinding: ${(error as Error).message}`) }

  try {
    if (fp.storeIds.length > 0) {
      await prisma.store.deleteMany({ where: { id: { in: fp.storeIds } } })
    }
  } catch (error) { leftovers.push(`Store: ${(error as Error).message}`) }

  try {
    if (fp.tenantIds.length > 0) {
      await prisma.tenant.deleteMany({ where: { id: { in: fp.tenantIds } } })
    }
  } catch (error) { leftovers.push(`Tenant: ${(error as Error).message}`) }

  const remainingTenants = fp.tenantIds.length === 0 ? 0
    : await prisma.tenant.count({ where: { id: { in: fp.tenantIds } } })
  const remainingJobs = fp.tenantIds.length === 0 ? 0
    : await prisma.eshopTrayPrintJob.count({ where: { tenantId: { in: fp.tenantIds } } })

  if (leftovers.length > 0 || remainingTenants > 0 || remainingJobs > 0) {
    console.error(`I-1 清理未完成（${pass}），以下测试数据可能残留在隔离测试库中：`)
    for (const line of leftovers) console.error(`  ${line}`)
    console.error(`  tenantIds  = ${JSON.stringify(fp.tenantIds)}`)
    console.error(`  storeIds   = ${JSON.stringify(fp.storeIds)}`)
    console.error(`  bindingIds = ${JSON.stringify(fp.bindingIds)}`)
    console.error(`  jobIds     = ${JSON.stringify(fp.jobIds)}`)
    throw new Error(`I-1 teardown incomplete (${pass})`)
  }

  console.log(
    `I-1 CLEANUP（${pass}）：已删除 tenant ${fp.tenantIds.length} / store ${fp.storeIds.length} `
    + `/ binding ${fp.bindingIds.length} / job ${fp.jobIds.length}（含 service 层生产行），残留 0`)
}

// ── 场景 ────────────────────────────────────────────────────────────────
async function runAllScenarios(fp: Footprint): Promise<Record<string, unknown>> {
  const observations: Record<string, unknown> = {}
  const scenario = async (name: string, run: () => Promise<unknown>) => {
    observations[name] = await capture(run)
    console.log(`CAPTURED ${name}`)
  }

  // ── v1 通道：claim / executing / complete 状态机契约 ────────────────────
  {
    const s = await seedScope('v2inv-v1', fp)
    const { job } = await enqueueRelayPrintJob(s.scope, request(), timing)
    fp.jobIds.push(job.id)

    await scenario('v1.claim.first', async () => {
      const claimed = await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 1 }, timing)
      return { claimed: claimed ? { claimAttempt: claimed.claimAttempt, status: 'CLAIMED' } : null,
               row: await observeJob(job.id) }
    })

    await scenario('v1.claim.secondWhileActive', async () => {
      const claimed = await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 1 }, timing)
      // 只观察"是否拿到"，不把请求体带进快照。
      return { claimedIsNull: claimed === null }
    })
  }

  // ── v2 通道：整店单飞、UNKNOWN 阻断 ─────────────────────────────────────
  {
    const s = await seedScope('v2inv-v2', fp)

    await scenario('v2.claim.emptyQueue', async () => ({
      claimedIsNull: (await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 2 }, timing)) === null,
    }))

    // 整店已有 CLAIMED/EXECUTING 时必须返回 null（Δ-1 整店单飞）
    const active = await prisma.eshopTrayPrintJob.create({
      data: {
        tenantId: s.scope.tenantId, storeId: s.scope.storeId, schemaVersion: 2,
        idempotencyKey: `active-${randomUUID()}`, requestHash: createHash('sha256').update('active').digest('hex'),
        payload: { role: 'FRONT', mode: 'FRONT_ONLY' }, status: 'CLAIMED',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    fp.jobIds.push(active.id)
    await scenario('v2.claim.storeSingleFlightBlocks', async () => ({
      claimedIsNull: (await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 2 }, timing)) === null,
      activeRow: await observeJob(active.id),
    }))
    await prisma.eshopTrayPrintJob.update({ where: { id: active.id }, data: { status: 'SUCCEEDED', completedAt: new Date() } })

    // 整店存在 CROSSING_UNKNOWN 时必须返回 null（Δ-2 整店 UNKNOWN 停机）
    const unknown = await prisma.eshopTrayPrintJob.create({
      data: {
        tenantId: s.scope.tenantId, storeId: s.scope.storeId, schemaVersion: 2,
        idempotencyKey: `unknown-${randomUUID()}`, requestHash: createHash('sha256').update('unknown').digest('hex'),
        payload: { role: 'KITCHEN', mode: 'FRONT_ONLY' }, status: 'FAILED',
        effectBoundary: 'CROSSING_UNKNOWN', physicalCompletionKnown: false,
        completedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    fp.jobIds.push(unknown.id)
    await scenario('v2.claim.storeUnknownBlocks', async () => ({
      claimedIsNull: (await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 2 }, timing)) === null,
      unknownRow: await observeJob(unknown.id),
    }))
  }

  // ── 终态契约：幂等、冲突、stale claim ──────────────────────────────────
  {
    const s = await seedScope('v2inv-terminal', fp)
    const { job } = await enqueueRelayPrintJob(s.scope, request(), timing)
    fp.jobIds.push(job.id)
    const claimed = await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 1 }, timing)
    assert.ok(claimed, 'terminal 场景需要一次成功 claim')
    const proof = { schemaVersion: 1 as const, claimAttempt: claimed.claimAttempt, claimToken: claimed.claimToken }

    await scenario('terminal.markExecuting', async () => {
      await markRelayPrintJobExecuting({ ...s.agent, schemaVersion: 1 }, job.id, proof, timing)
      return { row: await observeJob(job.id) }
    })

    const success = { state: 'SUCCEEDED' as const, resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
      effectBoundary: 'CROSSED' as const, physicalCompletionKnown: false as const, ...proof }

    await scenario('terminal.complete', async () => ({
      result: await completeRelayPrintJob({ ...s.agent, schemaVersion: 1 }, job.id, success),
      row: await observeJob(job.id),
    }))

    await scenario('terminal.completeIdempotent', async () => ({
      result: await completeRelayPrintJob({ ...s.agent, schemaVersion: 1 }, job.id, success),
    }))

    await scenario('terminal.completeConflict', async () => ({
      result: await completeRelayPrintJob({ ...s.agent, schemaVersion: 1 }, job.id, {
        ...success, state: 'FAILED' as const, resultCode: 'DIFFERENT', effectBoundary: 'CROSSING_UNKNOWN' as const,
      }),
    }))

    await scenario('terminal.staleClaimAttempt', async () => ({
      result: await completeRelayPrintJob({ ...s.agent, schemaVersion: 1 }, job.id, { ...success, claimAttempt: 999 }),
    }))
  }

  // ── 超时回收：EXECUTING + lease 过期 → FAILED / CROSSING_UNKNOWN，不重派 ──
  {
    const s = await seedScope('v2inv-recover', fp)
    const { job } = await enqueueRelayPrintJob(s.scope, request(), timing)
    fp.jobIds.push(job.id)
    const claimed = await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 1 }, timing)
    assert.ok(claimed, 'recover 场景需要一次成功 claim')
    await markRelayPrintJobExecuting({ ...s.agent, schemaVersion: 1 }, job.id,
      { schemaVersion: 1, claimAttempt: claimed.claimAttempt, claimToken: claimed.claimToken }, timing)
    await prisma.eshopTrayPrintJob.update({
      where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    })

    await scenario('recover.timedOutExecutingBecomesUnknown', async () => {
      const claimedAgain = await claimNextRelayPrintJob({ ...s.agent, schemaVersion: 1 }, timing)
      return { claimedAgainIsSameJob: claimedAgain?.id === job.id, row: await observeJob(job.id) }
    })
  }

  return observations
}

const serialize = (observations: Record<string, unknown>) => JSON.stringify(observations, null, 2) + '\n'

/** 跑一遍完整场景并清理；返回序列化后的 JSON。 */
async function runPass(pass: string): Promise<string> {
  const fp = newFootprint()
  let json: string
  try {
    json = serialize(await runAllScenarios(fp))
  } finally {
    await teardown(fp, pass)
  }
  return json
}

function firstDifferingScenario(a: string, b: string): string {
  try {
    const left = JSON.parse(a) as Record<string, unknown>
    const right = JSON.parse(b) as Record<string, unknown>
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    for (const key of keys) {
      const l = JSON.stringify(left[key])
      const r = JSON.stringify(right[key])
      if (l !== r) return `${key}\n    第一遍 ${l}\n    第二遍 ${r}`
    }
  } catch { /* 解析失败时退回整体比对 */ }
  return '（无法定位到单个场景；两份 JSON 整体不同）'
}

async function main() {
  await loadRuntimeDependencies()

  if (UPDATING) {
    // ── G-1 确定性：连续两遍，完整清理，SHA-256 必须一致 ──────────────────
    const first = await runPass('第一遍 / determinism A')
    const second = await runPass('第二遍 / determinism B')
    const firstHash = sha256(first)
    const secondHash = sha256(second)

    if (firstHash !== secondHash) {
      throw new Error(
        'G-1 确定性门槛未通过：两遍 snapshot 的 SHA-256 不一致，拒绝写入 golden。\n'
        + `  第一遍 ${firstHash}\n  第二遍 ${secondHash}\n`
        + `  第一处差异场景：${firstDifferingScenario(first, second)}\n`
        + '  说明存在未归一化的易变字段或跨遍残留状态，必须先修好 normalize/清理。',
      )
    }
    console.log(`G-1 PASS：两遍 snapshot SHA-256 一致 ${firstHash}`)

    // ── G-2 内容审计 ────────────────────────────────────────────────────
    const violations = auditSnapshot(first, '<candidate>')
    if (violations.length > 0) {
      reportViolations(violations, 'G-2 内容审计未通过：候选 golden 含不允许出现的内容，拒绝写入。')
    }
    console.log('G-2 PASS：候选 golden 不含密钥/连接串/未归一化字段/小票与顾客数据')

    // ── G-3 顺序：G-1 与 G-2 均通过后才落盘 ───────────────────────────────
    fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true })
    fs.writeFileSync(SNAPSHOT_PATH, first, 'utf8')
    console.log(`G-3 PASS：已写入 ${SNAPSHOT_PATH}`)
    console.log(`  场景数 ${Object.keys(JSON.parse(first)).length}　SHA-256 ${firstHash}`)
    console.log('⚠ 写入 golden 只能在 v2 冻结基线上做一次；提交时必须附基线 SHA 与本 SHA-256。')
    return
  }

  // ── 比对模式 ──────────────────────────────────────────────────────────
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    throw new Error(
      `I-1 golden 缺失：${SNAPSHOT_PATH}\n`
      + '必须先在 v2 冻结基线上以 UPDATE_V2_ENDTOEND_SNAPSHOT=1 生成一次；'
      + '缺 golden 时本套件一律失败，不得静默通过。',
    )
  }

  const golden = fs.readFileSync(SNAPSHOT_PATH, 'utf8')
  // golden 本身也要过 G-2：防止有人手工编辑后把敏感内容塞进基线。
  const goldenViolations = auditSnapshot(golden, '<golden>')
  if (goldenViolations.length > 0) {
    reportViolations(goldenViolations, `G-2 内容审计未通过：磁盘上的 golden（${SNAPSHOT_PATH}）含不允许出现的内容。`)
  }

  const captured = await runPass('比对')
  assert.equal(captured, golden,
    'I-1 违约：v2 端到端行为与冻结基线快照不一致。\n'
    + '这不是"更新快照"就能解决的问题——请先确认是否命中 ESC-1（改变 v2 行为）。')

  console.log(
    `I-1 PASS：${Object.keys(JSON.parse(golden)).length} 个 v2 场景与冻结基线快照逐字段一致`
    + `（golden SHA-256 ${sha256(golden)}）`)
}

/**
 * CJS 兼容入口。
 *
 * harness 以 tsx 在 CommonJS 下加载 .test.ts，顶层 `await` 会在解析阶段就失败，
 * 且失败发生在隔离守卫之前——那等于守卫根本没跑。因此这里收敛为
 * async main() + then/catch，不使用任何顶层 await。
 *
 * 语义不变：
 *   · 进程入口的隔离守卫仍是模块顶层 throw，先于本入口执行，不受影响；
 *   · 每一遍场景的清理仍在 runPass 的 finally 中完成；
 *   · 主流程失败时先断开连接，再以非零退出码结束。
 */
async function disconnectQuietly() {
  if (!runtimeLoaded) return
  try {
    await prisma.$disconnect()
  } catch (error) {
    console.error(`prisma.$disconnect 失败（不掩盖主结果）：${(error as Error).message}`)
  }
}

main().then(
  async () => {
    await disconnectQuietly()
  },
  async (error: unknown) => {
    await disconnectQuietly()
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    process.exitCode = 1
  },
)

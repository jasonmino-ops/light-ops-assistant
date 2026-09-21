'use strict'
// V2-INVARIANCE-02 / I-2b —— lib/es-tray-relay/service.ts 的区段级不变性守卫。
// 冻结基线：origin/main = 5a2c4dcb30debd75fa2c89a3e165b0ba634502b8
// 依据：ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Design Freeze V1.4 §4（技术不变式）
//
// 为什么不用整文件哈希：
//   service.ts 同时承载 v2 既有执行分支与唯一的 v3 enqueue 扩展点。整文件哈希
//   会随任何合法扩展而失效，于是"证明"退化成"每次改完更新哈希"——那不是不变性
//   证明，是变更记录。本守卫改为：
//     · v2 既有执行分支（claim / markExecuting / complete / recover 等 16 个
//       顶层函数）——逐函数 SHA-256 + 行数 + 相对顺序，逐字冻结；
//     · enqueueRelayPrintJob（唯一 v3 扩展点）——不做哈希冻结，但其既有 v2 判定行
//       必须按原相对顺序完整保留，新增 v3 分支只能是纯增量；
//     · 文件头部（import / type / class 声明区）——既有行按原相对顺序完整
//       保留，允许新增，不允许删除、改写或重排。
//
//   因此"新增 v3 分支未改变 v2 分支的顺序、判定条件或既有输出"这件事，
//   在静态层由本文件证明（顺序 + 判定行 + 逐函数字节），在运行时层由
//   I-1 端到端快照套件 tests/v2-relay-endtoend-snapshot.test.ts 证明。
//
// 失败含义：v2 既有执行分支被改动，或扩展点的既有 v2 判定行被删改/重排。
// 这不是"更新指纹"就能解决的问题——命中升级触发器 ESC-1，必须停止并取得
// 新的 Founder Gate。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')

const FILE = "lib/es-tray-relay/service.ts"

// 唯一允许新增 v3 分支的区段；本区段刻意不做哈希冻结。
const EXTENSION_REGION = "enqueueRelayPrintJob"

// 顶层函数在基线上的相对顺序（允许在其间插入新函数，不允许重排既有函数）。
const REGION_ORDER = [
  "serializeJob",
  "storedRequest",
  "cashierNetworkRoleIdempotencyKey",
  "sameNetworkItem",
  "isOrderedNetworkItemSubset",
  "isValidKitchenDependency",
  "enqueueRelayPrintJob",
  "recoverTimedOutJobs",
  "lockActiveClaimScope",
  "readNetworkQueueState",
  "assertExpectedNetworkMode",
  "hasPotentialRelayWork",
  "claimNextRelayPrintJob",
  "findClaimedJob",
  "markRelayPrintJobExecuting",
  "sameTerminalResult",
  "completeRelayPrintJob",
]

// v2 既有执行分支：逐函数 SHA-256 + 行数，逐字冻结。
const FROZEN_REGIONS = [
  { name: "serializeJob", sha256: "79bc1f8363fee3c86edccdbffdab569e9d2491d351eff86bdb216208251579c7", lines: 26 },
  { name: "storedRequest", sha256: "5d5e7a909dedf334be02ed5e094b4f601dda19d2d5c8110b17125ba0219c4719", lines: 15 },
  { name: "cashierNetworkRoleIdempotencyKey", sha256: "dd538378d87aa7439df25c0a22a5d32a4299ad5d1bf38f69a32d78994afd0cd9", lines: 4 },
  { name: "sameNetworkItem", sha256: "2206bddc9b2cfdf1c545757f0fa86dce589f41ddb731fcf36d81f72e48b8424e", lines: 10 },
  { name: "isOrderedNetworkItemSubset", sha256: "32cd31007946f44fd2dbbc510b7ab51118f7fd34cfd31027a958fdd7e0cd1a5f", lines: 14 },
  { name: "isValidKitchenDependency", sha256: "0d7ec3fc6c99e67ebc13167763d244807eaf4bc9d09986c8567ba8e729ecd2e8", lines: 16 },
  { name: "recoverTimedOutJobs", sha256: "232ab9fc56ef0dfa336a4e0158a95db48fcd382f825600581b877050b0997a91", lines: 106 },
  { name: "lockActiveClaimScope", sha256: "976abfadeaf06e23499c58433695050a37f2f4a08db8d83a3572e985ceeefb79", lines: 36 },
  { name: "readNetworkQueueState", sha256: "a15a292d3dc9252ce0aa1f20f8e4ba26c9b50f76c7cfddb90faa62bc319db2ab", lines: 16 },
  { name: "assertExpectedNetworkMode", sha256: "5f7106382a2586269238dab0cda4620970caed76fabb2e20587a651600b51837", lines: 29 },
  { name: "hasPotentialRelayWork", sha256: "768965eeb9b79fe3a6476f5824c6aa457441f942b53f50bfbc75b84dde439d17", lines: 19 },
  { name: "claimNextRelayPrintJob", sha256: "0a90cb5612fa27b88f32aa433ecab41fc36812e638378ed35f1c9020941cb4e7", lines: 175 },
  { name: "findClaimedJob", sha256: "bdb801e698034933acb739d33b3360e918d178c78be4113cd63f28aae23414d7", lines: 14 },
  { name: "markRelayPrintJobExecuting", sha256: "2dc5ffe01f52c006162f20abba70edaefda9383110bbddc7366fa9335dd90cbf", lines: 47 },
  { name: "sameTerminalResult", sha256: "2642a198cd2b978ecc992da01f58b76f359513df0b1d5b07fe91b0cca091880b", lines: 8 },
  { name: "completeRelayPrintJob", sha256: "12b55aaa1887a41cc603e8fec3c735b4d37d833f28ebb7efecc466a1cc68cd74", lines: 55 },
]

// 文件头部（import / type / class 声明区）在基线上的既有非空行。
const HEADER_LINES = [
  "import { Prisma, type EshopTrayPrintJob } from '@prisma/client'",
  "import { createHash } from 'node:crypto'",
  "import {",
  "parseNetworkMode,",
  "parseNetworkRequest,",
  "type NetworkMode,",
  "type NetworkRequest,",
  "type NetworkSnapshot,",
  "} from '../../e-shop-tray/src/networkContract'",
  "import { prisma } from '@/lib/prisma'",
  "import {",
  "ES_TRAY_RELAY_SCHEMA_VERSION,",
  "type RelayTimingConfig,",
  "} from './config'",
  "import {",
  "hashPrintRequest,",
  "parsePrintRequest,",
  "type EshopTrayPrintRequest,",
  "type RelayClaimProof,",
  "type RelayTerminalResult,",
  "} from './contract'",
  "import { createClaimToken, hashClaimToken } from './crypto'",
  "export class RelayServiceError extends Error {",
  "constructor(",
  "public readonly code: string,",
  "public readonly status: number,",
  ") {",
  "super(code)",
  "this.name = 'RelayServiceError'",
  "}",
  "}",
  "export type RelayStoreScope = {",
  "tenantId: string",
  "storeId: string",
  "}",
  "export type RelayAgentScope = RelayStoreScope & {",
  "computerBindingId: string",
  "schemaVersion?: 1 | 2",
  "expectedMode?: NetworkMode",
  "}",
  "export type ClaimedRelayJob = {",
  "id: string",
  "schemaVersion: 1 | 2",
  "idempotencyKey: string",
  "requestHash: string",
  "claimAttempt: number",
  "claimToken: string",
  "leaseExpiresAt: string",
  "request: EshopTrayPrintRequest | NetworkRequest",
  "}",
]

// 扩展点内部既有的 v2 版本判定行；新增 v3 分支不得删改或重排它们。
const EXTENSION_V2_PREDICATES = [
  "...scope, idempotencyKey: normalized.requestId, requestHash, schemaVersion: 2,",
  "if (job.requestHash !== requestHash || job.schemaVersion !== 2) {",
  "schemaVersion: ES_TRAY_RELAY_SCHEMA_VERSION,",
  "if (existing.requestHash !== requestHash || existing.schemaVersion !== ES_TRAY_RELAY_SCHEMA_VERSION) {",
]

// ── 自检：清单本身必须自洽 ────────────────────────────────────────────
assert.equal(REGION_ORDER.length, 17, 'I-2b 顶层函数基线条目数已变化；增删属治理变更')
assert.equal(FROZEN_REGIONS.length, 16, 'I-2b 冻结区段条目数已变化；增删属治理变更')
assert.ok(!FROZEN_REGIONS.some((r) => r.name === EXTENSION_REGION),
  'I-2b 自检失败：扩展点不得同时被哈希冻结')
assert.deepEqual(
  [...FROZEN_REGIONS.map((r) => r.name), EXTENSION_REGION].sort(),
  [...REGION_ORDER].sort(),
  'I-2b 自检失败：冻结区段 ∪ 扩展点 必须恰好等于顶层函数基线')

// ── 切分：与基线生成器同一算法（顶层 function 声明 → 首个列 0 的 "}"） ──
const source = fs.readFileSync(FILE, 'utf8').split('\n')
const DECLARATION = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/

const regions = []
for (let i = 0; i < source.length; i += 1) {
  const match = source[i].match(DECLARATION)
  if (!match) continue
  let end = -1
  for (let k = i + 1; k < source.length; k += 1) {
    if (source[k] === '}') { end = k; break }
  }
  assert.notEqual(end, -1, `I-2b 切分失败：${match[1]} 找不到列 0 的闭合花括号`)
  regions.push({
    name: match[1],
    start: i,
    end,
    lines: end - i + 1,
    sha256: crypto.createHash('sha256').update(source.slice(i, end + 1).join('\n')).digest('hex'),
  })
}

const byName = new Map()
for (const region of regions) {
  assert.ok(!byName.has(region.name), `I-2b 违约：顶层函数 ${region.name} 重复定义`)
  byName.set(region.name, region)
}

// ── A1 头部区：既有行按原相对顺序完整保留（允许新增） ──────────────────
assert.ok(regions.length > 0, 'I-2b 违约：service.ts 中找不到任何顶层函数')
const headerActual = source.slice(0, regions[0].start).map((line) => line.trim()).filter(Boolean)
let headerCursor = -1
for (const expected of HEADER_LINES) {
  const at = headerActual.indexOf(expected, headerCursor + 1)
  assert.notEqual(at, -1,
    `I-2b 违约（头部区）：既有声明行缺失或被改写/重排\n  ${expected}\n` +
    '  头部只允许纯新增，不允许删除、改写或重排既有行。')
  headerCursor = at
}

// ── A2 顶层函数相对顺序不变 ───────────────────────────────────────────
const orderActual = regions.map((region) => region.name)
let orderCursor = -1
for (const expected of REGION_ORDER) {
  const at = orderActual.indexOf(expected, orderCursor + 1)
  assert.notEqual(at, -1,
    `I-2b 违约（顺序）：顶层函数 ${expected} 缺失或相对顺序被改变\n` +
    `  基线顺序 ${REGION_ORDER.join(' → ')}\n  实际顺序 ${orderActual.join(' → ')}`)
  orderCursor = at
}

// ── A3 v2 既有执行分支逐字冻结 ────────────────────────────────────────
for (const { name, sha256, lines } of FROZEN_REGIONS) {
  const region = byName.get(name)
  assert.ok(region, `I-2b 违约：v2 冻结区段 ${name} 已从 ${FILE} 消失`)
  assert.equal(region.lines, lines,
    `I-2b 违约：${name} 行数变化（期望 ${lines}，实际 ${region.lines}）`)
  assert.equal(region.sha256, sha256,
    `I-2b 违约：${name} 内容已变化\n  期望 ${sha256}\n  实际 ${region.sha256}\n` +
    '  v2 既有执行分支不得修改（ESC-1），请停止并取得新的 Founder Gate。')
}

// ── A4 扩展点：既有 v2 判定行按原相对顺序完整保留 ──────────────────────
const extension = byName.get(EXTENSION_REGION)
assert.ok(extension, `I-2b 违约：扩展点 ${EXTENSION_REGION} 已从 ${FILE} 消失`)
const extensionLines = source.slice(extension.start, extension.end + 1).map((line) => line.trim())
let predicateCursor = -1
for (const expected of EXTENSION_V2_PREDICATES) {
  const at = extensionLines.indexOf(expected, predicateCursor + 1)
  assert.notEqual(at, -1,
    `I-2b 违约（扩展点）：${EXTENSION_REGION} 的既有 v2 判定行缺失或被改写/重排\n  ${expected}\n` +
    '  v3 只能新增分支；既有 v2 判定条件与求值顺序必须逐字保留。')
  predicateCursor = at
}

console.log(
  `I-2b PASS：${FROZEN_REGIONS.length} 个 v2 执行分支逐字冻结、` +
  `${REGION_ORDER.length} 个顶层函数顺序不变、` +
  `扩展点 ${EXTENSION_REGION} 的 ${EXTENSION_V2_PREDICATES.length} 条 v2 判定行完整保留（基线 5a2c4dcb30de）`)

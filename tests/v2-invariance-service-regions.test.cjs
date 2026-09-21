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
//     · 文件头部（import / type / class 声明区）——基线原始字节逐字冻结；
//     · 既有顶层函数之间的全部间隙——逐字冻结，禁止插入顶层可执行语句、
//       常量初始化、副作用或 monkey patch；
//     · 顶层函数集合——不得插入新的 helper。以后唯一允许修改的 service.ts
//       区域就是 enqueueRelayPrintJob 函数体；新的 v3 helper 必须放在独立模块。
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

// 顶层函数在基线上的精确顺序；不允许插入新函数或重排既有函数。
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

// 顶层函数之间的既有间隙逐字冻结。空白间隙使用 SHA-256 仍然校验，
// 因而在任一间隙插入顶层可执行语句、常量初始化、副作用或 monkey patch
// 都会 fail-closed；不要把它们改成“允许新增 helper”的扩展面。
const FROZEN_GAPS = [
  { from: "serializeJob", to: "storedRequest", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "storedRequest", to: "cashierNetworkRoleIdempotencyKey", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "cashierNetworkRoleIdempotencyKey", to: "sameNetworkItem", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "sameNetworkItem", to: "isOrderedNetworkItemSubset", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "isOrderedNetworkItemSubset", to: "isValidKitchenDependency", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "isValidKitchenDependency", to: "enqueueRelayPrintJob", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "enqueueRelayPrintJob", to: "recoverTimedOutJobs", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "recoverTimedOutJobs", to: "lockActiveClaimScope", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "lockActiveClaimScope", to: "readNetworkQueueState", sha256: "ef67a6553fa047707c1c078966d1f485b00c771991a39b11aaf227e9d4085c06", lines: 2 },
  { from: "readNetworkQueueState", to: "assertExpectedNetworkMode", sha256: "e974d816549ade1b4292ba7e0f3f7e067245db7dc3bfed6e20be14029cad123f", lines: 3 },
  { from: "assertExpectedNetworkMode", to: "hasPotentialRelayWork", sha256: "0e9a6b9c6a78c917f35247dda3e2b5e3532fe5baca6b5e0288073050dcffe55d", lines: 3 },
  { from: "hasPotentialRelayWork", to: "claimNextRelayPrintJob", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "claimNextRelayPrintJob", to: "findClaimedJob", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "findClaimedJob", to: "markRelayPrintJobExecuting", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "markRelayPrintJobExecuting", to: "sameTerminalResult", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
  { from: "sameTerminalResult", to: "completeRelayPrintJob", sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", lines: 1 },
]

// service.ts 的头部与尾部基线原始字节。头部包含 import / class / type 声明区；
// 任何新增顶层语句、常量初始化、副作用或 monkey patch 都必须 fail-closed。
const FROZEN_HEADER = {
  lines: 55,
  sha256: "6336968e920a4062ab14e7f0bd3915d9881244a92b751b6e9e9b745e5ae42cd0",
}
const FROZEN_TAIL = {
  lines: 1,
  sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
}

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
assert.equal(FROZEN_GAPS.length, 16, 'I-2b 顶层函数间隙条目数已变化；增删属治理变更')
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

// ── A1 头部区：原始字节逐字冻结 ────────────────────────────────────────
assert.ok(regions.length > 0, 'I-2b 违约：service.ts 中找不到任何顶层函数')
const header = source.slice(0, regions[0].start).join('\n')
assert.equal(regions[0].start, FROZEN_HEADER.lines,
  `I-2b 违约（头部区）：头部行数变化（期望 ${FROZEN_HEADER.lines}，实际 ${regions[0].start}）`)
assert.equal(crypto.createHash('sha256').update(header).digest('hex'), FROZEN_HEADER.sha256,
  `I-2b 违约（头部区）：头部原始字节已变化；不得新增顶层可执行语句、` +
  `常量初始化、副作用或 monkey patch\n  期望 ${FROZEN_HEADER.sha256}`)

// ── A2 顶层函数集合与顺序均不得变化 ──────────────────────────────────
const orderActual = regions.map((region) => region.name)
assert.deepEqual(orderActual, REGION_ORDER,
  `I-2b 违约（顶层函数集合/顺序）：不得插入 helper 或重排既有函数\n` +
  `  基线顺序 ${REGION_ORDER.join(' → ')}\n  实际顺序 ${orderActual.join(' → ')}`)

// ── A2b 顶层函数之间的全部既有间隙逐字冻结 ─────────────────────────────
for (const { from, to, sha256, lines } of FROZEN_GAPS) {
  const left = byName.get(from)
  const right = byName.get(to)
  assert.ok(left && right, `I-2b 违约：无法定位间隙 ${from} → ${to}`)
  const gap = source.slice(left.end + 1, right.start).join('\n')
  const actualLines = right.start - left.end - 1
  const actualHash = crypto.createHash('sha256').update(gap).digest('hex')
  assert.equal(actualLines, lines,
    `I-2b 违约（函数间隙）：${from} → ${to} 行数变化（期望 ${lines}，实际 ${actualLines}）`)
  assert.equal(actualHash, sha256,
    `I-2b 违约（函数间隙）：${from} → ${to} 含新增顶层语句、常量初始化、` +
    `副作用或 monkey patch；该间隙必须保持冻结\n  期望 ${sha256}\n  实际 ${actualHash}`)
}

// ── A2c 文件尾部：最后一个既有函数之后的原始字节逐字冻结 ───────────────
const lastRegion = regions[regions.length - 1]
const tail = source.slice(lastRegion.end + 1).join('\n')
assert.equal(source.length - lastRegion.end - 1, FROZEN_TAIL.lines,
  `I-2b 违约（尾部区）：尾部行数变化（期望 ${FROZEN_TAIL.lines}，实际 ${source.length - lastRegion.end - 1}）`)
assert.equal(crypto.createHash('sha256').update(tail).digest('hex'), FROZEN_TAIL.sha256,
  `I-2b 违约（尾部区）：最后一个既有函数后追加了顶层语句、副作用或 monkey patch\n` +
  `  期望 ${FROZEN_TAIL.sha256}`)

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
  `头部、${REGION_ORDER.length} 个顶层函数集合/顺序、${FROZEN_GAPS.length} 个函数间隙、尾部均冻结、` +
  `扩展点 ${EXTENSION_REGION} 的 ${EXTENSION_V2_PREDICATES.length} 条 v2 判定行完整保留（基线 5a2c4dcb30de）`)

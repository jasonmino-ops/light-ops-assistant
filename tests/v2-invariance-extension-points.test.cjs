'use strict'
// V2-INVARIANCE-02 / I-3 —— 共享分发点的受限扩展（唯一允许的例外）。
// 冻结基线：origin/main = 5a2c4dcb30debd75fa2c89a3e165b0ba634502b8
// 依据：ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Design Freeze V1.4 §4（技术不变式）
//
// "共享分发点" = 同一段代码同时服务 v2 与未来 v3，且其中含版本判定
// （schemaVersion 谓词）。本文件固化三件事：
//   1. 扩展点清单本身（G1 一次性冻结，后续阶段不得追加）；
//   2. 每个扩展点在基线上的整文件 SHA-256；
//   3. 每个扩展点在基线上含 schemaVersion 的判定行，作为"既有 v2 分支
//      判定条件与求值顺序逐字不变"（I-3 条件 a）的可执行证据。
//
// G1 阶段整文件哈希必须完全一致。将来若要做合法 v3 扩展，必须在同一受审
// PR 内明确更新基线哈希/判定行，并由 I-1 证明 v2 输出不变；本守卫不提供
// driftAuthorized 自动豁免机制。既有 predicates 行必须继续按原相对顺序出现——
// 删除或改写它们即违约。
//
// 关于 lib/es-tray-relay/service.ts：它含唯一的 v3 enqueue 扩展点，但其同文件
// 内还有 16 个 v2 执行分支，整文件哈希不适合做守卫，改由 I-2b 区段级指纹
// 处理（tests/v2-invariance-service-regions.test.cjs）。
//
// 关于 lib/es-tray-relay/cashier-network-producer.ts（已从强制清单移除）：
// 它在基线上对 schemaVersion 零引用，只是调用 enqueueRelayPrintJob 的调用方，
// 版本选择发生在被调用方内部，因此它不是共享分发点。为防止这一前提被悄悄
// 破坏，下方 NON_EXTENSION_INVARIANTS 反向断言它必须继续保持"零版本判定 +
// 委派给 enqueueRelayPrintJob"；一旦它开始自行选择 schemaVersion，该断言
// 失败并强制把它重新纳入 I-3 强制清单（属治理变更，需 Founder Gate）。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')

const EXTENSION_POINTS = [
  {
    file: "lib/es-tray-relay/auth.ts",
    sha256: "9080daf8b5c30e608829e859bbdaea85dc155e9d3e7a47cee364752728aabf5f",
    predicates: [
      "schemaVersion: 1 | 2",
      "const schemaVersion = profile === NETWORK_PROFILE ? 2 : 1",
      "|| (schemaVersion === 2",
      "context: { binding, tenantId: store.tenantId, storeId: store.id, storeCode: store.code, schemaVersion },",
    ],
  },
  {
    file: "lib/es-tray-relay/contract.ts",
    sha256: "7aaa3a61cb2ac8d5448fde6b7d02df2149185cc28f2214b760b88717a552da2c",
    predicates: [
      "schemaVersion: 1 | 2",
      "function parseClaimProof(body: Record<string, unknown>, schemaVersion: 1 | 2): RelayClaimProof {",
      "if (body.schemaVersion !== schemaVersion) {",
      "schemaVersion,",
      "export function parseExecutingInput(value: unknown, schemaVersion: 1 | 2 = ES_TRAY_RELAY_SCHEMA_VERSION): RelayClaimProof {",
      "if (!body || !exactKeys(body, ['schemaVersion', 'claimAttempt', 'claimToken'])) {",
      "return parseClaimProof(body, schemaVersion)",
      "export function parseResultInput(value: unknown, schemaVersion: 1 | 2 = ES_TRAY_RELAY_SCHEMA_VERSION): RelayTerminalResult {",
      "'schemaVersion', 'claimAttempt', 'claimToken', 'state', 'resultCode',",
      "const proof = parseClaimProof(body, schemaVersion)",
    ],
  },
  {
    file: "e-shop-tray/src/cloudRelayClient.ts",
    sha256: "0ff9f1d382f0c61d60d00090fcdd8dfb959ae02e383ec0ad4b3b365045ae1486",
    predicates: [
      "schemaVersion: 1 | 2",
      "if (!body || body.productionContract !== true || body.schemaVersion !== 1 || !('job' in body)) {",
      "|| job.schemaVersion !== 1",
      "schemaVersion: 1,",
      "const body = exactObject(value, ['productionContract', 'schemaVersion', 'bindingId', 'storeCode', 'observedAt', 'queue'])",
      "if (body.productionContract !== true || body.schemaVersion !== 2",
      "const body = exactObject(value, ['productionContract', 'schemaVersion', 'bindingId', 'storeCode', 'job', ...(expectedMode ? ['modeGuard'] : [])])",
      "if (body.productionContract !== true || body.schemaVersion !== 2",
      "const job = exactObject(body.job, ['id', 'schemaVersion', 'idempotencyKey', 'requestHash',",
      "if (job.schemaVersion !== 2 || typeof job.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(job.id)",
      "id: job.id, schemaVersion: 2, idempotencyKey: request.requestId, requestHash: job.requestHash as string,",
      "schemaVersion: this.options.network ? 2 : ES_TRAY_SCHEMA_VERSION,",
      "schemaVersion: this.options.network ? 2 : ES_TRAY_SCHEMA_VERSION,",
    ],
  },
]

assert.equal(EXTENSION_POINTS.length, 3,
  'I-3 扩展点清单条目数已变化；新增共享分发点属治理变更，必须回到 Founder Gate')

for (const { file, sha256, predicates } of EXTENSION_POINTS) {
  let content
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch (error) {
    assert.fail(`I-3 扩展点文件缺失：${file}（${error.code}）`)
  }

  const actual = crypto.createHash('sha256').update(content).digest('hex')
  assert.equal(actual, sha256,
    `I-3 违约：${file} 整文件内容已相对 G1 基线变化\n` +
    `  期望 ${sha256}\n  实际 ${actual}\n` +
    '  G1 阶段必须 fail-closed；未来合法 v3 扩展须在同一受审 PR 内更新基线，' +
    '并由 I-1 证明 v2 输出不变。')

  const lines = content.split('\n').map((line) => line.trim())
  let cursor = -1
  for (const predicate of predicates) {
    const at = lines.indexOf(predicate, cursor + 1)
    assert.notEqual(at, -1,
      `I-3 违约：${file} 的既有 v2 判定行缺失或被改写/重排\n  ${predicate}\n` +
      '  扩展只能是纯新增分支；既有判定条件与求值顺序必须逐字保留。')
    cursor = at
  }
}

// ── 反向断言：以下文件必须继续"不是"共享分发点 ─────────────────────────
const NON_EXTENSION_INVARIANTS = [
  {
    file: "lib/es-tray-relay/cashier-network-producer.ts",
    sha256: "4b1f62b782c9224c0abe51f6278a58404bc0289857ec2324f6629253dfd6c8ea",
    reason: '仅调用 enqueueRelayPrintJob；版本选择在被调用方内部完成。',
    mustDelegateTo: 'enqueueRelayPrintJob',
  },
]

for (const { file, sha256, reason, mustDelegateTo } of NON_EXTENSION_INVARIANTS) {
  const content = fs.readFileSync(file, 'utf8')
  const actual = crypto.createHash('sha256').update(content).digest('hex')
  const hits = content.split('\n').filter((line) => /schemaVersion/.test(line))
  assert.equal(hits.length, 0,
    `I-3 违约（前提失效）：${file} 出现了 ${hits.length} 处 schemaVersion 判定\n` +
    hits.map((line) => `    ${line.trim()}`).join('\n') + '\n' +
    `  该文件被排除出 I-3 强制清单的理由是：${reason}\n` +
    '  一旦它自行选择版本，它就成了共享分发点，必须重新纳入 I-3 —— 属治理变更，需 Founder Gate。\n' +
    `  基线 SHA-256 ${sha256}，实际 ${actual}`)
  assert.ok(content.includes(mustDelegateTo),
    `I-3 违约（前提失效）：${file} 不再委派给 ${mustDelegateTo}`)
}

console.log(
  `I-3 PASS：${EXTENSION_POINTS.length} 个共享分发点的既有 v2 判定行完整且顺序不变；` +
  `${NON_EXTENSION_INVARIANTS.length} 个非分发点仍保持零版本判定（基线 5a2c4dcb30de）`)

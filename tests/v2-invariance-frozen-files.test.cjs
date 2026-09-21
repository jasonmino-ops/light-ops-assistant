'use strict'
// V2-INVARIANCE-02 / I-2a —— 完全 v2 专属模块：整文件禁止任何修改（含格式化）。
// 冻结基线：origin/main = 5a2c4dcb30debd75fa2c89a3e165b0ba634502b8
// 依据：ES-PRINT-LOCAL-FIRST-SHARED-CORE-01 Design Freeze V1.4 §4（技术不变式）
//
// 本清单只收录"不含任何 v3 扩展点"的文件。对这些文件，整文件 SHA-256 与
// "v2 行为不变"是等价的：文件没被编辑 ⇒ 行为没变。
//
// lib/es-tray-relay/service.ts 已从本清单移除：它内部含唯一的 v3 enqueue
// 扩展点，整文件哈希会随合法扩展而变化，用"以后更新整文件哈希"充当不变性
// 证明是无效的。它改由 I-2b 的区段级指纹守卫：
//   tests/v2-invariance-service-regions.test.cjs
//
// 失败含义：某个 v2 专属文件的内容已变化。这不是"更新哈希"就能解决的问题——
// 修改 v2 冻结文件命中升级触发器 ESC-1，必须停止并取得新的 Founder Gate。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const crypto = require('node:crypto')

const FROZEN_FILES = [
  ["e-shop-tray/src/relayPoller.ts", "04bd79f0b4bd55f5508a148b241558d472ef70afb116f0fc97833e164b0783e9"],
  ["e-shop-tray/src/networkRuntime.ts", "fc2d36ea0eea513f8e29e2081eb4f5899ce8c2a60ed19b1e4757fc5326c3b8a0"],
  ["e-shop-tray/src/executionJournal.ts", "15cfecd9c2c8575de93bbd20783f1bd641372f12372424454e587ea4a3f4a5d5"],
  ["e-shop-tray/src/printing/networkRawTcpTransport.ts", "a5a48fac72c43723d6d9f8fd3f51526ccc5bb70df50d89a363cb26f27db1e489"],
  ["app/api/es-tray-02/print-jobs/receive/route.ts", "cb5cd2fd67bc8782d4721c7ebd39750253fe112db9fecd93fb979464ca62c697"],
  ["app/api/es-tray-02/print-jobs/[jobId]/executing/route.ts", "9a472ad9015101f08fa715105b7712f6aaa97c060e235c5d4f91b4ad57fd5e77"],
  ["app/api/es-tray-02/print-jobs/[jobId]/result/route.ts", "7e90b3c4619c86c2b6735d76fabbb1d8bbdddf7296e21f10fcd7ac3080335c31"],
]

assert.equal(FROZEN_FILES.length, 7,
  'I-2a 冻结清单条目数已变化；增删冻结文件属治理变更，不是测试维护')

for (const [file, expected] of FROZEN_FILES) {
  let content
  try {
    content = fs.readFileSync(file)
  } catch (error) {
    assert.fail(`I-2a 冻结文件缺失：${file}（${error.code}）`)
  }
  const actual = crypto.createHash('sha256').update(content).digest('hex')
  assert.equal(actual, expected,
    `I-2a 违约：${file} 内容已变化\n  期望 ${expected}\n  实际 ${actual}\n` +
    '  v2 专属文件不得修改（ESC-1），请停止并取得新的 Founder Gate。')
}

console.log(`I-2a PASS：${FROZEN_FILES.length} 个 v2 专属文件内容未变化（基线 5a2c4dcb30de）`)

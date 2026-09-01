import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CASHIER_REALTIME_OBSERVATION } from '../lib/mino-bos/cashier-realtime-observation'

const page = fs.readFileSync('app/mino-bos/assets-check/page.tsx', 'utf8')
const cardStart = page.indexOf('function CashierRealtimeObservationCard()')
const cardEnd = page.indexOf('function InfoCard(', cardStart)
const cardSource = page.slice(cardStart, cardEnd)

assert.equal(CASHIER_REALTIME_OBSERVATION.status, 'COMPLETED')
assert.equal(CASHIER_REALTIME_OBSERVATION.start, '2026-08-23')
assert.equal(CASHIER_REALTIME_OBSERVATION.plannedEnd, '2026-08-30')
assert.equal(CASHIER_REALTIME_OBSERVATION.window, '7 Days')
assert.equal(CASHIER_REALTIME_OBSERVATION.result, 'ADJUST')
assert.notEqual(CASHIER_REALTIME_OBSERVATION.result, 'PASS', 'the historical 7-day result must remain ADJUST')
assert.equal(CASHIER_REALTIME_OBSERVATION.issue, 'Durable Object WebSocket close-code lifecycle exception')
assert.equal(CASHIER_REALTIME_OBSERVATION.issueSeverity, 'LOW')
assert.equal(CASHIER_REALTIME_OBSERVATION.adjustment, '1005 / 1006 / 1015 reserved close-code guard')
assert.equal(CASHIER_REALTIME_OBSERVATION.postFixVerification, 'PASS')
assert.equal(CASHIER_REALTIME_OBSERVATION.decision, 'KEEP')
assert.equal(CASHIER_REALTIME_OBSERVATION.releaseStatus, 'FIELD VERIFIED / CLOSED')
assert.equal(CASHIER_REALTIME_OBSERVATION.finalFrozen, true)

assert.deepEqual(CASHIER_REALTIME_OBSERVATION.baseline, [
  { metric: 'Cashier 固定轮询', before: '≈5s', current: '≈30s' },
  { metric: '单 API 固定请求', before: '≈12/min', current: '≈2/min' },
  { metric: '两 API 固定请求合计', before: '≈24/min', current: '≈4/min' },
  { metric: '固定轮询下降', before: '—', current: '≈83.3%' },
])

assert.deepEqual(
  CASHIER_REALTIME_OBSERVATION.checkpoints.map((checkpoint) => checkpoint.status),
  ['NOT RECORDED', 'NOT RECORDED', 'ADJUST'],
  'the closure must preserve unrecorded historical checkpoints and the 7-day ADJUST result',
)

assert.deepEqual(
  CASHIER_REALTIME_OBSERVATION.productionStatus.filter((item) => [
    'Core Realtime Loop',
    'Failure Fallback',
    'Fixed Poll Reduction',
    'Fluid Active CPU',
    'Fast Origin Transfer',
    'Business Regression',
  ].includes(item.label)),
  [
    { label: 'Core Realtime Loop', value: 'FIELD VERIFIED' },
    { label: 'Failure Fallback', value: 'FIELD VERIFIED' },
    { label: 'Fixed Poll Reduction', value: '≈83.3%' },
    { label: 'Fluid Active CPU', value: 'IMPROVING' },
    { label: 'Fast Origin Transfer', value: 'IMPROVING' },
    { label: 'Business Regression', value: 'NONE FOUND' },
  ],
)

assert.ok(cardStart > 0 && cardEnd > cardStart, 'the read-only observation card must exist')
assert.match(page, /<CashierRealtimeObservationCard\s*\/>/)
assert.ok(
  page.indexOf('<CashierRealtimeObservationCard />') > page.indexOf('商户 / 门店状态') &&
    page.indexOf('<CashierRealtimeObservationCard />') < page.indexOf('今日经营摘要'),
  'the observation card should sit between store status and the daily summary',
)
assert.match(cardSource, /READ-ONLY · Founder Decision Support \/ Production Observation/)
assert.match(cardSource, /不是实时 Vercel Usage 数据/)
assert.match(cardSource, /label="Observation Status"/)
assert.match(cardSource, /label="7-Day Result"/)
assert.match(cardSource, /label="Post-fix Verification"/)
assert.match(cardSource, /label="Final Decision"/)
assert.match(cardSource, /label="ES-CASHIER-COST-01 V0\.1"/)
assert.match(cardSource, /value="FINAL FROZEN"/)
assert.match(cardSource, /不修改 Realtime 配置，不执行回退，不写回任何业务数据/)
assert.doesNotMatch(cardSource, /<button|<input|<select|onClick=|onChange=/, 'observation card must remain read-only')
assert.match(page, /gridTemplateColumns: 'minmax\(0, 1\.4fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)'/)
assert.match(page, /gridTemplateColumns: 'repeat\(auto-fit, minmax\(170px, 1fr\)\)'/)
assert.match(page, /flexWrap: 'wrap'/)

console.log('mino bos cashier realtime observation tests passed')

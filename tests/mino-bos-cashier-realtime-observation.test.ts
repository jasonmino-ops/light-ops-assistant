import assert from 'node:assert/strict'
import fs from 'node:fs'
import { CASHIER_REALTIME_OBSERVATION } from '../lib/mino-bos/cashier-realtime-observation'

const page = fs.readFileSync('app/mino-bos/assets-check/page.tsx', 'utf8')
const cardStart = page.indexOf('function CashierRealtimeObservationCard()')
const cardEnd = page.indexOf('function InfoCard(', cardStart)
const cardSource = page.slice(cardStart, cardEnd)

assert.equal(CASHIER_REALTIME_OBSERVATION.status, 'OBSERVING')
assert.equal(CASHIER_REALTIME_OBSERVATION.start, '2026-08-23')
assert.equal(CASHIER_REALTIME_OBSERVATION.plannedEnd, '2026-08-30')
assert.equal(CASHIER_REALTIME_OBSERVATION.window, '7 Days')

assert.deepEqual(CASHIER_REALTIME_OBSERVATION.baseline, [
  { metric: 'Cashier 固定轮询', before: '≈5s', current: '≈30s' },
  { metric: '单 API 固定请求', before: '≈12/min', current: '≈2/min' },
  { metric: '两 API 固定请求合计', before: '≈24/min', current: '≈4/min' },
  { metric: '固定轮询下降', before: '—', current: '≈83.3%' },
])

assert.deepEqual(
  CASHIER_REALTIME_OBSERVATION.checkpoints.map((checkpoint) => checkpoint.status),
  ['PENDING', 'PENDING', 'PENDING'],
  'unrecorded observation checkpoints must remain PENDING',
)
assert.equal(CASHIER_REALTIME_OBSERVATION.decision, 'PENDING')

assert.ok(cardStart > 0 && cardEnd > cardStart, 'the read-only observation card must exist')
assert.match(page, /<CashierRealtimeObservationCard\s*\/>/)
assert.ok(
  page.indexOf('<CashierRealtimeObservationCard />') > page.indexOf('商户 / 门店状态') &&
    page.indexOf('<CashierRealtimeObservationCard />') < page.indexOf('今日经营摘要'),
  'the observation card should sit between store status and the daily summary',
)
assert.match(cardSource, /READ-ONLY · Founder Decision Support \/ Production Observation/)
assert.match(cardSource, /不是实时 Vercel Usage 数据/)
assert.match(cardSource, /Pending observation \/ manual review required/)
assert.match(cardSource, /不修改 Realtime 配置，不执行回退，不自动 FINAL FROZEN/)
assert.doesNotMatch(cardSource, /<button|<input|<select|onClick=|onChange=/, 'observation card must remain read-only')
assert.match(page, /gridTemplateColumns: 'minmax\(0, 1\.4fr\) minmax\(0, 1fr\) minmax\(0, 1fr\)'/)

console.log('mino bos cashier realtime observation tests passed')

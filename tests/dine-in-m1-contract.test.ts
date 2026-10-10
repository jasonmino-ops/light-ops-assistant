/**
 * ES-DINE-IN-01 M1 — rules that hold without a database: the pure kitchen-notice
 * logic, wording completeness, and the structural boundaries of the module
 * (what it must never import, write or store). Behaviour against PostgreSQL lives
 * in tests/dine-in-m1-db.test.ts.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  DINING_NOTICE_REPORT_OUTCOMES,
  DINING_NOTICE_TTL_MS,
  bridgeResultToReportOutcome,
  deriveDiningNoticeStatus,
  diningNoticeDeliverable,
  diningNoticeStale,
  diningNoticePrintOrderNo,
  kitchenAwareness,
  type DiningNoticeEvidence,
  type DiningNoticeStatus,
} from '../lib/dine-in/kitchen-notice'
import { DINING_ERROR_CODES, DINING_TEXT, diningErrorText, diningText, fill, noticeStatusText } from '../lib/dine-in/i18n'
import { diningNoticeHeading, renderDiningKitchenNoticeHtml, type DiningNoticeContent } from '../lib/dine-in/ticket-renderer'
import { DiningCommandError, money, parseMoney, requestDigest, requireRequestKey } from '../lib/dine-in/types'
import { isDiningTrialStore } from '../lib/dine-in/eligibility'
import { canonicalV3PrintEffectKey } from '../lib/v3-print-identity'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
function files(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}
const moduleFiles = [...files('lib/dine-in'), ...files('app/api/dine-in'), ...files('app/desktop/dine-in')]
const moduleSource = new Map(moduleFiles.map((file) => [file, read(file)]))

test('notice state: every combination of page report and print-job evidence', () => {
  const state = (reportedOutcome: string | null, evidence: DiningNoticeEvidence, extra: Partial<Parameters<typeof deriveDiningNoticeStatus>[0]> = {}) =>
    deriveDiningNoticeStatus({ required: true, claimed: true, withdrawn: false, deliverable: true, stale: false, reportedOutcome, evidence, ...extra })

  assert.equal(state(null, null, { required: false }), 'NOT_REQUIRED')
  assert.equal(state(null, null, { claimed: false }), 'PENDING_SUBMIT')
  assert.equal(state(null, null, { claimed: false, withdrawn: true }), 'WITHDRAWN')
  assert.equal(state(null, null, { claimed: false, deliverable: false }), 'NOT_NOTIFIED_SETTLED')
  // Claimed and silent: nobody can say what happened.
  assert.equal(state(null, null), 'UNKNOWN')
  assert.equal(state(null, 'AMBIGUOUS'), 'UNKNOWN')

  const sent = ['CROSSED'], notSent = ['FAILED_NOT_CROSSED', 'BRIDGE_UNAVAILABLE', 'RENDER_FAILED']
  for (const outcome of DINING_NOTICE_REPORT_OUTCOMES) {
    const expected: Record<string, DiningNoticeStatus> = sent.includes(outcome)
      // The page saying "sent" proves nothing: without a print job row that says printed, it stays unknown.
      ? { none: 'UNKNOWN', PRINTED: 'SENT', DEFINITELY_NOT_PRINTED: 'UNKNOWN', AMBIGUOUS: 'UNKNOWN' }
      : notSent.includes(outcome)
        ? { none: 'NOT_SENT', PRINTED: 'SENT', DEFINITELY_NOT_PRINTED: 'NOT_SENT', AMBIGUOUS: 'UNKNOWN' }
        // Every refusal, fallback, hold and oddity stays unknown unless the job row is conclusive.
        : { none: 'UNKNOWN', PRINTED: 'SENT', DEFINITELY_NOT_PRINTED: 'NOT_SENT', AMBIGUOUS: 'UNKNOWN' }
    assert.equal(state(outcome, null), expected.none, outcome)
    for (const evidence of ['PRINTED', 'DEFINITELY_NOT_PRINTED', 'AMBIGUOUS'] as const) {
      assert.equal(state(outcome, evidence), expected[evidence], `${outcome} + ${evidence}`)
    }
  }
  // Once the meal is no longer open a claimed notice keeps its derived state.
  assert.equal(state('CROSSED', 'PRINTED', { deliverable: false }), 'SENT')
  assert.equal(state('CROSSED', null, { deliverable: false }), 'UNKNOWN')
  // SENT has exactly one source: the print job row. No page report produces it, with or without a row that says otherwise.
  for (const outcome of [null, ...DINING_NOTICE_REPORT_OUTCOMES]) {
    for (const evidence of [null, 'DEFINITELY_NOT_PRINTED', 'AMBIGUOUS'] as const) assert.notEqual(state(outcome, evidence), 'SENT', `${outcome} + ${evidence}`)
    assert.equal(state(outcome, 'PRINTED'), 'SENT', `${outcome} + PRINTED`)
  }
  // A notice nobody took in time is stale: never "pending" again, and certainly not sent. Staleness never touches a taken notice.
  assert.equal(state(null, null, { claimed: false, stale: true }), 'NOT_SENT')
  assert.equal(state(null, null, { claimed: false, stale: true, deliverable: false }), 'NOT_NOTIFIED_SETTLED')
  assert.equal(state(null, null, { claimed: false, stale: true, withdrawn: true }), 'WITHDRAWN')
  assert.equal(state('CROSSED', 'PRINTED', { stale: true }), 'SENT')
  assert.equal(state(null, null, { stale: true }), 'UNKNOWN')
  const created = new Date('2026-10-10T00:00:00.000Z')
  assert.deepEqual(
    [0, DINING_NOTICE_TTL_MS, DINING_NOTICE_TTL_MS + 1, 48 * 60 * 60 * 1000].map((age) => diningNoticeStale(created, new Date(created.getTime() + age))),
    [false, false, true, true],
  )
})

test('bridge answers map onto the closed report set; page-only outcomes cannot be forged by the bridge', () => {
  assert.equal(bridgeResultToReportOutcome({ status: 'CROSSED', admission: 'DURABLY_ACCEPTED' }), 'CROSSED')
  assert.equal(bridgeResultToReportOutcome({ status: 'FAILED_NOT_CROSSED' }), 'FAILED_NOT_CROSSED')
  assert.equal(bridgeResultToReportOutcome({ status: 'HELD', admission: 'DURABLY_ACCEPTED' }), 'HELD')
  assert.equal(bridgeResultToReportOutcome({ status: 'NOT_EXECUTED', reason: 'EXISTING_NON_EXECUTABLE' }), 'NOT_EXECUTED')
  assert.equal(bridgeResultToReportOutcome({ status: 'V2_FALLBACK_REQUIRED', reason: 'V3_RUNTIME_UNAVAILABLE' }), 'V2_FALLBACK_REQUIRED')
  assert.equal(bridgeResultToReportOutcome({ status: 'EXECUTION_RECORDED_REPORT_PENDING', execution: { status: 'CROSSED' } }), 'CROSSED')
  assert.equal(bridgeResultToReportOutcome({ status: 'EXECUTION_RECORDED_REPORT_PENDING', execution: { status: 'CROSSING_UNKNOWN' } }), 'CROSSING_UNKNOWN')
  assert.equal(bridgeResultToReportOutcome({ status: 'EXECUTION_RECORDED_REPORT_PENDING' }), 'UNRECOGNIZED')
  for (const odd of [null, undefined, 'CROSSED', 42]) assert.equal(bridgeResultToReportOutcome(odd), 'NO_RESPONSE')
  for (const odd of [{}, { status: 'SOMETHING_NEW' }, { admission: 'DURABLY_ACCEPTED' }]) assert.equal(bridgeResultToReportOutcome(odd), 'UNRECOGNIZED')
  // Outcomes that mean "the page never called the bridge" cannot come out of a bridge answer.
  for (const status of ['BRIDGE_UNAVAILABLE', 'RENDER_FAILED', 'SUBMIT_THREW', 'NO_RESPONSE']) {
    assert.equal(bridgeResultToReportOutcome({ status }), 'UNRECOGNIZED')
  }
})

test('kitchen awareness across a notice and its manual re-notifications', () => {
  assert.equal(kitchenAwareness([]), 'NEVER_TOLD')
  assert.equal(kitchenAwareness(['PENDING_SUBMIT']), 'NEVER_TOLD')
  assert.equal(kitchenAwareness(['WITHDRAWN', 'NOT_REQUIRED', 'NOT_NOTIFIED_SETTLED']), 'NEVER_TOLD')
  assert.equal(kitchenAwareness(['NOT_SENT']), 'NOT_SENT')
  assert.equal(kitchenAwareness(['NOT_SENT', 'NOT_SENT', 'PENDING_SUBMIT']), 'NOT_SENT')
  assert.equal(kitchenAwareness(['NOT_SENT', 'UNKNOWN']), 'UNKNOWN')
  assert.equal(kitchenAwareness(['UNKNOWN', 'SENT']), 'SENT')
  assert.equal(kitchenAwareness(['NOT_SENT', 'SENT']), 'SENT')
})

test('print identity fits the existing contract slot; notices expire in thirty minutes', () => {
  const orderNo = diningNoticePrintOrderNo('S-20261010-MAIN-0007', 3)
  assert.equal(orderNo, 'S-20261010-MAIN-0007.3')
  assert.equal(canonicalV3PrintEffectKey(orderNo, 'KITCHEN'), 'cashier-network-v2:S-20261010-MAIN-0007.3:KITCHEN')
  assert.notEqual(diningNoticePrintOrderNo('S-1', 12), diningNoticePrintOrderNo('S-11', 2))
  assert.equal(DINING_NOTICE_TTL_MS, 30 * 60 * 1000)
})

test('request key, digest, money and trial list helpers', () => {
  assert.equal(requireRequestKey('di-0123456789'), 'di-0123456789')
  for (const bad of ['short', '', ' di-0123456789', 'has space 123', 'x'.repeat(129), null, 12345678]) {
    assert.throws(() => requireRequestKey(bad), (error: unknown) => error instanceof DiningCommandError && error.code === 'REQUEST_KEY_REQUIRED' && error.status === 400)
  }
  assert.equal(requestDigest({ b: 2, a: [{ y: 1, x: 2 }], skip: undefined }), requestDigest({ a: [{ x: 2, y: 1 }], b: 2 }))
  assert.notEqual(requestDigest({ a: [1, 2] }), requestDigest({ a: [2, 1] }))
  assert.match(requestDigest({}), /^[0-9a-f]{64}$/)
  assert.equal(money('3.5'), '3.50')
  assert.equal(money(0), '0.00')
  assert.equal(parseMoney('8.20')!.toFixed(2), '8.20')
  for (const bad of [8.2, '8.200', '-1.00', '1e3', '', ' 8.20', '8,20', null]) assert.equal(parseMoney(bad), null)

  assert.equal(isDiningTrialStore('A', {}), false)
  assert.equal(isDiningTrialStore('A', { DINE_IN_TRIAL_STORE_CODES: '' }), false)
  assert.equal(isDiningTrialStore('A', { DINE_IN_TRIAL_STORE_CODES: ' B , A ,C' }), true)
  assert.equal(isDiningTrialStore('A', { DINE_IN_TRIAL_STORE_CODES: 'AA,BA' }), false)
  assert.equal(isDiningTrialStore('', { DINE_IN_TRIAL_STORE_CODES: ',,' }), false)
})

test('wording: three complete languages with matching placeholders', () => {
  const keys = Object.keys(DINING_TEXT.zh) as (keyof typeof DINING_TEXT.zh)[]
  for (const lang of ['zh', 'en', 'km'] as const) {
    assert.deepEqual(Object.keys(DINING_TEXT[lang]).sort(), [...keys].sort(), lang)
    for (const key of keys) {
      const value = DINING_TEXT[lang][key]
      assert.ok(typeof value === 'string' && value.trim().length > 0, `${lang}.${key}`)
      // Nothing shown to staff may assert that the kitchen has received, seen or confirmed a notice; the system only has
      // sending evidence. (Saying that this is NOT known, and asking a person to check, is allowed.)
      assert.doesNotMatch(value, /厨房已(确认|收到|知晓|接单)|已(确认)?送达厨房|确认送达|kitchen (has|have) (confirmed|received|acknowledged)|kitchen confirmed|(was|were|been) (delivered to|received by) the kitchen|ផ្ទះបាយបានបញ្ជាក់/i, `${lang}.${key}`)
      assert.deepEqual((value.match(/\{\w+\}/g) ?? []).sort(), (DINING_TEXT.zh[key].match(/\{\w+\}/g) ?? []).sort(), `${lang}.${key} placeholders`)
    }
  }
  // Khmer is Khmer and Chinese is Chinese for the phrases an operator must not misread.
  for (const key of ['entryNew', 'checkout', 'clearTable', 'kitchenConfirmLabel', 'renotifyDuplicateWarn', 'payUnknown', 'ticketVoid'] as const) {
    assert.match(DINING_TEXT.km[key], /[ក-៿]/, key)
    assert.match(DINING_TEXT.zh[key], /[一-鿿]/, key)
    assert.doesNotMatch(DINING_TEXT.en[key], /[ក-៿一-鿿]/, key)
  }
  assert.equal(diningText('fr'), DINING_TEXT.zh)
  assert.equal(fill('第 {n} 批 {missing}', { n: 3 }), '第 3 批 ')
  const statuses: DiningNoticeStatus[] = ['NOT_REQUIRED', 'PENDING_SUBMIT', 'WITHDRAWN', 'NOT_NOTIFIED_SETTLED', 'SENT', 'NOT_SENT', 'UNKNOWN']
  for (const lang of ['zh', 'en', 'km']) for (const status of statuses) assert.ok(noticeStatusText(lang, status).length > 0)
  // "Sent" never claims paper or that the kitchen knows.
  assert.match(noticeStatusText('zh', 'SENT'), /不代表/)
  assert.match(noticeStatusText('en', 'SENT'), /not guaranteed/)
  for (const lang of ['zh', 'en', 'km']) {
    assert.notEqual(diningErrorText(lang, 'BILL_CHANGED'), diningErrorText(lang, 'NO_SUCH_CODE'))
    assert.match(diningErrorText(lang, 'NO_SUCH_CODE'), /NO_SUCH_CODE/)
  }
  // Refusal wording exists for the same codes in every language …
  assert.deepEqual([...DINING_ERROR_CODES.en].sort(), [...DINING_ERROR_CODES.zh].sort())
  assert.deepEqual([...DINING_ERROR_CODES.km].sort(), [...DINING_ERROR_CODES.zh].sort())
  // … and for every refusal the server can send, except malformed-request codes the page cannot produce.
  const server = ['lib/dine-in/commands.ts', 'lib/dine-in/eligibility.ts', 'lib/dine-in/types.ts', 'lib/dine-in/http.ts', ...moduleFiles.filter((file) => file.endsWith('route.ts'))].map(read).join('\n')
  const thrown = [...new Set([...server.matchAll(/DiningCommandError\('([A-Z0-9_]+)'/g)].map((match) => match[1]))]
  assert.ok(thrown.length > 40)
  assert.deepEqual(thrown.filter((code) => !DINING_ERROR_CODES.zh.includes(code)).sort(), [
    'BATCH_TYPE_INVALID', 'EXPECTED_AMOUNT_REQUIRED', 'EXPECTED_VERSION_REQUIRED', 'INVALID_JSON', 'MISSING_STORE_CODE', 'NOTICE_NOT_CLAIMED',
    'NOTICE_OUTCOME_INVALID', 'ORDER_ITEMS_REQUIRED', 'PAYMENT_METHOD_INVALID', 'REQUEST_KEY_REQUIRED', 'SESSION_ACTION_INVALID',
    'TABLE_ACTIVE_INVALID', 'TABLE_AREA_INVALID', 'TABLE_SORT_INVALID', 'VOID_LINES_REQUIRED', 'VOID_LINE_INVALID',
  ])
})

test('kitchen ticket: table, batch, void and re-send marks are on the paper; content is escaped', () => {
  const content: DiningNoticeContent = {
    kind: 'ORDER', subject: 'ORDER', seq: 2, refSeq: null, billNo: 'S-20261010-MAIN-0007', tableName: 'A<3>', areaKind: 'HALL', guestCount: 4,
    createdAt: '2026-10-10T03:04:05.000Z', lines: [{ saleRecordId: 'r1', name: 'Rice & "egg"', spec: 'large', quantity: 2 }],
  }
  const order = renderDiningKitchenNoticeHtml(content, 'Store <b>', 'zh')
  assert.match(order, /厨房单 · 堂食/)
  assert.match(order, /A&lt;3&gt;/)
  assert.match(order, /Rice &amp; &quot;egg&quot;/)
  assert.match(order, /Store &lt;b&gt;/)
  assert.match(order, /第 2 批/)
  assert.match(order, /S-20261010-MAIN-0007/)
  assert.doesNotMatch(order, /<b>|A<3>|不做|补发/)
  // A kitchen notice shows no money at all.
  assert.doesNotMatch(order, /\$|price|amount|金额|单价/i)

  const voided = renderDiningKitchenNoticeHtml({ ...content, kind: 'VOID', subject: 'VOID', seq: 3 }, 'S', 'en')
  assert.match(voided, /VOID NOTICE/)
  assert.match(voided, /DO NOT MAKE/)
  const resent = renderDiningKitchenNoticeHtml({ ...content, kind: 'RENOTIFY', subject: 'ORDER', seq: 5, refSeq: 2 }, 'S', 'km')
  assert.match(resent, /ផ្ញើឡើងវិញ · នៃលើកទី 2/)
  assert.match(resent, /លើកទី 5/)
  assert.deepEqual(diningNoticeHeading({ kind: 'RENOTIFY', subject: 'VOID', seq: 6, refSeq: 3 }, 'zh'), { title: '退菜通知', resent: '补发 · 原第 3 批' })
  assert.deepEqual(diningNoticeHeading({ kind: 'ORDER', subject: 'ORDER', seq: 1, refSeq: null }, 'en'), { title: 'Kitchen · Dine-in', resent: null })
})

test('boundary: the module reads print evidence but never produces, changes or re-submits print work', () => {
  const forbidden: [RegExp, string][] = [
    [/v3-print-job-adapter|v3-print-reprint|v3-print-control-plane|es-tray-relay|cashier-network-producer|networkContract|customer-order-/, 'imports a print producer, adapter or H5 fulfilment module'],
    [/enqueueV3PrintIntent|enqueueHeldV3PrintIntent|reportV3Execution|enqueueCashierNetworkJobs|cancelPendingV3PrintIntent/, 'calls a print queue function'],
    [/eshopTrayPrintJob\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/, 'writes the print job table'],
    [/v3PrintControlPlane\s*\.\s*(create|update|updateMany|upsert|delete)\b/, 'writes the print control plane'],
    [/window\.(confirm|alert|prompt)\(|\balert\(/, 'opens a native dialog'],
    [/readOperatorRecoveryProof|eshopTray\b/, 'uses the operator reprint path'],
  ]
  for (const [file, source] of moduleSource) {
    for (const [pattern, why] of forbidden) assert.doesNotMatch(source, pattern, `${file} ${why}`)
  }
  // The only reads of the print tables.
  const reads = [...moduleSource].filter(([, source]) => /eshopTrayPrintJob|v3PrintControlPlane/.test(source)).map(([file]) => file).sort()
  assert.deepEqual(reads, ['lib/dine-in/commands.ts', 'lib/dine-in/eligibility.ts'])
  assert.match(moduleSource.get('lib/dine-in/commands.ts')!, /eshopTrayPrintJob\.findMany\(/)
  assert.match(moduleSource.get('lib/dine-in/eligibility.ts')!, /v3PrintControlPlane\.findUnique\(/)

  // Exactly two bridge call sites in the whole module: one kitchen notice, one payment receipt.
  const bridgeCalls = [...moduleSource].flatMap(([file, source]) => [...source.matchAll(/bridge\.submit\(/g)].map(() => file))
  assert.deepEqual(bridgeCalls, ['app/desktop/dine-in/page.tsx', 'app/desktop/dine-in/page.tsx'])
  const page = moduleSource.get('app/desktop/dine-in/page.tsx')!
  assert.equal([...page.matchAll(/role: 'KITCHEN',/g)].length, 1)
  assert.equal([...page.matchAll(/role: 'FRONT',/g)].length, 1)
  // The kitchen submit sits after the claim and nowhere inside a loop or retry.
  const submitNotice = page.slice(page.indexOf('const submitNotice = useCallback'), page.indexOf('const submitNoticeIfPending'))
  assert.ok(submitNotice.indexOf('/claim') > 0 && submitNotice.indexOf('/claim') < submitNotice.indexOf('bridge.submit('))
  assert.ok(submitNotice.indexOf('bridge.submit(') < submitNotice.indexOf('for (let attempt'))
  assert.equal([...submitNotice.matchAll(/bridge\.submit\(/g)].length, 1)
  // Without a bridge nothing is claimed: the notice stays with the server for a real Desktop window.
  assert.ok(submitNotice.indexOf('if (!printBridge())') > 0 && submitNotice.indexOf('if (!printBridge())') < submitNotice.indexOf('/claim'))
  // Request keys: one per intent. The order key survives refusals and lost responses and is renewed only by editing or discarding the cart.
  assert.deepEqual([...page.matchAll(/cartKey\.current = null/g)].length, 2)
  assert.match(page, /cartKey\.current \?\?= newKey\(\)/)
  assert.equal([...page.matchAll(/key: newKey\(\)/g)].length, 6)
  // After an unknown payment result the dialog offers no way to start a different collection.
  const payDialog = page.slice(page.indexOf("{dialog?.kind === 'pay' && ("), page.indexOf("{dialog?.kind === 'end' && ("))
  const unknownBranch = payDialog.slice(payDialog.indexOf("dialog.phase === 'unknown' ? ("), payDialog.indexOf(') : (\n              <>\n                <div style={s.dWarn}>{t.payResend}'))
  assert.ok(unknownBranch.length > 100)
  assert.doesNotMatch(unknownBranch, /setDialog\(null\)|newKey\(/)
})

test('boundary: every handler is gated; new-business conditions apply after the request-key lookup; owner-only actions say so', () => {
  const routes = moduleFiles.filter((file) => file.endsWith('route.ts'))
  assert.equal(routes.length, 10)
  for (const file of routes) {
    const source = moduleSource.get(file)!
    // Split the file into its handlers and require a gate in each one, before any command is called.
    const handlers = source.split(/(?=export async function (?:GET|POST)\b)/).filter((part) => /^export async function (GET|POST)\b/.test(part))
    assert.ok(handlers.length >= 1, file)
    for (const handler of handlers) {
      const gate = /await (requireNewBusinessGate|requireRecoveryGate|authorizeDiningOperator)\(req, store\)/.exec(handler)
      assert.ok(gate, `${file}: handler without a gate`)
      assert.ok(handler.indexOf('loadDiningStore(storeCodeFrom(req))') >= 0 && handler.indexOf('loadDiningStore(storeCodeFrom(req))') < gate.index, file)
      const firstCommand = /\b(openMeal|addOrderBatch|voidLines|renotifyBatch|claimNotice|reportNotice|settleMeal|clearMeal|voidMeal|saveTable|listTables|getMealView|hasActiveMeals)\(prisma/.exec(handler)
      assert.ok(firstCommand && firstCommand.index > gate.index, `${file}: command before gate`)
    }
  }
  // Opening and ordering: authorise, then let the command replay by key, then apply the conditions.
  const commands = moduleSource.get('lib/dine-in/commands.ts')!
  for (const file of ['app/api/dine-in/sessions/route.ts', 'app/api/dine-in/sessions/[id]/batches/route.ts']) {
    assert.match(moduleSource.get(file)!, /newBusinessBlockers: await newBusinessBlockers\(req, store\)/, file)
  }
  const openBody = commands.slice(commands.indexOf('export async function openMeal'), commands.indexOf('// ── Order batch'))
  assert.ok(openBody.indexOf('const earlier = await replay(tx)') < openBody.indexOf('requireNewBusiness(input.newBusinessBlockers)'))
  assert.ok(openBody.indexOf('requireNewBusiness(input.newBusinessBlockers)') < openBody.indexOf('diningMeal.create('))
  const orderBody = commands.slice(commands.indexOf('export async function addOrderBatch'), commands.indexOf('// ── Void lines'))
  assert.ok(orderBody.indexOf("replayBatch(tx, meal, 'ORDER'") < orderBody.indexOf('requireNewBusiness(input.newBusinessBlockers)'))
  assert.ok(orderBody.indexOf('requireNewBusiness(input.newBusinessBlockers)') < orderBody.indexOf('diningBatch.create('))
  assert.match(moduleSource.get('app/api/dine-in/tables/route.ts')!, /await requireNewBusinessGate\(req, store\)\s+requireOwner\(authorization\)/)
  // Everything else is recovery only.
  for (const file of ['settle', 'close', 'kitchen/claim', 'kitchen/report', 'batches/[batchId]/renotify']) {
    const source = moduleSource.get(`app/api/dine-in/sessions/[id]/${file}/route.ts`)!
    assert.doesNotMatch(source, /NewBusiness|newBusinessBlockers/, file)
  }
  // Owner-only actions are refused both at the route and inside the command.
  assert.match(moduleSource.get('app/api/dine-in/sessions/[id]/route.ts')!, /requireOwner\(authorization\)[\s\S]*voidMeal\(/)
  assert.match(moduleSource.get('app/api/dine-in/sessions/[id]/batches/route.ts')!, /requireOwner\(authorization\)[\s\S]*voidLines\(/)
  for (const name of ['voidLines', 'voidMeal', 'saveTable']) {
    const body = commands.slice(commands.indexOf(`export async function ${name}`))
    assert.ok(body.indexOf("if (actor.role !== 'OWNER') throw new DiningCommandError('OWNER_REQUIRED', 403)") < 900, name)
  }
  const eligibility = moduleSource.get('lib/dine-in/eligibility.ts')!
  assert.match(eligibility, /allowStoreCodeFallback: false/)
  const recovery = eligibility.slice(eligibility.indexOf('export async function requireRecoveryGate'), eligibility.indexOf('export function requireOwner'))
  assert.doesNotMatch(recovery, /businessType|isDiningTrialStore|v3PrintControlPlane|isDesktopPosRequest|newBusinessBlockers/)
  assert.match(recovery, /store\.status !== 'ACTIVE'/)
})

test('boundary: the new tables store no money, the migration only adds, the legacy entries are guarded', () => {
  const schema = read('prisma/schema.prisma')
  const model = (name: string) => schema.slice(schema.indexOf(`model ${name} {`), schema.indexOf('\n}\n', schema.indexOf(`model ${name} {`)))
  for (const name of ['DiningTable', 'DiningMeal', 'DiningBatch', 'DiningVoidLine']) {
    const body = model(name)
    assert.ok(body.length > 50, name)
    const fields = body.split('\n').map((line) => /^\s{2}(\w+)\s+(\w+)/.exec(line)).filter((match): match is RegExpExecArray => Boolean(match))
    for (const [, field, type] of fields) {
      assert.doesNotMatch(field, /amount|price|total|subtotal|paidAt|paidAmount|received|change/i, `${name}.${field}`)
      if (type === 'Decimal' || type === 'Float') assert.equal(`${name}.${field}`, 'DiningVoidLine.quantity')
    }
  }
  assert.match(schema, /diningBatch\s+DiningBatch\?\s+@relation\(fields: \[diningBatchId, tenantId, storeId\], references: \[id, tenantId, storeId\], onDelete: Restrict\)/)

  const migration = read('prisma/migrations/20261010_es_dine_in_01/migration.sql')
  const sql = migration.replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /ON DELETE (?!RESTRICT)|ON UPDATE (?!CASCADE)/)
  assert.doesNotMatch(sql.replace(/ON DELETE RESTRICT ON UPDATE CASCADE/g, ''), /\bDROP\b|\bRENAME\b|ALTER COLUMN|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b|ALTER TYPE|\bINSERT\b/i)
  const altered = [...sql.matchAll(/ALTER TABLE "(\w+)" (ADD COLUMN|ADD CONSTRAINT)/g)].map((match) => `${match[1]} ${match[2]}`)
  assert.deepEqual(altered.filter((entry) => !entry.startsWith('Dining')), ['SaleRecord ADD COLUMN', 'SaleRecord ADD CONSTRAINT'])
  assert.match(sql, /ALTER TABLE "SaleRecord" ADD COLUMN "diningBatchId" TEXT;/)
  const touched = [...new Set([...sql.matchAll(/(?:CREATE (?:UNIQUE )?INDEX "\w+"\s+ON|CREATE TABLE|ALTER TABLE) "(\w+)"/g)].map((match) => match[1]))].sort()
  assert.deepEqual(touched, ['DiningBatch', 'DiningMeal', 'DiningTable', 'DiningVoidLine', 'SaleRecord'])
  assert.match(sql, /CREATE UNIQUE INDEX "DiningMeal_one_active_per_table"\s+ON "DiningMeal"\("tableId"\)\s+WHERE "state" IN \('OPEN', 'PAID'\);/)
  assert.match(sql, /FOREIGN KEY \("diningBatchId", "tenantId", "storeId"\) REFERENCES "DiningBatch"\("id", "tenantId", "storeId"\) ON DELETE RESTRICT/)
  assert.match(sql, /FOREIGN KEY \("tableId", "tenantId", "storeId"\) REFERENCES "DiningTable"\("id", "tenantId", "storeId"\) ON DELETE RESTRICT/)
  assert.match(sql, /CREATE UNIQUE INDEX "DiningVoidLine_saleRecordId_key"/)
  assert.equal([...sql.matchAll(/REFERENCES "(\w+)"/g)].filter((match) => !['Store', 'DiningTable', 'DiningMeal', 'DiningBatch', 'SaleRecord', 'PaymentIntent'].includes(match[1])).length, 0)

  // The two legacy write entries that could reach a dining bill refuse it before touching anything.
  const checkout = read('app/api/orders/[orderNo]/checkout/route.ts')
  const cancel = read('app/api/orders/[orderNo]/cancel/route.ts')
  assert.ok(checkout.indexOf('DINING_CHECKOUT_REQUIRED') > 0 && checkout.indexOf('DINING_CHECKOUT_REQUIRED') < checkout.indexOf('paymentIntent.findFirst'))
  assert.ok(checkout.indexOf('DINING_CHECKOUT_REQUIRED') < checkout.indexOf('$transaction'))
  assert.ok(cancel.indexOf('DINING_VOID_REQUIRED') > 0 && cancel.indexOf('DINING_VOID_REQUIRED') < cancel.indexOf('updateMany'))
  assert.match(cancel, /select: \{[^}]*diningBatchId: true/)

  // Dine-in rows are identified by diningBatchId alone; no new SaleRecord.source value, no pending payment rows.
  const commands = moduleSource.get('lib/dine-in/commands.ts')!
  assert.doesNotMatch(commands, /source:\s*'/)
  assert.doesNotMatch(commands, /status: 'PENDING'[,\s]/)
  assert.equal([...commands.matchAll(/paymentIntent\.create\(/g)].length, 1)
  assert.match(commands, /paymentIntent\.create\(\{\s*data: \{[\s\S]*?status: 'PAID'/)
})

test('payment and kitchen: no notice gates money; after the meal ends only a void notice is deliverable; re-sending is one manual entry', () => {
  // The one rule that decides whether an untaken notice may still be handed out.
  assert.deepEqual(
    [diningNoticeDeliverable(true, 'ORDER'), diningNoticeDeliverable(true, 'VOID'), diningNoticeDeliverable(false, 'ORDER'), diningNoticeDeliverable(false, 'VOID')],
    [true, true, false, true],
  )
  const derive = (deliverable: boolean) => deriveDiningNoticeStatus({ required: true, claimed: false, withdrawn: false, reportedOutcome: null, deliverable, stale: false, evidence: null })
  assert.deepEqual([derive(true), derive(false)], ['PENDING_SUBMIT', 'NOT_NOTIFIED_SETTLED'])

  // The confirmation that used to stand between a cashier and a payment is gone everywhere, not merely unused.
  for (const [file, source] of moduleSource) {
    assert.doesNotMatch(source, /acceptedNoticeSeqs|PENDING_KITCHEN_NOTICES|pendingNoticesAck|coversAll/, file)
  }
  const commands = moduleSource.get('lib/dine-in/commands.ts')!
  const settle = commands.slice(commands.indexOf('export async function settleMeal('), commands.indexOf('// ── End of a meal'))
  const refusals = [...settle.matchAll(/new DiningCommandError\('(\w+)'/g)].map((match) => match[1])
  assert.deepEqual([...new Set(refusals)].sort(), ['BILL_CHANGED', 'EXPECTED_AMOUNT_REQUIRED', 'EXPECTED_VERSION_REQUIRED', 'EXTERNAL_PAYMENT_EXISTS', 'KHQR_UNSUPPORTED_CURRENCY', 'MANUAL_PAYMENT_CONFIRMATION_REQUIRED', 'MEAL_NOT_OPEN', 'NOTHING_TO_SETTLE', 'PAYMENT_METHOD_INVALID', 'REQUEST_KEY_REUSED'])
  assert.doesNotMatch(settle, /noticeLines|unsentNoticeSeqs|kitchenAwareness|graph\.status/)
  // The settle digest names every input the outcome depends on.
  assert.match(settle, /requestDigest\(\{ paymentMethod, expectedAmount: money\(expectedAmount\), expectedVersion, manualPaymentConfirmed \}\)/)
  assert.match(commands, /requestDigest\(\{ lines: targets, reason: why, kitchenConfirmed \}\)/)
  assert.match(commands, /requestDigest\(\{ refBatchId: input\.refBatchId, reason: why, duplicateRiskAccepted \}\)/)

  // Voiding a meal looks at payment facts before it looks at anything else about the bill.
  const end = commands.slice(commands.indexOf('async function endMeal('))
  assert.ok(end.indexOf("'PAYMENT_FACT_EXISTS'") > 0 && end.indexOf("'PAYMENT_FACT_EXISTS'") < end.indexOf("'MEAL_HAS_UNPAID_LINES'"))
  assert.ok(end.indexOf("'PAYMENT_FACT_EXISTS'") < end.indexOf('tx.diningMeal.update('))
  for (const lang of ['zh', 'en', 'km'] as const) assert.ok(DINING_ERROR_CODES[lang].includes('PAYMENT_FACT_EXISTS'), lang)
  // No command of this module adopts, creates or changes a payment for someone else's payment row.
  assert.equal([...commands.matchAll(/paymentIntent\.(update|updateMany|upsert|delete|deleteMany)\(/g)].length, 0)

  // A re-notification batch is created in exactly one place, by one command, reached from one page action.
  assert.equal([...commands.matchAll(/kind: 'RENOTIFY',/g)].length, 1)
  const renotify = commands.slice(commands.indexOf('export async function renotifyBatch('), commands.indexOf('// ── Kitchen notice: claim once'))
  assert.match(renotify, /kind: 'RENOTIFY',/)
  assert.match(renotify, /ref\.kind === 'RENOTIFY' \|\| !ref\.noticeRequired\) throw new DiningCommandError\('RENOTIFY_TARGET_INVALID'/)
  assert.match(renotify, /!diningNoticeDeliverable\(meal\.state === 'OPEN', ref\.kind === 'VOID' \? 'VOID' : 'ORDER'\)/)
  assert.equal([...commands.matchAll(/renotifyBatch\(/g)].length, 1)
  const page = moduleSource.get('app/desktop/dine-in/page.tsx')!
  assert.equal([...page.matchAll(/\/renotify`/g)].length, 1)
  assert.ok(page.indexOf('/renotify`') > page.indexOf('const submitRenotify = useCallback(') && page.indexOf('/renotify`') < page.indexOf('const submitPay = useCallback('))
  assert.equal([...page.matchAll(/submitRenotify\(/g)].length, 2) // the dialog's confirm button and its "send the same request again"
  // The pay and end dialogs show information; no checkbox, no disabled state depends on kitchen notices.
  const payDialog = page.slice(page.indexOf("{dialog?.kind === 'pay' && ("), page.indexOf("{dialog?.kind === 'discard'"))
  assert.doesNotMatch(payDialog, /type="checkbox"|pendingNoticeSeqs\.length|accepted/)
  // The confirm buttons depend on the request being in flight and on nothing else.
  assert.match(payDialog, /disabled=\{dialog\.phase !== 'idle'\} onClick=\{\(\) => \{ void submitPay\(dialog\) \}\}/)
  assert.match(payDialog, /disabled=\{busyDialog\} onClick=\{\(\) => \{ void submitEnd\(dialog\) \}\}/)
  const submitPay = page.slice(page.indexOf('const submitPay = useCallback('), page.indexOf('const recheckPay = useCallback('))
  const submitEnd = page.slice(page.indexOf('const submitEnd = useCallback('), page.indexOf('const saveTable = useCallback('))
  for (const body of [submitPay, submitEnd]) {
    // What the kitchen has not been told is read only from the server's answer, after the command has been applied.
    assert.doesNotMatch(body, /pendingNoticeSeqs|noSendEvidence\b|noticeLocks|submittingNotices/)
    assert.ok(body.indexOf('await api<') < body.search(/kitchenWarnings|noSendEvidenceVoidSeqs/))
  }

  // kitchenLineIds: NOT NULL in SQL, an empty-list default in both places.
  const migration = read('prisma/migrations/20261010_es_dine_in_01/migration.sql')
  assert.match(migration, /"kitchenLineIds" TEXT\[\] NOT NULL DEFAULT ARRAY\[\]::TEXT\[\],/)
  assert.match(read('prisma/schema.prisma'), /kitchenLineIds\s+String\[\]\s+@default\(\[\]\)/)
  // Some migration runners split a script on every semicolon; none may sit inside a comment or mid-line.
  assert.deepEqual(migration.split('\n').filter((line) => line.includes(';') && (line.trimStart().startsWith('--') || !line.trimEnd().endsWith(';'))), [])
})

test('r4: line voids stop under a live external payment; "sent" has one source; the recovery list is paged and has no time window', () => {
  const commands = moduleSource.get('lib/dine-in/commands.ts')!
  // Void lines: decided under the meal lock, after the request-key replay, before any row is read or written.
  const voidLines = commands.slice(commands.indexOf('export async function voidLines('), commands.indexOf('// ── Manual re-notification'))
  const guard = voidLines.indexOf("foreign.status === 'PAID' || foreign.status === 'PENDING'")
  assert.ok(guard > voidLines.indexOf('await lockMeal(') && guard > voidLines.indexOf("await replayBatch(tx, meal, 'VOID'"))
  for (const later of ['tx.saleRecord.findMany(', 'tx.diningBatch.create(', 'tx.diningVoidLine.createMany(', 'tx.saleRecord.updateMany(']) assert.ok(guard < voidLines.indexOf(later), later)
  assert.doesNotMatch(voidLines, /CANCELLED'.*EXTERNAL_PAYMENT_EXISTS|FAILED'.*EXTERNAL_PAYMENT_EXISTS|EXPIRED'/)

  // SENT is returned in exactly one place, and that place is the print job row saying "printed".
  const notice = moduleSource.get('lib/dine-in/kitchen-notice.ts')!
  const derive = notice.slice(notice.indexOf('export function deriveDiningNoticeStatus('), notice.indexOf('export type DiningKitchenAwareness'))
  assert.deepEqual([...derive.matchAll(/return 'SENT'/g)].length, 1)
  assert.match(derive, /if \(input\.evidence === 'PRINTED'\) return 'SENT'/)
  assert.doesNotMatch(derive, /reportedSent\) return 'SENT'/)
  // The module still only reads print jobs, and nothing turns "unknown" into a re-notification by itself.
  assert.equal([...commands.matchAll(/eshopTrayPrintJob\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/g)].length, 0)
  assert.doesNotMatch(commands, /(INSERT INTO|UPDATE|DELETE FROM)\s+"EshopTrayPrintJob"/i)
  assert.equal([...commands.matchAll(/kind: 'RENOTIFY',/g)].length, 1)

  // Recovery list: no time window and no fixed cut; a bounded page, a cursor, and a separate existence check.
  const recover = commands.slice(commands.indexOf('const RECOVERABLE_PAGE_DEFAULT'), commands.indexOf('function tableName('))
  assert.doesNotMatch(commands, /RECOVERABLE_WINDOW|RECOVERABLE_SCAN_LIMIT/)
  assert.doesNotMatch(recover, /endedAt: \{ gte|"endedAt" >|Date\.now\(\)/)
  assert.match(recover, /const RECOVERABLE_PAGE_MAX = 50\b/)
  assert.match(recover, /Math\.min\(input\.limit, RECOVERABLE_PAGE_MAX\)/)
  assert.match(recover, /LIMIT \$\{limit \+ 1\}/)
  assert.match(recover, /ORDER BY m\."endedAt" DESC, m\."id" DESC/)
  assert.match(recover, /\(m\."endedAt", m\."id"\) < \(/)
  assert.match(recover, /nextCursor: hasMore && last \? encodeRecoverCursor\(/)
  // The cursor comes from the database's own rows, in the database's own rendering of the instant.
  assert.match(recover, /const last = pageRows\.at\(-1\)/)
  assert.match(recover, /to_char\(m\."endedAt", 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"'\) AS "endedAt"/)
  // If the entrance question cannot be answered, the entrance stays open.
  assert.match(recover, /hasRecoverableMeals\(db, scope\)\.catch\(\(error\) => \{ console\.error\('\[dine-in\] recovery check unavailable', error\); return true \}\)/)
  const exists = recover.slice(recover.indexOf('export async function hasRecoverableMeals('), recover.indexOf('export async function hasActiveMeals('))
  assert.match(exists, /SELECT EXISTS \(SELECT 1 FROM "DiningMeal" m WHERE \$\{recoverableMealCondition\(scope\)\}\)/)
  assert.doesNotMatch(exists, /listRecoverableMeals|LIMIT|cursor/)
  // The SQL selects with the trusted "printed" shape only, on the canonical job key, for notices a page actually took.
  const condition = recover.slice(recover.indexOf('function recoverableMealCondition('), recover.indexOf('function encodeRecoverCursor('))
  for (const piece of [`'network:' || encode(sha256(convert_to('cashier-network-v2:' || m."billNo" || '.' || c."seq" || ':KITCHEN', 'UTF8')), 'hex')`, 'j."schemaVersion" = 3', `j."status" = 'SUCCEEDED'`, `j."resultStatus" = 'CROSSED'`, `j."effectBoundary" = 'CROSSED'`, 'j."completedAt" IS NOT NULL', `j."resultCode" <> ''`, 'c."noticeClaimedAt" IS NOT NULL', 'j."tenantId" = m."tenantId"', 'j."storeId" = m."storeId"']) {
    assert.ok(condition.includes(piece), piece)
  }
  assert.doesNotMatch(condition, /noticeReportedOutcome/)

  // A stale identity is not handed out: the claim goes by the derived status, which is never "pending" for a stale notice.
  const claim = commands.slice(commands.indexOf('export async function claimNotice('), commands.indexOf('export async function reportNotice('))
  assert.match(claim, /if \(status !== 'PENDING_SUBMIT'\) return \{ claimed: false as const/)
  assert.match(commands, /stale: diningNoticeStale\(batch\.createdAt, now\)/)
  // …decided with the database's clock, and the identity's execution window ends with the batch's own window.
  assert.match(commands, /const now = at \?\? await databaseNow\(tx\)/)
  assert.match(claim, /expiresAt: new Date\(batch\.createdAt\.getTime\(\) \+ DINING_NOTICE_TTL_MS\)\.toISOString\(\)/)
  // A line void looks for a live external payment twice: before anything is read, and again after the rows are cancelled.
  assert.equal([...voidLines.matchAll(/\.status === 'PAID' \|\| \w+\.status === 'PENDING'/g)].length, 2)
  assert.ok(voidLines.lastIndexOf("appeared.status === 'PAID'") > voidLines.indexOf('tx.saleRecord.updateMany('))

  // The page: more of the list on request, re-read from the top on every refresh; no line void under a live external payment.
  const page = moduleSource.get('app/desktop/dine-in/page.tsx')!
  assert.match(page, /onLoadMoreRecoverable=\{\(\) => \{ if \(storeCode\) void refreshTables\(storeCode, 1\) \}\}/)
  assert.match(page, /const wanted = recoverPages\.current \+ morePages/)
  // One refresh at a time, so a long list is neither starved by the timer nor fetched twice over.
  assert.match(page, /if \(tablesBusy\.current !== 'idle'\) \{ if \(morePages === 0\) tablesBusy\.current = 'again'; return \}/)
  assert.match(page, /&recoverCursor=\$\{encodeURIComponent\(page\.nextCursor\)\}/)
  const overview = moduleSource.get('app/desktop/dine-in/components/DiningTableOverview.tsx')!
  assert.match(overview, /\{recoverableHasMore && \(/)
  const bill = moduleSource.get('app/desktop/dine-in/components/DiningMealBill.tsx')!
  assert.match(bill, /disabled=\{!isOwner \|\| !online \|\| liveExternal\} title=\{isOwner \? undefined : t\.ownerOnly\} onClick=\{\(\) => props\.onVoidLine\(line\)\}/)
})

test('cashier entry: one button, one read-only question, nothing else', () => {
  const cashier = read('app/cashier/page.tsx')
  assert.equal([...cashier.matchAll(/\/api\/dine-in\//g)].length, 1)
  assert.match(cashier, /fetch\(`\/api\/dine-in\/eligibility\?storeCode=/)
  assert.equal([...cashier.matchAll(/\/desktop\/dine-in\?from=desktop&storeCode=/g)].length, 1)
  assert.equal([...cashier.matchAll(/@\/lib\/dine-in\//g)].length, 1)
  assert.match(cashier, /import \{ diningText \} from '@\/lib\/dine-in\/i18n'/)
  const button = cashier.slice(cashier.indexOf('{isDesktopPos && dineInEntry !== null'), cashier.indexOf('{isFullscreen ? d.exitFullscreen'))
  assert.ok(button.length > 0 && button.length < 900)
  // Leaving is blocked, not confirmed away, while a sale is in progress.
  assert.match(button, /cart\.length > 0 \|\| submitting \|\| checkoutStep !== 'SELECT_ITEMS'/)
  assert.match(button, /showToast\(diningText\(lang\)\.entryLeaveBlocked\)\s*return/)
  assert.doesNotMatch(button, /confirm\(/)
  assert.match(button, /dineInEntry === 'NEW' \? diningText\(lang\)\.entryNew : diningText\(lang\)\.entryRecovery/)
})

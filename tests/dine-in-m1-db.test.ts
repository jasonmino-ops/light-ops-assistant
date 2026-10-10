/**
 * ES-DINE-IN-01 M1 — database behaviour.
 *
 * Real PostgreSQL, real Prisma, real route handlers, independent connections for
 * every concurrent actor. Nothing is simulated except the caller's identity
 * headers. No database is created, reset or dropped here, and there is no
 * DATABASE_URL fallback: the operator supplies a dedicated disposable loopback
 * database that already carries the candidate migration.
 */
import assert from 'node:assert/strict'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import test, { after } from 'node:test'
import pg from 'pg'
import { Prisma, PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  addOrderBatch,
  claimNotice,
  clearMeal,
  getMealView,
  hasActiveMeals,
  listRecoverableMeals,
  listTables,
  openMeal,
  renotifyBatch,
  reportNotice,
  saveTable,
  settleMeal,
  voidLines,
  voidMeal,
  type DiningMealView,
} from '../lib/dine-in/commands'
import { DiningCommandError, type DiningActor, type DiningScope } from '../lib/dine-in/types'
import { diningNoticePrintOrderNo } from '../lib/dine-in/kitchen-notice'
import { canonicalV3OriginalPrintJobId } from '../lib/v3-print-operator-status'

const databaseUrl = process.env.ES_DINE_IN_TEST_DATABASE_URL ?? ''
function disposableUrlError(raw: string): string | null {
  try {
    const url = new URL(raw)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return 'PostgreSQL URL required'
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return 'loopback only'
    if (!/^dine_in_test_[a-z0-9_]+$/.test(url.pathname.slice(1))) return 'database must be named dine_in_test_*'
    if ([...url.searchParams.keys()].some((key) => !['sslmode', 'application_name'].includes(key))) return 'connection override parameters are forbidden'
    return null
  } catch { return 'explicit disposable PostgreSQL URL required' }
}
const skip = process.env.ES_DINE_IN_TEST_DATABASE !== '1'
  ? 'NOT RUN: set ES_DINE_IN_TEST_DATABASE=1 and ES_DINE_IN_TEST_DATABASE_URL'
  : process.env.ES_DINE_IN_TEST_DISPOSABLE !== '1'
    ? 'NOT RUN: ES_DINE_IN_TEST_DISPOSABLE=1 acknowledgment required'
    : process.env.VERCEL_ENV
      ? 'NOT RUN: refuses to run inside a Vercel environment'
      : disposableUrlError(databaseUrl) || false

// Evidence runs set ES_DINE_IN_TEST_REQUIRED=1: a missing or rejected database is then a failure, never a quiet skip.
test('database availability: a required run cannot pass by skipping', () => {
  if (process.env.ES_DINE_IN_TEST_REQUIRED === '1') assert.equal(skip, false, String(skip))
})

// The route handlers use the shared client from lib/prisma, which reads DATABASE_URL.
if (!skip) process.env.DATABASE_URL = databaseUrl

const pools: pg.Pool[] = []
const clients: PrismaClient[] = []
function client(): PrismaClient {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 })
  pools.push(pool)
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: [] })
  clients.push(prisma)
  return prisma
}
let adminClient: PrismaClient | undefined
const admin = () => (adminClient ??= client())
const workerPool: PrismaClient[] = []
const worker = (index: number) => (workerPool[index] ??= client())

after(async () => {
  await Promise.all(clients.map((prisma) => prisma.$disconnect().catch(() => {})))
  await Promise.all(pools.map((pool) => pool.end().catch(() => {})))
  const shared = (globalThis as { _prisma?: PrismaClient })._prisma
  await shared?.$disconnect().catch(() => {})
})

const key = () => `k-${randomUUID()}`

type StoreFx = { id: string; code: string; scope: DiningScope; store: { code: string; printKitchenTicket: boolean; currencyCode: string } }
type Fixture = {
  tenantId: string
  a: StoreFx
  b: StoreFx
  owner: DiningActor
  staff: DiningActor
  food: { barcode: string; price: string }
  drink: { barcode: string; price: string }
  tableId: string
  table2Id: string
  other: { tenantId: string; store: StoreFx; owner: DiningActor }
}

async function makeStore(db: PrismaClient, tenantId: string, tag: string, suffix: string): Promise<StoreFx> {
  const code = `DI${tag}${suffix}`
  const store = await db.store.create({ data: { tenantId, code, name: `${code} store`, businessType: 'FOOD', printKitchenTicket: true } })
  await db.v3PrintControlPlane.create({ data: { tenantId, storeId: store.id, mode: 'V3_ACTIVE' } })
  return { id: store.id, code, scope: { tenantId, storeId: store.id }, store: { code, printKitchenTicket: true, currencyCode: 'USD' } }
}

async function fixture(): Promise<Fixture> {
  const db = admin()
  const tag = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()
  const tenant = await db.tenant.create({ data: { name: `dine-in ${tag}` } })
  const a = await makeStore(db, tenant.id, tag, 'A')
  const b = await makeStore(db, tenant.id, tag, 'B')
  const owner = await db.user.create({ data: { tenantId: tenant.id, username: `owner-${tag}`, displayName: 'Owner', role: 'OWNER' } })
  const staff = await db.user.create({ data: { tenantId: tenant.id, username: `staff-${tag}`, displayName: 'Staff', role: 'STAFF' } })
  for (const store of [a, b]) {
    await db.userStoreRole.create({ data: { tenantId: tenant.id, userId: owner.id, storeId: store.id, role: 'OWNER' } })
  }
  await db.userStoreRole.create({ data: { tenantId: tenant.id, userId: staff.id, storeId: a.id, role: 'STAFF' } })
  await db.product.create({ data: { tenantId: tenant.id, barcode: `F${tag}`, name: 'Fried rice', spec: 'large', sellPrice: '3.50', printKitchenTicket: true } })
  await db.product.create({ data: { tenantId: tenant.id, barcode: `G${tag}`, name: 'Noodle soup', sellPrice: '4.25', printKitchenTicket: true } })
  await db.product.create({ data: { tenantId: tenant.id, barcode: `D${tag}`, name: 'Cola', sellPrice: '1.20', printKitchenTicket: false } })
  const table = await db.diningTable.create({ data: { ...a.scope, name: 'T1' } })
  const table2 = await db.diningTable.create({ data: { ...a.scope, name: 'T2', areaKind: 'ROOM' } })

  const otherTenant = await db.tenant.create({ data: { name: `dine-in other ${tag}` } })
  const otherStore = await makeStore(db, otherTenant.id, tag, 'X')
  const otherOwner = await db.user.create({ data: { tenantId: otherTenant.id, username: `owner-${tag}`, displayName: 'Other owner', role: 'OWNER' } })
  await db.userStoreRole.create({ data: { tenantId: otherTenant.id, userId: otherOwner.id, storeId: otherStore.id, role: 'OWNER' } })
  return {
    tenantId: tenant.id, a, b,
    owner: { userId: owner.id, role: 'OWNER' },
    staff: { userId: staff.id, role: 'STAFF' },
    food: { barcode: `F${tag}`, price: '3.50' },
    drink: { barcode: `D${tag}`, price: '1.20' },
    tableId: table.id, table2Id: table2.id,
    other: { tenantId: otherTenant.id, store: otherStore, owner: { userId: otherOwner.id, role: 'OWNER' } },
  }
}

async function refused(promise: Promise<unknown>, code: string, status?: number): Promise<DiningCommandError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof DiningCommandError, `expected DiningCommandError ${code}, got ${error}`)
    assert.equal(error.code, code)
    if (status !== undefined) assert.equal(error.status, status)
    return error
  }
  assert.fail(`expected refusal ${code}`)
}

async function sqlState(promise: Promise<unknown>): Promise<string> {
  try { await promise } catch (error) {
    const evidence = `${(error as Error).message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`
    const code = (error as { code?: string }).code
    return /\b(23505|23503|23514|23502)\b/.exec(evidence)?.[1]
      ?? (/violates not-null constraint/i.test(evidence) ? '23502' : undefined)
      ?? (code === 'P2002' || /unique constraint/i.test(evidence) ? '23505'
        : code === 'P2003' || /foreign key constraint/i.test(evidence) ? '23503'
          : /violates check constraint/i.test(evidence) ? '23514' : evidence)
  }
  return 'NO_ERROR'
}

async function open(f: Fixture, tableId = f.tableId, db = admin()) {
  return openMeal(db, f.a.scope, f.owner, { tableId, guestCount: 2, requestKey: key() })
}
async function order(f: Fixture, mealId: string, items: { barcode: string; quantity: number }[], requestKey = key(), db = admin()) {
  return addOrderBatch(db, f.a.scope, f.owner, { store: f.a.store, mealId, requestKey, items })
}
async function settle(f: Fixture, meal: DiningMealView, overrides: Record<string, unknown> = {}, db = admin()) {
  return settleMeal(db, f.a.scope, f.owner, {
    store: f.a.store, mealId: meal.mealId, requestKey: key(), paymentMethod: 'CASH',
    expectedAmount: meal.unpaidAmount, expectedVersion: meal.version, ...overrides,
  })
}
/** First page of the recovery list (the list itself is paged; see the paging test). */
const recoverList = async (scope: DiningScope) => (await listRecoverableMeals(admin(), scope)).items
const counts = async (f: Fixture) => ({
  meals: await admin().diningMeal.count({ where: { tenantId: f.tenantId } }),
  batches: await admin().diningBatch.count({ where: { tenantId: f.tenantId } }),
  sales: await admin().saleRecord.count({ where: { tenantId: f.tenantId } }),
  payments: await admin().paymentIntent.count({ where: { tenantId: f.tenantId } }),
  voids: await admin().diningVoidLine.count({ where: { tenantId: f.tenantId } }),
  printJobs: await admin().eshopTrayPrintJob.count({ where: { tenantId: f.tenantId } }),
})

// ── Migration: constraints that the application must not be the only guard for ──

test('migration: partial unique index, composite foreign keys and shape checks are enforced by PostgreSQL', { skip }, async () => {
  const f = await fixture(), db = admin()
  const base = { openedByUserId: f.owner.userId, openRequestDigest: 'a'.repeat(64), guestCount: 2 }
  const first = await db.diningMeal.create({ data: { ...f.a.scope, tableId: f.tableId, openRequestKey: key(), ...base } })

  // One table, at most one meal that has not ended — even with the application lock bypassed.
  assert.equal(await sqlState(db.diningMeal.create({ data: { ...f.a.scope, tableId: f.tableId, openRequestKey: key(), ...base } })), '23505')
  const index = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE indexname = 'DiningMeal_one_active_per_table'`
  assert.match(index[0].indexdef, /UNIQUE INDEX .* \("tableId"\) WHERE \(\(?"?state"? = ANY \(ARRAY\['OPEN'::"DiningMealState", 'PAID'::"DiningMealState"\]\)/)

  // A meal cannot sit on another store's table; a batch cannot belong to another store's meal.
  assert.equal(await sqlState(db.diningMeal.create({ data: { ...f.b.scope, tableId: f.table2Id, openRequestKey: key(), ...base } })), '23503')
  assert.equal(await sqlState(db.diningBatch.create({ data: { ...f.b.scope, mealId: first.id, seq: 1, kind: 'ORDER', requestKey: key(), requestDigest: 'b'.repeat(64), operatorUserId: f.owner.userId } })), '23503')
  assert.equal(await sqlState(db.diningTable.create({ data: { tenantId: f.other.tenantId, storeId: f.a.id, name: 'cross-tenant' } })), '23503')

  // A sale row can only point at a batch of its own tenant and store.
  const batch = await db.diningBatch.create({ data: { ...f.a.scope, mealId: first.id, seq: 1, kind: 'ORDER', requestKey: key(), requestDigest: 'b'.repeat(64), operatorUserId: f.owner.userId } })
  const sale = (storeId: string, diningBatchId: string | null) => db.saleRecord.create({ data: {
    tenantId: f.tenantId, storeId, operatorUserId: f.owner.userId, recordNo: `S-${randomUUID()}`, saleType: 'SALE',
    barcode: 'x', productNameSnapshot: 'x', unitPrice: 1, quantity: 1, lineAmount: 1, diningBatchId,
  } })
  assert.equal(await sqlState(sale(f.b.id, batch.id)), '23503')
  assert.equal(await sqlState(sale(f.a.id, 'no-such-batch')), '23503')
  const plain = await sale(f.a.id, null)
  assert.equal(plain.diningBatchId, null)
  const own = await sale(f.a.id, batch.id)
  assert.equal(await sqlState(db.diningBatch.delete({ where: { id: batch.id } })), '23503')

  // A void line: one per sale row, and its batches stay inside one meal.
  const voidBatch = await db.diningBatch.create({ data: { ...f.a.scope, mealId: first.id, seq: 2, kind: 'VOID', reason: 'r', requestKey: key(), requestDigest: 'c'.repeat(64), operatorUserId: f.owner.userId } })
  const line = { ...f.a.scope, mealId: first.id, voidBatchId: voidBatch.id, saleRecordId: own.id, originalBatchId: batch.id, quantity: 1, originalNoticeClaimed: false }
  await db.diningVoidLine.create({ data: line })
  assert.equal(await sqlState(db.diningVoidLine.create({ data: line })), '23505')
  assert.equal(await sqlState(db.diningVoidLine.create({ data: { ...line, saleRecordId: plain.id, originalBatchId: voidBatch.id } })), '23514')

  // Shape checks: no payment fact without a payment row, no end state without end fields.
  assert.equal(await sqlState(db.diningMeal.update({ where: { id: first.id }, data: { state: 'PAID' } })), '23514')
  assert.equal(await sqlState(db.diningMeal.update({ where: { id: first.id }, data: { state: 'VOIDED' } })), '23514')
  assert.equal(await sqlState(db.diningMeal.update({ where: { id: first.id }, data: { guestCount: 0 } })), '23514')
  assert.equal(await sqlState(db.diningBatch.create({ data: { ...f.a.scope, mealId: first.id, seq: 3, kind: 'RENOTIFY', reason: 'r', requestKey: key(), requestDigest: 'd'.repeat(64), operatorUserId: f.owner.userId } })), '23514')
  assert.equal(await sqlState(db.diningBatch.create({ data: { ...f.a.scope, mealId: first.id, seq: 3, kind: 'VOID', requestKey: key(), requestDigest: 'd'.repeat(64), operatorUserId: f.owner.userId } })), '23514')
  assert.equal(await sqlState(db.diningBatch.update({ where: { id: batch.id }, data: { noticeReportedOutcome: 'CROSSED', noticeReportedAt: new Date() } })), '23514')
})

test('migration: kitchenLineIds is never NULL — PostgreSQL refuses a direct NULL, and leaving it out stores an empty list', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await db.diningMeal.create({ data: { ...f.a.scope, tableId: f.tableId, openRequestKey: key(), openedByUserId: f.owner.userId, openRequestDigest: 'a'.repeat(64), guestCount: 1 } })
  const column = await db.$queryRaw<{ is_nullable: string; column_default: string | null; udt_name: string }[]>`
    SELECT is_nullable, column_default, udt_name FROM information_schema.columns WHERE table_name = 'DiningBatch' AND column_name = 'kitchenLineIds'`
  assert.deepEqual([column[0].is_nullable, column[0].udt_name], ['NO', '_text'])
  assert.match(column[0].column_default ?? '', /ARRAY\[\]::text\[\]|'\{\}'::text\[\]/i)

  // Written straight to the table, past Prisma and past the application.
  const insert = (id: string, seq: number, columns: string, values: string) => db.$executeRawUnsafe(
    `INSERT INTO "DiningBatch" ("id","tenantId","storeId","mealId","seq","kind","requestKey","requestDigest","operatorUserId"${columns}) VALUES ($1,$2,$3,$4,$5,'ORDER',$6,$7,$8${values})`,
    id, f.tenantId, f.a.id, meal.id, seq, key(), 'e'.repeat(64), f.owner.userId)
  const refusedId = `null-${randomUUID()}`
  assert.equal(await sqlState(insert(refusedId, 1, ',"kitchenLineIds"', ',NULL')), '23502')
  assert.equal(await db.diningBatch.count({ where: { id: refusedId } }), 0)

  const defaultId = `default-${randomUUID()}`
  assert.equal(await insert(defaultId, 1, '', ''), 1)
  const stored = await db.$queryRaw<{ ids: string[] | null; isNull: boolean; size: number | null }[]>`
    SELECT "kitchenLineIds" AS ids, "kitchenLineIds" IS NULL AS "isNull", cardinality("kitchenLineIds") AS size FROM "DiningBatch" WHERE "id" = ${defaultId}`
  assert.deepEqual(stored, [{ ids: [], isNull: false, size: 0 }])
  assert.deepEqual((await db.diningBatch.findUniqueOrThrow({ where: { id: defaultId } })).kitchenLineIds, [])

  // An existing row cannot be turned into NULL either.
  assert.equal(await sqlState(db.$executeRawUnsafe(`UPDATE "DiningBatch" SET "kitchenLineIds" = NULL WHERE "id" = $1`, defaultId)), '23502')
  assert.deepEqual((await db.diningBatch.findUniqueOrThrow({ where: { id: defaultId } })).kitchenLineIds, [])
  // The application reads such a batch as "nothing for the kitchen", never as a missing value.
  const view = await getMealView(db, f.a.scope, meal.id)
  assert.deepEqual([view.batches[0].lines, view.batches[0].notice.status, view.pendingNoticeSeqs], [[], 'NOT_REQUIRED', []])
})

// ── Open ────────────────────────────────────────────────────────────────────

test('open: concurrent opens of one table create one meal; request key replays in every later state', { skip }, async () => {
  const f = await fixture()
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => openMeal(worker(i % 6), f.a.scope, f.owner, { tableId: f.tableId, guestCount: 2, requestKey: key() })))
  const won = results.filter((result) => result.status === 'fulfilled')
  assert.equal(won.length, 1)
  for (const result of results) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof DiningCommandError, String(result.reason))
      assert.equal(result.reason.code, 'TABLE_OCCUPIED')
      assert.equal((result.reason.details as { mealId: string }).mealId, (won[0] as PromiseFulfilledResult<{ mealId: string }>).value.mealId)
    }
  }
  assert.equal((await counts(f)).meals, 1)

  // The same request, sent eight times at once on the other table.
  const requestKey = key(), input = { tableId: f.table2Id, guestCount: 4, note: 'window', requestKey }
  const same = await Promise.all(Array.from({ length: 8 }, (_, i) => openMeal(worker(i % 6), f.a.scope, f.owner, input)))
  assert.equal(new Set(same.map((result) => result.mealId)).size, 1)
  assert.equal(same.filter((result) => !result.replayed).length, 1)
  assert.equal((await counts(f)).meals, 2)

  await refused(openMeal(admin(), f.a.scope, f.owner, { ...input, guestCount: 5 }), 'REQUEST_KEY_REUSED')
  // One key racing for two different free tables: one meal, and the loser is told the key means something else.
  const spare = await admin().diningTable.create({ data: { ...f.a.scope, name: 'T3' } }), spare2 = await admin().diningTable.create({ data: { ...f.a.scope, name: 'T4' } })
  const sharedKey = key()
  const race = await Promise.allSettled([spare.id, spare2.id].map((tableId, i) => openMeal(worker(i), f.a.scope, f.owner, { tableId, guestCount: 2, requestKey: sharedKey })))
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal((race.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason.code, 'REQUEST_KEY_REUSED')
  assert.equal(await admin().diningMeal.count({ where: { tenantId: f.tenantId, openRequestKey: sharedKey } }), 1)
  await voidMeal(admin(), f.a.scope, f.owner, { mealId: (race.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<{ mealId: string }>).value.mealId, requestKey: key() })
  await refused(openMeal(admin(), f.a.scope, f.owner, { tableId: f.table2Id, guestCount: 1, requestKey: key() }), 'TABLE_OCCUPIED')
  await refused(openMeal(admin(), f.b.scope, f.owner, { tableId: f.tableId, guestCount: 1, requestKey: key() }), 'TABLE_NOT_FOUND', 404)
  await refused(openMeal(admin(), f.a.scope, f.owner, { tableId: f.table2Id, guestCount: 0, requestKey: key() }), 'GUEST_COUNT_INVALID', 400)

  // After the meal is voided the original request still answers with that meal, and the table is free again.
  await voidMeal(admin(), f.a.scope, f.owner, { mealId: same[0].mealId, requestKey: key() })
  const later = await openMeal(admin(), f.a.scope, f.owner, input)
  assert.deepEqual({ mealId: later.mealId, state: later.state, replayed: later.replayed }, { mealId: same[0].mealId, state: 'VOIDED', replayed: true })
  const reopened = await openMeal(admin(), f.a.scope, f.owner, { tableId: f.table2Id, guestCount: 1, requestKey: key() })
  assert.notEqual(reopened.mealId, same[0].mealId)
  assert.equal((await counts(f)).meals, 4)
})

// ── Order ───────────────────────────────────────────────────────────────────

test('order: server price snapshot, one batch per request key, unique numbers under concurrency', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const requestKey = key(), items = [{ barcode: f.food.barcode, quantity: 2 }, { barcode: f.drink.barcode, quantity: 1 }]
  const same = await Promise.all(Array.from({ length: 8 }, (_, i) => order(f, meal.mealId, items, requestKey, worker(i % 6))))
  assert.equal(new Set(same.map((result) => result.batchId)).size, 1)
  assert.equal(same.filter((result) => !result.replayed).length, 1)
  assert.deepEqual(await counts(f), { meals: 1, batches: 1, sales: 2, payments: 0, voids: 0, printJobs: 0 })

  const first = same[0].meal
  assert.equal(first.unpaidAmount, '8.20')
  assert.equal(first.version, 2)
  const rows = await db.saleRecord.findMany({ where: { tenantId: f.tenantId }, orderBy: { recordNo: 'asc' } })
  assert.ok(rows.every((row) => row.status === 'PENDING_PAYMENT' && row.diningBatchId === same[0].batchId && row.orderNo === first.billNo && row.source === null))
  assert.equal(first.billNo, rows[0].recordNo)
  const batch = await db.diningBatch.findUniqueOrThrow({ where: { id: same[0].batchId } })
  assert.deepEqual(batch.kitchenLineIds, rows.filter((row) => row.barcode === f.food.barcode).map((row) => row.id))
  assert.equal(batch.noticeRequired, true)

  // Same key with other content is refused; a page cannot supply a price.
  await refused(order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 3 }], requestKey), 'REQUEST_KEY_REUSED')
  await db.product.updateMany({ where: { tenantId: f.tenantId, barcode: f.food.barcode }, data: { sellPrice: '9.00' } })
  const second = await addOrderBatch(db, f.a.scope, f.owner, { store: f.a.store, mealId: meal.mealId, requestKey: key(), items: [{ barcode: f.food.barcode, quantity: 1, unitPrice: 0.01, lineAmount: 0.01 }] as never })
  assert.equal(second.meal.unpaidAmount, '17.20')
  assert.equal(second.meal.batches[0].lines.find((line) => line.name === 'Fried rice')!.unitPrice, '3.50')
  assert.equal(second.meal.batches[1].lines[0].unitPrice, '9.00')
  assert.equal(second.meal.billNo, first.billNo)

  // Six different orders at once: six batches, consecutive sequence, no duplicate record number.
  const many = await Promise.all(Array.from({ length: 6 }, (_, i) => order(f, meal.mealId, [{ barcode: f.drink.barcode, quantity: i + 1 }], key(), worker(i))))
  assert.deepEqual(many.map((result) => result.seq).sort((a, b) => a - b), [3, 4, 5, 6, 7, 8])
  const all = await db.saleRecord.findMany({ where: { tenantId: f.tenantId } })
  assert.equal(new Set(all.map((row) => row.recordNo)).size, all.length)
  assert.equal(all.length, 9)
  assert.equal((await getMealView(db, f.a.scope, meal.mealId)).version, 9)

  await refused(order(f, meal.mealId, [{ barcode: 'missing', quantity: 1 }]), 'PRODUCT_NOT_FOUND', 404)
  await refused(order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1.5 }]), 'ORDER_ITEM_INVALID', 400)
  await refused(order(f, meal.mealId, []), 'ORDER_ITEMS_REQUIRED', 400)
  await refused(addOrderBatch(db, f.b.scope, f.owner, { store: f.b.store, mealId: meal.mealId, requestKey: key(), items }), 'MEAL_NOT_FOUND', 404)
  await refused(addOrderBatch(db, f.other.store.scope, f.other.owner, { store: f.other.store.store, mealId: meal.mealId, requestKey: key(), items }), 'MEAL_NOT_FOUND', 404)
})

test('order: a record-number collision with a concurrent cashier sale never duplicates or loses a batch', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const { generateRecordNo } = await import('../lib/record-no')
  // A plain cashier-style writer taking numbers from the same count+1 source at the same time.
  const cashier = async (index: number) => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        return await worker(index).$transaction(async (tx) => {
          const recordNo = await generateRecordNo(tx, 'S', f.tenantId, f.a.id, f.a.code)
          return tx.saleRecord.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, recordNo, orderNo: recordNo, saleType: 'SALE', barcode: f.drink.barcode, productNameSnapshot: 'Cola', unitPrice: 1.2, quantity: 1, lineAmount: 1.2 } })
        })
      } catch (error) { if ((error as { code?: string }).code !== 'P2002') throw error }
    }
    throw new Error('cashier writer could not get a number')
  }
  const keys = Array.from({ length: 4 }, key)
  const attempt = (requestKey: string, index: number) => order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }], requestKey, worker(index))
  const [orders] = await Promise.all([
    Promise.allSettled(keys.map((requestKey, index) => attempt(requestKey, index))),
    Promise.all([cashier(4), cashier(5), cashier(4), cashier(5)]),
  ])
  // Anything that gave up asks for the same request again; replaying it must settle at exactly one batch each.
  for (const [index, result] of orders.entries()) {
    if (result.status === 'rejected') {
      assert.equal((result.reason as DiningCommandError).code, 'BUSY_RETRY_SAME_REQUEST')
      await attempt(keys[index], index)
    }
  }
  for (const requestKey of keys) assert.equal(await db.diningBatch.count({ where: { mealId: meal.mealId, requestKey } }), 1)
  const rows = await db.saleRecord.findMany({ where: { tenantId: f.tenantId } })
  assert.equal(rows.length, 8)
  assert.equal(new Set(rows.map((row) => row.recordNo)).size, 8)
  assert.equal(rows.filter((row) => row.diningBatchId).length, 4)
})

// ── Void ────────────────────────────────────────────────────────────────────

test('void: five checks each have a refusing counter-example; the sale row keeps its original batch', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f), other = await open(f, f.table2Id)
  const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 2 }, { barcode: f.drink.barcode, quantity: 1 }])
  const otherBatch = await order(f, other.mealId, [{ barcode: f.drink.barcode, quantity: 1 }])
  const [food, drink] = [batch.meal.batches[0].lines.find((line) => line.kitchen)!, batch.meal.batches[0].lines.find((line) => !line.kitchen)!]
  const go = (lines: { saleRecordId: string; quantity: number }[], actor = f.owner, scope = f.a.scope, requestKey = key()) =>
    voidLines(db, scope, actor, { mealId: meal.mealId, requestKey, lines, reason: 'changed mind' })

  await refused(go([{ saleRecordId: food.saleRecordId, quantity: 2 }], f.staff), 'OWNER_REQUIRED', 403)
  // 1 tenant/store: a row of another store, and this meal addressed from another store or tenant.
  const foreign = await db.saleRecord.create({ data: { tenantId: f.tenantId, storeId: f.b.id, operatorUserId: f.owner.userId, recordNo: `S-${randomUUID()}`, orderNo: batch.meal.billNo, saleType: 'SALE', status: 'PENDING_PAYMENT', barcode: 'x', productNameSnapshot: 'x', unitPrice: 1, quantity: 1, lineAmount: 1 } })
  await refused(go([{ saleRecordId: foreign.id, quantity: 1 }]), 'VOID_LINE_NOT_FOUND', 404)
  await refused(go([{ saleRecordId: food.saleRecordId, quantity: 2 }], f.owner, f.b.scope), 'MEAL_NOT_FOUND', 404)
  await refused(voidLines(db, f.other.store.scope, f.other.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: food.saleRecordId, quantity: 2 }], reason: 'x' }), 'MEAL_NOT_FOUND', 404)
  // 2 meal ownership: a row of another meal, and a same-bill row that no order batch created.
  await refused(go([{ saleRecordId: otherBatch.meal.batches[0].lines[0].saleRecordId, quantity: 1 }]), 'VOID_LINE_NOT_IN_MEAL')
  const stray = await db.saleRecord.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, recordNo: `S-${randomUUID()}`, orderNo: batch.meal.billNo, saleType: 'SALE', status: 'PENDING_PAYMENT', barcode: 'x', productNameSnapshot: 'x', unitPrice: 1, quantity: 1, lineAmount: 1 } })
  await refused(go([{ saleRecordId: stray.id, quantity: 1 }]), 'VOID_LINE_NOT_IN_MEAL')
  await db.saleRecord.delete({ where: { id: stray.id } })
  // 4 quantity: whole lines only.
  await refused(go([{ saleRecordId: food.saleRecordId, quantity: 1 }]), 'PARTIAL_VOID_NOT_SUPPORTED')
  await refused(voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: food.saleRecordId, quantity: 2 }], reason: '  ' }), 'REASON_REQUIRED', 400)
  assert.deepEqual((await counts(f)).voids, 0)

  const requestKey = key()
  const done = await go([{ saleRecordId: food.saleRecordId, quantity: 2 }], f.owner, f.a.scope, requestKey)
  assert.equal(done.meal.unpaidAmount, '1.20')
  const row = await db.saleRecord.findUniqueOrThrow({ where: { id: food.saleRecordId } })
  assert.deepEqual([row.status, row.diningBatchId], ['CANCELLED', batch.batchId])
  const line = await db.diningVoidLine.findUniqueOrThrow({ where: { saleRecordId: food.saleRecordId } })
  assert.deepEqual([line.voidBatchId, line.originalBatchId, Number(line.quantity), line.originalNoticeClaimed], [done.batchId, batch.batchId, 2, false])

  // Replay returns the same batch; 3 status and 5 no-repeat: a voided row cannot be voided again.
  const replay = await go([{ saleRecordId: food.saleRecordId, quantity: 2 }], f.owner, f.a.scope, requestKey)
  assert.deepEqual([replay.batchId, replay.replayed], [done.batchId, true])
  await refused(go([{ saleRecordId: food.saleRecordId, quantity: 2 }], f.owner, f.a.scope, requestKey.replace('k-', 'z-')), 'VOID_LINE_NOT_VOIDABLE')
  await refused(go([{ saleRecordId: food.saleRecordId, quantity: 1 }], f.owner, f.a.scope, requestKey), 'REQUEST_KEY_REUSED')
  assert.equal((await counts(f)).voids, 1)
  assert.equal(drink.kitchen, false)
})

// ── Kitchen notice ──────────────────────────────────────────────────────────

test('kitchen notice: one claimer gets content, one report is kept, and this module never writes a print job', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: f.drink.barcode, quantity: 2 }])
  assert.deepEqual([batch.meal.batches[0].notice.status, batch.meal.batches[0].notice.canClaim, batch.meal.batches[0].notice.canRenotify], ['PENDING_SUBMIT', true, false])

  const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => claimNotice(worker(i % 6), f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId })))
  const winners = claims.filter((claim) => claim.claimed)
  assert.equal(winners.length, 1)
  assert.ok(claims.filter((claim) => !claim.claimed).every((claim) => !('notice' in claim) && claim.status === 'UNKNOWN'))
  const notice = (winners[0] as Extract<typeof winners[0], { claimed: true }>).notice
  assert.equal(notice.printOrderNo, `${batch.meal.billNo}.1`)
  assert.equal(notice.printJobId, canonicalV3OriginalPrintJobId(notice.printOrderNo, 'KITCHEN'))
  assert.equal(notice.role, 'KITCHEN')
  assert.deepEqual(notice.content.lines.map((line) => [line.name, line.quantity]), [['Fried rice', 1]])
  assert.deepEqual([notice.content.tableName, notice.content.kind, notice.content.subject, notice.content.seq], ['T1', 'ORDER', 'ORDER', 1])
  const stored = await db.diningBatch.findUniqueOrThrow({ where: { id: batch.batchId } })
  // The execution window is the batch's own thirty minutes; taking the notice later never extends it.
  assert.equal(Date.parse(notice.expiresAt) - stored.createdAt.getTime(), 30 * 60 * 1000)
  assert.ok(Date.parse(notice.expiresAt) <= stored.noticeClaimedAt!.getTime() + 30 * 60 * 1000)

  // Claimed, nothing reported, no job row: unknown.
  assert.equal((await getMealView(db, f.a.scope, meal.mealId)).batches[0].notice.status, 'UNKNOWN')
  await refused(reportNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: batch.batchId, outcome: 'CROSSED' }), 'NOTICE_CLAIMED_BY_ANOTHER_OPERATOR', 403)
  await refused(reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId, outcome: 'PRINTED_FOR_SURE' }), 'NOTICE_OUTCOME_INVALID', 400)
  const reports = await Promise.all(['FAILED_NOT_CROSSED', 'CROSSED', 'CROSSING_UNKNOWN'].map((outcome, i) => reportNotice(worker(i), f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId, outcome })))
  assert.equal(reports.filter((report) => report.recorded).length, 1)
  const kept = (await db.diningBatch.findUniqueOrThrow({ where: { id: batch.batchId } })).noticeReportedOutcome
  assert.equal((await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId, outcome: 'REJECTED' })).recorded, false)
  assert.equal((await db.diningBatch.findUniqueOrThrow({ where: { id: batch.batchId } })).noticeReportedOutcome, kept)

  // A drink-only batch needs no notice and cannot be claimed.
  const drinks = await order(f, meal.mealId, [{ barcode: f.drink.barcode, quantity: 1 }])
  assert.equal(drinks.meal.batches[1].notice.status, 'NOT_REQUIRED')
  const none = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: drinks.batchId })
  assert.deepEqual([none.claimed, 'status' in none && none.status], [false, 'NOT_REQUIRED'])
  await refused(claimNotice(db, f.b.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId }), 'MEAL_NOT_FOUND', 404)

  assert.equal((await counts(f)).printJobs, 0)
})

async function printJob(f: Fixture, printOrderNo: string, fields: { status: 'SUCCEEDED' | 'FAILED' | 'PENDING'; resultStatus?: string; effectBoundary?: string }) {
  const done = fields.status !== 'PENDING'
  await admin().eshopTrayPrintJob.create({ data: {
    ...f.a.scope, idempotencyKey: canonicalV3OriginalPrintJobId(printOrderNo, 'KITCHEN'), requestHash: 'e'.repeat(64), schemaVersion: 3,
    payload: { schemaVersion: 3 }, status: fields.status, expiresAt: new Date(Date.now() + 60_000),
    completedAt: done ? new Date() : null, resultCode: done ? 'TEST_FIXTURE' : null,
    resultStatus: fields.resultStatus ?? null, effectBoundary: fields.effectBoundary ?? null,
  } })
}

test('kitchen notice: state is derived from the page report and the existing print job row, conservatively', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const status = async (index: number) => (await getMealView(db, f.a.scope, meal.mealId)).batches[index].notice.status
  const claimed = async (report?: string) => {
    const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
    const claim = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId })
    assert.equal(claim.claimed, true)
    if (report) await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId, outcome: report })
    return { index: batch.seq - 1, printOrderNo: diningNoticePrintOrderNo(batch.meal.billNo!, batch.seq) }
  }
  const printed = { status: 'SUCCEEDED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSED' }
  const notPrinted = { status: 'FAILED' as const, resultStatus: 'FAILED_NOT_CROSSED', effectBoundary: 'NOT_CROSSED' }

  // The page says "sent" and there is no job row (yet): unknown. Only the row makes it SENT.
  const a = await claimed('CROSSED'); assert.equal(await status(a.index), 'UNKNOWN')
  const k = await claimed('CROSSED'); assert.equal(await status(k.index), 'UNKNOWN')
  await printJob(f, k.printOrderNo, printed); assert.equal(await status(k.index), 'SENT')
  // The page says "sent" and the row is there but inconclusive (claimed by the device, not finished): still unknown.
  const m = await claimed('CROSSED'); await printJob(f, m.printOrderNo, { status: 'PENDING' }); assert.equal(await status(m.index), 'UNKNOWN')
  const n = await claimed('CROSSED'); await printJob(f, n.printOrderNo, { status: 'FAILED', resultStatus: 'CROSSING_UNKNOWN', effectBoundary: 'CROSSING_UNKNOWN' }); assert.equal(await status(n.index), 'UNKNOWN')
  const b = await claimed('FAILED_NOT_CROSSED'); assert.equal(await status(b.index), 'NOT_SENT')
  const c = await claimed('BRIDGE_UNAVAILABLE'); assert.equal(await status(c.index), 'NOT_SENT')
  for (const outcome of ['CROSSING_UNKNOWN', 'NOT_EXECUTED', 'REJECTED', 'HELD', 'V2_FALLBACK_REQUIRED', 'MODE_BLOCKED', 'AUTHORITY_REJECTED', 'SUBMIT_THREW', 'NO_RESPONSE', 'UNRECOGNIZED']) {
    assert.equal(await status((await claimed(outcome)).index), 'UNKNOWN', outcome)
  }
  // Response lost after the claim: the job row alone decides.
  const d = await claimed(); assert.equal(await status(d.index), 'UNKNOWN')
  await printJob(f, d.printOrderNo, printed); assert.equal(await status(d.index), 'SENT')
  const e = await claimed(); await printJob(f, e.printOrderNo, notPrinted); assert.equal(await status(e.index), 'NOT_SENT')
  const g = await claimed(); await printJob(f, g.printOrderNo, { status: 'PENDING' }); assert.equal(await status(g.index), 'UNKNOWN')
  // Report and evidence disagree: the cautious side wins, except evidence of "printed".
  await printJob(f, b.printOrderNo, printed); assert.equal(await status(b.index), 'SENT')
  await printJob(f, a.printOrderNo, notPrinted); assert.equal(await status(a.index), 'UNKNOWN')
  await printJob(f, c.printOrderNo, { status: 'PENDING' }); assert.equal(await status(c.index), 'UNKNOWN')
  // A job of another store with the same identity is not evidence here.
  const h = await claimed()
  await db.eshopTrayPrintJob.create({ data: { ...f.b.scope, idempotencyKey: canonicalV3OriginalPrintJobId(h.printOrderNo, 'KITCHEN'), requestHash: 'e'.repeat(64), schemaVersion: 3, payload: {}, status: 'SUCCEEDED', resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: 'X', expiresAt: new Date(Date.now() + 60_000) } })
  assert.equal(await status(h.index), 'UNKNOWN')
})

test('void and kitchen: content is what is still valid at claim time; unknown needs an in-person confirmation', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const soup = (await db.product.findFirstOrThrow({ where: { tenantId: f.tenantId, name: 'Noodle soup' } })).barcode
  const twoDishes = () => order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: soup, quantity: 1 }])
  const lineOf = (view: DiningMealView, seq: number, name: string) => view.batches[seq - 1].lines.find((line) => line.name === name)!
  const voidOne = (saleRecordId: string, extra: Record<string, unknown> = {}) =>
    voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId, quantity: 1 }], reason: 'guest changed', ...extra })
  const claim = (batchId: string) => claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId })

  // (a) Not yet handed out: the void needs no notice; the later order notice simply omits the dish.
  const a = await twoDishes()
  const aVoid = await voidOne(lineOf(a.meal, a.seq, 'Fried rice').saleRecordId)
  assert.equal(aVoid.meal.batches[aVoid.seq - 1].notice.status, 'NOT_REQUIRED')
  const aClaim = await claim(a.batchId)
  assert.ok(aClaim.claimed)
  assert.deepEqual(aClaim.notice.content.lines.map((line) => line.name), ['Noodle soup'])
  // … and when every kitchen dish of a batch is gone, the notice is withdrawn and nobody can take it.
  const a2 = await twoDishes()
  await voidOne(lineOf(a2.meal, a2.seq, 'Fried rice').saleRecordId)
  const a2Void = await voidOne(lineOf(a2.meal, a2.seq, 'Noodle soup').saleRecordId)
  assert.equal(a2Void.meal.batches[a2.seq - 1].notice.status, 'WITHDRAWN')
  const a2Claim = await claim(a2.batchId)
  assert.deepEqual([a2Claim.claimed, 'status' in a2Claim && a2Claim.status], [false, 'WITHDRAWN'])

  // (b) Sent to the printer: the void carries its own notice listing only the voided dish.
  const b = await twoDishes()
  await claim(b.batchId)
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: b.batchId, outcome: 'CROSSED' })
  await cloudPrinted(f, b.meal.billNo, b.seq)
  const bVoid = await voidOne(lineOf(b.meal, b.seq, 'Noodle soup').saleRecordId)
  assert.equal(bVoid.meal.batches[bVoid.seq - 1].notice.status, 'PENDING_SUBMIT')
  const bClaim = await claim(bVoid.batchId)
  assert.ok(bClaim.claimed)
  assert.deepEqual([bClaim.notice.content.kind, bClaim.notice.content.subject, bClaim.notice.content.lines.map((line) => line.name)], ['VOID', 'VOID', ['Noodle soup']])
  assert.equal(bClaim.notice.printOrderNo, `${meal ? bVoid.meal.billNo : ''}.${bVoid.seq}`)
  assert.equal((await db.diningVoidLine.findUniqueOrThrow({ where: { saleRecordId: lineOf(b.meal, b.seq, 'Noodle soup').saleRecordId } })).originalNoticeClaimed, true)

  // (c) Unknown: refused until the operator confirms having told the kitchen; the refusal writes nothing.
  const c = await twoDishes()
  await claim(c.batchId)
  const before = await counts(f)
  const cLine = lineOf(c.meal, c.seq, 'Fried rice').saleRecordId
  const refusal = await refused(voidOne(cLine), 'KITCHEN_CONFIRMATION_REQUIRED')
  assert.deepEqual(refusal.details, { saleRecordIds: [cLine] })
  assert.deepEqual(await counts(f), before)
  const cVoid = await voidOne(cLine, { kitchenConfirmed: true })
  assert.equal(cVoid.meal.batches[cVoid.seq - 1].notice.status, 'PENDING_SUBMIT')
  const log = await db.operationLog.findFirstOrThrow({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_VOID_LINES', targetId: cVoid.batchId } })
  assert.equal((log.payloadSnapshot as { kitchenConfirmedInPerson: boolean }).kitchenConfirmedInPerson, true)

  // (d) Certainly not sent: the kitchen never had it, so no void notice.
  const d = await twoDishes()
  await claim(d.batchId)
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: d.batchId, outcome: 'FAILED_NOT_CROSSED' })
  const dVoid = await voidOne(lineOf(d.meal, d.seq, 'Fried rice').saleRecordId)
  assert.equal(dVoid.meal.batches[dVoid.seq - 1].notice.status, 'NOT_REQUIRED')

  // A drink never went to the kitchen: no notice, no confirmation.
  const e = await order(f, meal.mealId, [{ barcode: f.drink.barcode, quantity: 1 }])
  const eVoid = await voidOne(e.meal.batches[e.seq - 1].lines[0].saleRecordId)
  assert.equal(eVoid.meal.batches[eVoid.seq - 1].notice.status, 'NOT_REQUIRED')
  // One fixture row stands in for the print core's report on batch (b); the module itself wrote none.
  assert.equal((await counts(f)).printJobs, 1)
})

test('void and claim race: no notice content ever contains a voided dish', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  for (let round = 0; round < 12; round += 1) {
    const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
    const saleRecordId = batch.meal.batches[batch.seq - 1].lines[0].saleRecordId
    const [claimResult, voidResult] = await Promise.allSettled([
      claimNotice(worker(0), f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId }),
      voidLines(worker(1), f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId, quantity: 1 }], reason: 'race', kitchenConfirmed: true }),
    ])
    assert.equal(claimResult.status, 'fulfilled')
    assert.equal(voidResult.status, 'fulfilled')
    const claim = (claimResult as PromiseFulfilledResult<Awaited<ReturnType<typeof claimNotice>>>).value
    const line = await db.diningVoidLine.findUniqueOrThrow({ where: { saleRecordId } })
    const original = await db.diningBatch.findUniqueOrThrow({ where: { id: batch.batchId } })
    if (claim.claimed) {
      // Claim first: the dish was valid when handed out, and the void knows the kitchen may have it.
      assert.deepEqual(claim.notice.content.lines.map((entry) => entry.saleRecordId), [saleRecordId])
      assert.equal(line.originalNoticeClaimed, true)
      assert.ok(line.createdAt >= original.noticeClaimedAt!)
    } else {
      // Void first: nothing was handed out, and it never will be.
      assert.equal(claim.status, 'WITHDRAWN')
      assert.equal(line.originalNoticeClaimed, false)
      assert.equal(original.noticeClaimedAt, null)
    }
  }
})

// ── Re-notification ─────────────────────────────────────────────────────────

test('renotify: always a person, always a new batch and identity, never a voided dish, never automatic', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const soup = (await db.product.findFirstOrThrow({ where: { tenantId: f.tenantId, name: 'Noodle soup' } })).barcode
  const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: soup, quantity: 1 }])
  const again = (extra: Record<string, unknown> = {}, refBatchId = batch.batchId, actor = f.staff) =>
    renotifyBatch(db, f.a.scope, actor, { mealId: meal.mealId, refBatchId, requestKey: key(), reason: 'kitchen did not get it', ...extra })

  // Before the first submit there is nothing to re-send.
  await refused(again(), 'NOTICE_NOT_SUBMITTED_YET')
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId })

  // Unknown: the system creates nothing by itself, and a person must accept the duplicate risk.
  const idle = await counts(f)
  await getMealView(db, f.a.scope, meal.mealId)
  await listTables(db, f.a.scope)
  assert.deepEqual(await counts(f), idle)
  const view = (await getMealView(db, f.a.scope, meal.mealId)).batches[0].notice
  assert.deepEqual([view.status, view.canRenotify, view.duplicateRisk], ['UNKNOWN', true, true])
  await refused(again(), 'DUPLICATE_RISK_NOT_ACCEPTED')
  assert.deepEqual(await counts(f), idle)
  await refused(again({ reason: '' }), 'REASON_REQUIRED', 400)

  const requestKey = key()
  const first = await again({ duplicateRiskAccepted: true, requestKey })
  assert.equal(first.seq, 2)
  const row = await db.diningBatch.findUniqueOrThrow({ where: { id: first.batchId } })
  assert.deepEqual([row.kind, row.refBatchId, row.noticeRequired, row.kitchenLineIds], ['RENOTIFY', batch.batchId, true, []])
  assert.deepEqual([(await again({ duplicateRiskAccepted: true, requestKey })).batchId, (await counts(f)).batches], [first.batchId, 2])
  // One click, one batch, one submit: no second re-notification while this one waits; none of a re-notification.
  await refused(again({ duplicateRiskAccepted: true }), 'RENOTIFY_ALREADY_PENDING')
  await refused(again({ duplicateRiskAccepted: true }, first.batchId), 'RENOTIFY_TARGET_INVALID')

  // The dish voided in the meantime is not on the re-sent ticket.
  const rice = batch.meal.batches[0].lines.find((line) => line.name === 'Fried rice')!.saleRecordId
  await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: rice, quantity: 1 }], reason: 'x', kitchenConfirmed: true })
  const claim = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: first.batchId })
  assert.ok(claim.claimed)
  assert.deepEqual([claim.notice.content.kind, claim.notice.content.subject, claim.notice.content.refSeq, claim.notice.content.lines.map((line) => line.name)], ['RENOTIFY', 'ORDER', 1, ['Noodle soup']])
  assert.equal(claim.notice.printOrderNo, `${batch.meal.billNo}.2`)
  assert.notEqual(claim.notice.printJobId, canonicalV3OriginalPrintJobId(`${batch.meal.billNo}.1`, 'KITCHEN'))

  // Certainly not sent anywhere in the chain: no duplicate warning is needed.
  const meal2 = await open(f, f.table2Id)
  const plain = await order(f, meal2.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal2.mealId, batchId: plain.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal2.mealId, batchId: plain.batchId, outcome: 'FAILED_NOT_CROSSED' })
  const noRisk = (await getMealView(db, f.a.scope, meal2.mealId)).batches[0].notice
  assert.deepEqual([noRisk.status, noRisk.canRenotify, noRisk.duplicateRisk], ['NOT_SENT', true, false])
  const resent = await renotifyBatch(db, f.a.scope, f.staff, { mealId: meal2.mealId, refBatchId: plain.batchId, requestKey: key(), reason: 'printer was off' })
  // A failed re-notification does not trigger another one; the next needs a new click.
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal2.mealId, batchId: resent.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal2.mealId, batchId: resent.batchId, outcome: 'CROSSING_UNKNOWN' })
  assert.equal(await db.diningBatch.count({ where: { mealId: meal2.mealId } }), 2)
  // Once every dish of the order is voided there is nothing left to re-send.
  await voidLines(db, f.a.scope, f.owner, { mealId: meal2.mealId, requestKey: key(), lines: [{ saleRecordId: plain.meal.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'x', kitchenConfirmed: true })
  await refused(renotifyBatch(db, f.a.scope, f.staff, { mealId: meal2.mealId, refBatchId: plain.batchId, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'NOTHING_TO_RENOTIFY')
  assert.equal((await counts(f)).printJobs, 0)
})

/** The print job row the Desktop print core's report leaves behind for a notice that was sent to the printer. Fixture only. */
const cloudPrinted = (f: Fixture, billNo: string | null, seq: number) =>
  printJob(f, diningNoticePrintOrderNo(billNo!, seq), { status: 'SUCCEEDED', resultStatus: 'CROSSED', effectBoundary: 'CROSSED' })

// ── Settle ──────────────────────────────────────────────────────────────────

test('settle: the collected amount must be the amount owed; one payment however often and however it is asked', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const ordered = (await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 2 }, { barcode: f.drink.barcode, quantity: 1 }])).meal
  assert.equal(ordered.unpaidAmount, '8.20')

  // A kitchen notice nobody has sent yet. It is asserted below that it never stands in the way of the payment.
  assert.deepEqual([ordered.pendingNoticeSeqs, ordered.noSendEvidence], [[1], { orderSeqs: [1], voidSeqs: [] }])
  await refused(settle(f, ordered, { paymentMethod: 'KHQR', manualPaymentConfirmed: true, store: { ...f.a.store, currencyCode: 'XAF' } }), 'KHQR_UNSUPPORTED_CURRENCY', 422)
  await refused(settle(f, ordered, { expectedAmount: '8.19' }), 'BILL_CHANGED')
  await refused(settle(f, ordered, { expectedVersion: ordered.version - 1 }), 'BILL_CHANGED')
  await refused(settle(f, ordered, { expectedAmount: 8.2 }), 'EXPECTED_AMOUNT_REQUIRED', 400)
  await refused(settle(f, ordered, { paymentMethod: 'KHQR' }), 'MANUAL_PAYMENT_CONFIRMATION_REQUIRED')
  await refused(settle(f, ordered, { paymentMethod: 'MEMBER_BALANCE' }), 'PAYMENT_METHOD_INVALID', 400)
  await refused(settleMeal(db, f.b.scope, f.owner, { store: f.b.store, mealId: meal.mealId, requestKey: key(), paymentMethod: 'CASH', expectedAmount: '8.20', expectedVersion: ordered.version }), 'MEAL_NOT_FOUND', 404)
  assert.equal((await counts(f)).payments, 0)

  // Another device adds a dish while the cashier holds the old total.
  const added = (await order(f, meal.mealId, [{ barcode: f.drink.barcode, quantity: 1 }])).meal
  const stale = await refused(settle(f, ordered), 'BILL_CHANGED')
  assert.deepEqual(stale.details, { amount: '9.40', version: added.version })
  assert.equal((await counts(f)).payments, 0)

  // Ten cashiers confirm at once with different request keys.
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => settle(f, added, {}, worker(i % 6))))
  assert.equal(results.filter((result) => !result.alreadySettled && !result.replayed).length, 1)
  assert.equal(results.filter((result) => result.alreadySettled).length, 9)
  assert.equal(new Set(results.map((result) => result.payment.paymentIntentId)).size, 1)
  const payments = await db.paymentIntent.findMany({ where: { tenantId: f.tenantId } })
  assert.equal(payments.length, 1)
  const settleLog = await db.operationLog.findFirstOrThrow({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_SETTLE', status: 'SUCCESS' } })
  // Paid with the kitchen notice of batch 1 still unsent: nothing was asked, nothing was refused; it is reported and audited.
  const winner = results.find((result) => !result.alreadySettled && !result.replayed)!
  assert.ok(results.every((result) => JSON.stringify(result.kitchenWarnings) === JSON.stringify({ orderSeqs: [1], voidSeqs: [] })))
  assert.deepEqual([winner.meal.noSendEvidence, winner.meal.pendingNoticeSeqs, winner.meal.batches[0].notice.status], [{ orderSeqs: [1], voidSeqs: [] }, [], 'NOT_NOTIFIED_SETTLED'])
  const snapshot = settleLog.payloadSnapshot as { noSendEvidence: { orderSeqs: number[]; voidSeqs: number[] } }
  assert.deepEqual([snapshot.noSendEvidence.orderSeqs, snapshot.noSendEvidence.voidSeqs], [[1], []])
  assert.equal(await db.operationLog.count({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_SETTLE', status: 'FAILED' } }), 0)
  assert.deepEqual([payments[0].status, payments[0].amount.toFixed(2), payments[0].paymentMethod, payments[0].orderNo, payments[0].storeId, payments[0].operatorUserId], ['PAID', '9.40', 'CASH', added.billNo, f.a.id, f.owner.userId])
  assert.ok(payments[0].paidAt)
  const rows = await db.saleRecord.findMany({ where: { tenantId: f.tenantId } })
  assert.ok(rows.every((row) => row.status === 'COMPLETED'))
  assert.equal(rows.reduce((sum, row) => sum.add(row.lineAmount), new Prisma.Decimal(0)).toFixed(2), '9.40')
  const paid = results[0].meal
  assert.deepEqual([paid.state, paid.unpaidAmount, paid.payment?.amount], ['PAID', '0.00', '9.40'])

  // A paid meal takes no more orders, voids or re-notifications.
  await refused(order(f, meal.mealId, [{ barcode: f.drink.barcode, quantity: 1 }]), 'MEAL_NOT_OPEN')
  await refused(voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: rows[0].id, quantity: Number(rows[0].quantity) }], reason: 'x' }), 'MEAL_NOT_OPEN')
  await refused(voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() }), 'MEAL_ALREADY_PAID')
  const unclaimed = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: paid.batches[0].id })
  assert.deepEqual([unclaimed.claimed, 'status' in unclaimed && unclaimed.status], [false, 'NOT_NOTIFIED_SETTLED'])
  // Nothing new is sent for cooking once the bill is paid: not a first notice, not a re-notification.
  assert.deepEqual([paid.batches[0].notice.canClaim, paid.batches[0].notice.canRenotify], [false, false])
  await refused(renotifyBatch(db, f.a.scope, f.owner, { mealId: meal.mealId, refBatchId: paid.batches[0].id, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'MEAL_NOT_OPEN')
  assert.equal((await counts(f)).batches, 2)
  assert.equal((await counts(f)).payments, 1)
})

test('settle: request key replays the same payment in PAID and CLOSED; different content is refused', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const ordered = (await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])).meal
  const requestKey = key()
  const input = { requestKey, paymentMethod: 'KHQR', manualPaymentConfirmed: true }
  const first = await settle(f, ordered, input)
  assert.deepEqual([first.replayed, first.alreadySettled, first.payment.paymentMethod, first.payment.amount], [false, false, 'KHQR', '3.50'])
  // The retry still carries the amount and version the cashier saw before paying.
  const again = await settle(f, ordered, input)
  assert.deepEqual([again.replayed, again.payment.paymentIntentId], [true, first.payment.paymentIntentId])
  await refused(settle(f, ordered, { ...input, paymentMethod: 'CASH' }), 'REQUEST_KEY_REUSED')
  await refused(settle(f, ordered, { ...input, expectedAmount: '3.00' }), 'REQUEST_KEY_REUSED')

  // The same settle key presented for another meal is a different request, not a replay and not "busy".
  const elsewhere = await open(f, f.table2Id)
  const elsewhereBill = (await order(f, elsewhere.mealId, [{ barcode: f.drink.barcode, quantity: 1 }])).meal
  await refused(settle(f, elsewhereBill, { requestKey }), 'REQUEST_KEY_REUSED')
  assert.equal((await counts(f)).payments, 1)

  const endKey = key()
  await refused(clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: 'short' }), 'REQUEST_KEY_REQUIRED', 400)
  const cleared = await clearMeal(db, f.a.scope, f.staff, { mealId: meal.mealId, requestKey: endKey })
  assert.deepEqual([cleared.state, cleared.replayed, cleared.alreadyEnded], ['CLOSED', false, false])
  const closedReplay = await settle(f, ordered, input)
  assert.deepEqual([closedReplay.replayed, closedReplay.payment.paymentIntentId, closedReplay.meal.state], [true, first.payment.paymentIntentId, 'CLOSED'])
  const closedOther = await settle(f, ordered)
  assert.deepEqual([closedOther.alreadySettled, closedOther.payment.paymentIntentId], [true, first.payment.paymentIntentId])

  // End of meal: same key replays, a different key reports the existing end, nothing is rewritten.
  const before = await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } })
  assert.deepEqual([(await clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: endKey })).replayed, (await clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })).alreadyEnded], [true, true])
  assert.deepEqual([(await voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })).state], ['CLOSED'])
  await refused(voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: endKey }), 'REQUEST_KEY_REUSED')
  assert.deepEqual(await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } }), before)
  assert.deepEqual([(await counts(f)).payments, (await counts(f)).meals], [1, 2])
  await settle(f, elsewhereBill)
  await refused(clearMeal(db, f.a.scope, f.owner, { mealId: elsewhere.mealId, requestKey: endKey }), 'REQUEST_KEY_REUSED')
  await clearMeal(db, f.a.scope, f.owner, { mealId: elsewhere.mealId, requestKey: key() })

  // The original open and order requests still answer with their records after the meal is closed.
  const replayedOrder = await db.diningBatch.findFirstOrThrow({ where: { mealId: meal.mealId } })
  const orderAgain = await addOrderBatch(db, f.a.scope, f.owner, { store: f.a.store, mealId: meal.mealId, requestKey: replayedOrder.requestKey, items: [{ barcode: f.food.barcode, quantity: 1 }] })
  assert.deepEqual([orderAgain.replayed, orderAgain.batchId, orderAgain.meal.state], [true, replayedOrder.id, 'CLOSED'])
  await refused(order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }]), 'MEAL_NOT_OPEN')
  const reopened = await open(f)
  assert.notEqual(reopened.mealId, meal.mealId)
})

test('settle against concurrent orders and voids: whoever is second sees the first; books always balance', { skip }, async () => {
  const f = await fixture(), db = admin()
  for (let round = 0; round < 10; round += 1) {
    const meal = await openMeal(db, f.a.scope, f.owner, { tableId: round % 2 ? f.tableId : f.table2Id, guestCount: 2, requestKey: key() })
    const ordered = (await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: f.drink.barcode, quantity: 1 }])).meal
    const voidTarget = ordered.batches[0].lines.find((line) => !line.kitchen)!
    const [paid, added, voided] = await Promise.allSettled([
      settle(f, ordered, {}, worker(0)),
      order(f, meal.mealId, [{ barcode: f.drink.barcode, quantity: 3 }], key(), worker(1)),
      voidLines(worker(2), f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: voidTarget.saleRecordId, quantity: 1 }], reason: 'race' }),
    ])
    const rows = await db.saleRecord.findMany({ where: { tenantId: f.tenantId, orderNo: ordered.billNo } })
    const state = (await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } })).state
    const payment = await db.paymentIntent.findUnique({ where: { orderNo: ordered.billNo! } })
    if (paid.status === 'fulfilled') {
      // Settle won the lock first: the others were turned away, and every unpaid row was collected.
      assert.equal((added as PromiseRejectedResult).reason.code, 'MEAL_NOT_OPEN')
      assert.equal((voided as PromiseRejectedResult).reason.code, 'MEAL_NOT_OPEN')
      assert.equal(state, 'PAID')
      assert.equal(rows.filter((row) => row.status === 'PENDING_PAYMENT').length, 0)
      assert.equal(rows.filter((row) => row.status === 'COMPLETED').reduce((sum, row) => sum.add(row.lineAmount), new Prisma.Decimal(0)).toFixed(2), payment!.amount.toFixed(2))
      assert.equal(payment!.amount.toFixed(2), '4.70')
    } else {
      // Something changed the bill first: no money was recorded against the stale total.
      assert.equal(paid.reason.code, 'BILL_CHANGED')
      assert.ok(added.status === 'fulfilled' || voided.status === 'fulfilled')
      assert.equal(state, 'OPEN')
      assert.equal(payment, null)
      assert.equal(rows.filter((row) => row.status === 'COMPLETED').length, 0)
      const fresh = await getMealView(db, f.a.scope, meal.mealId)
      await settle(f, fresh)
    }
    await clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  }
  // Across every round: one payment per bill, each equal to its completed rows; nothing left pending.
  const payments = await db.paymentIntent.findMany({ where: { tenantId: f.tenantId } })
  assert.equal(payments.length, 10)
  for (const payment of payments) {
    const rows = await db.saleRecord.findMany({ where: { tenantId: f.tenantId, orderNo: payment.orderNo, status: 'COMPLETED' } })
    assert.equal(rows.reduce((sum, row) => sum.add(row.lineAmount), new Prisma.Decimal(0)).toFixed(2), payment.amount.toFixed(2))
    assert.equal(payment.status, 'PAID')
  }
  assert.equal(await db.saleRecord.count({ where: { tenantId: f.tenantId, status: 'PENDING_PAYMENT' } }), 0)
})

test('settle and end: nothing to settle, external payment, clearing rules', { skip }, async () => {
  const f = await fixture(), db = admin()
  const empty = await open(f)
  const emptyView = await getMealView(db, f.a.scope, empty.mealId)
  await refused(settle(f, emptyView), 'NOTHING_TO_SETTLE')
  await refused(clearMeal(db, f.a.scope, f.owner, { mealId: empty.mealId, requestKey: key() }), 'MEAL_NOT_PAID')
  await refused(voidMeal(db, f.a.scope, f.staff, { mealId: empty.mealId, requestKey: key() }), 'OWNER_REQUIRED', 403)

  const ordered = (await order(f, empty.mealId, [{ barcode: f.drink.barcode, quantity: 2 }])).meal
  await refused(voidMeal(db, f.a.scope, f.owner, { mealId: empty.mealId, requestKey: key() }), 'MEAL_HAS_UNPAID_LINES')
  // A payment row that did not come from this module (legacy checkout during a rollback, say).
  const external = await db.paymentIntent.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, orderNo: ordered.billNo!, paymentMethod: 'CASH', status: 'PAID', amount: '2.40', paidAt: new Date() } })
  const blocked = await refused(settle(f, ordered), 'EXTERNAL_PAYMENT_EXISTS')
  assert.deepEqual(blocked.details, { paymentIntentId: external.id, status: 'PAID' })
  assert.deepEqual([(await db.diningMeal.findUniqueOrThrow({ where: { id: empty.mealId } })).state, (await counts(f)).payments], ['OPEN', 1])
  // Such a bill cannot grow either, and the bill view says why.
  await refused(order(f, empty.mealId, [{ barcode: f.drink.barcode, quantity: 1 }]), 'EXTERNAL_PAYMENT_EXISTS')
  assert.equal((await getMealView(db, f.a.scope, empty.mealId)).externalPaymentStatus, 'PAID')
  assert.equal((await counts(f)).sales, 1)
  await db.paymentIntent.delete({ where: { id: external.id } })
  assert.equal((await getMealView(db, f.a.scope, empty.mealId)).externalPaymentStatus, null)

  const all = ordered.batches[0].lines.map((line) => ({ saleRecordId: line.saleRecordId, quantity: line.quantity }))
  const voided = (await voidLines(db, f.a.scope, f.owner, { mealId: empty.mealId, requestKey: key(), lines: all, reason: 'left' })).meal
  await refused(settle(f, voided), 'NOTHING_TO_SETTLE')
  const ended = await voidMeal(db, f.a.scope, f.owner, { mealId: empty.mealId, requestKey: key() })
  assert.equal(ended.state, 'VOIDED')
  await refused(settle(f, voided), 'MEAL_NOT_OPEN')
  assert.equal((await counts(f)).payments, 0)
})

test('ending a meal is never gated on kitchen notices; a void notice stays sendable afterwards; a bad identity is not consumed', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId, outcome: 'CROSSED' })
  await cloudPrinted(f, batch.meal.billNo, batch.seq)
  // The order was sent to the printer; the dish is voided; its void notice is still waiting for a page.
  const voided = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: batch.meal.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'cancelled' })
  assert.deepEqual(voided.meal.pendingNoticeSeqs, [2])

  // The owner voids the meal with the void notice unsent: no acknowledgement exists, none is asked.
  const ended = await voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  assert.deepEqual([ended.state, ended.noSendEvidenceVoidSeqs], ['VOIDED', [2]])
  const log = await db.operationLog.findFirstOrThrow({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_VOID_MEAL' } })
  assert.deepEqual((log.payloadSnapshot as { noSendEvidenceVoidSeqs: number[] }).noSendEvidenceVoidSeqs, [2])
  assert.equal((await listTables(db, f.a.scope)).find((table) => table.id === f.tableId)?.meal, null)

  // The table is free, and the ended meal is still reachable because the kitchen has not been told to stop.
  const listed = await recoverList(f.a.scope)
  assert.deepEqual(listed.map((entry) => [entry.mealId, entry.state, entry.tableName, entry.voidNoticeSeqs]), [[meal.mealId, 'VOIDED', 'T1', [2]]])
  // The cashier's way into the dine-in page stays open for it although no table is occupied.
  assert.deepEqual([await hasActiveMeals(db, f.a.scope), await hasActiveMeals(db, f.b.scope)], [true, false])
  assert.deepEqual(await recoverList(f.b.scope), [])
  const view = await getMealView(db, f.a.scope, meal.mealId)
  assert.deepEqual([view.batches[1].notice.status, view.batches[1].notice.canClaim, view.batches[0].notice.canRenotify], ['PENDING_SUBMIT', true, false])

  // First submit of the void notice after the meal ended; unknown result; a person re-sends it.
  const before = await counts(f)
  const first = await claimNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: voided.batchId })
  assert.ok(first.claimed)
  assert.deepEqual([first.notice.content.kind, first.notice.content.subject, first.notice.content.lines.map((line) => line.name), first.notice.printOrderNo], ['VOID', 'VOID', ['Fried rice'], `${batch.meal.billNo}.2`])
  assert.equal((await claimNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: voided.batchId })).claimed, false)
  await reportNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: voided.batchId, outcome: 'CROSSING_UNKNOWN' })
  // Unknown: nothing is created by reading, however often.
  for (let i = 0; i < 3; i += 1) { await getMealView(db, f.a.scope, meal.mealId); await recoverList(f.a.scope); await listTables(db, f.a.scope) }
  assert.deepEqual(await counts(f), before)
  assert.deepEqual((await recoverList(f.a.scope)).map((entry) => entry.voidNoticeSeqs), [[2]])
  await refused(renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: key(), reason: 'unsure' }), 'DUPLICATE_RISK_NOT_ACCEPTED')
  const resendKey = key()
  const resend = await renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: resendKey, reason: 'unsure', duplicateRiskAccepted: true })
  assert.deepEqual([resend.seq, resend.replayed, resend.meal.state], [3, false, 'VOIDED'])
  assert.equal((await renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: resendKey, reason: 'unsure', duplicateRiskAccepted: true })).batchId, resend.batchId)
  // One at a time, never of a re-notification, never of the order that the meal no longer cooks.
  await refused(renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'RENOTIFY_ALREADY_PENDING')
  await refused(renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: resend.batchId, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'RENOTIFY_TARGET_INVALID')
  await refused(renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: batch.batchId, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'MEAL_NOT_OPEN')
  const second = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: resend.batchId })
  assert.ok(second.claimed)
  assert.deepEqual([second.notice.content.kind, second.notice.content.subject, second.notice.content.refSeq, second.notice.content.lines.map((line) => line.name)], ['RENOTIFY', 'VOID', 2, ['Fried rice']])
  assert.deepEqual([second.notice.printOrderNo, second.notice.printJobId === first.notice.printJobId], [`${batch.meal.billNo}.3`, false])
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: resend.batchId, outcome: 'CROSSED' })
  // The page says it was sent, but the print core's own report has not arrived: the meal stays listed and the entrance stays open.
  assert.deepEqual([(await recoverList(f.a.scope)).map((entry) => entry.voidNoticeSeqs), await hasActiveMeals(db, f.a.scope)], [[[2]], true])
  const after = await counts(f)
  assert.deepEqual([after.batches - before.batches, after.meals, after.sales, after.payments, after.voids, after.printJobs - before.printJobs], [1, before.meals, before.sales, 0, before.voids, 0])
  // The print job row arrives: now there is sending evidence, and the meal leaves the list.
  await cloudPrinted(f, batch.meal.billNo, resend.seq)
  assert.deepEqual([await recoverList(f.a.scope), await hasActiveMeals(db, f.a.scope)], [[], false])
  const finalMeal = await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } })
  assert.deepEqual([finalMeal.state, finalMeal.paymentIntentId, finalMeal.version], ['VOIDED', null, voided.meal.version])
  const audits = await db.operationLog.findMany({ where: { tenantId: f.tenantId, actionType: { in: ['DINE_IN_NOTICE_CLAIM', 'DINE_IN_RENOTIFY'] }, createdAt: { gte: new Date(ended.endedAt) } } })
  assert.deepEqual(audits.map((entry) => (entry.payloadSnapshot as { mealState: string }).mealState), ['VOIDED', 'VOIDED', 'VOIDED'])

  // A bill number that cannot be a print identity: the claim is refused and the notice is NOT consumed.
  const odd = await db.store.create({ data: { tenantId: f.tenantId, code: `DI#${randomUUID().slice(0, 6)}`, name: 'odd code', businessType: 'FOOD', printKitchenTicket: true } })
  const oddScope = { tenantId: f.tenantId, storeId: odd.id }
  const oddTable = await db.diningTable.create({ data: { ...oddScope, name: 'T1' } })
  const oddMeal = await openMeal(db, oddScope, f.owner, { tableId: oddTable.id, guestCount: 1, requestKey: key() })
  const oddBatch = await addOrderBatch(db, oddScope, f.owner, { store: { code: odd.code, printKitchenTicket: true }, mealId: oddMeal.mealId, requestKey: key(), items: [{ barcode: f.food.barcode, quantity: 1 }] })
  await refused(claimNotice(db, oddScope, f.owner, { mealId: oddMeal.mealId, batchId: oddBatch.batchId }), 'PRINT_IDENTITY_INVALID')
  assert.equal((await db.diningBatch.findUniqueOrThrow({ where: { id: oddBatch.batchId } })).noticeClaimedAt, null)
  assert.equal((await getMealView(db, oddScope, oddMeal.mealId)).batches[0].notice.status, 'PENDING_SUBMIT')
  // Two fixture rows above (batch 1, and the re-sent void notice); the module itself wrote none.
  assert.equal((await counts(f)).printJobs, 2)
})

test('void meal: any payment fact on the bill refuses it and leaves every row as it was', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const owner = r.device(f.tenantId, f.a)
  const snapshot = async (mealId: string, billNo: string) => JSON.stringify({
    meal: await db.diningMeal.findUniqueOrThrow({ where: { id: mealId } }),
    batches: await db.diningBatch.findMany({ where: { mealId }, orderBy: { seq: 'asc' } }),
    sales: await db.saleRecord.findMany({ where: { orderNo: billNo }, orderBy: { recordNo: 'asc' } }),
    payments: await db.paymentIntent.findMany({ where: { orderNo: billNo } }),
    voids: await db.diningVoidLine.findMany({ where: { mealId } }),
  })
  const tryVoid = (mealId: string) => voidMeal(db, f.a.scope, f.owner, { mealId, requestKey: key() })

  // 1. Money was taken for the bill outside this module (a legacy cash checkout during an application rollback):
  //    a PAID payment row, every line COMPLETED, and the meal still OPEN with nothing unpaid.
  const paidMeal = await open(f)
  const paidOrder = (await order(f, paidMeal.mealId, [{ barcode: f.drink.barcode, quantity: 2 }])).meal
  const legacy = await db.paymentIntent.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, orderNo: paidOrder.billNo!, paymentMethod: 'CASH', status: 'PAID', amount: '2.40', paidAt: new Date() } })
  await db.saleRecord.updateMany({ where: { orderNo: paidOrder.billNo! }, data: { status: 'COMPLETED' } })
  const stuck = await getMealView(db, f.a.scope, paidMeal.mealId)
  assert.deepEqual([stuck.state, stuck.unpaidLineCount, stuck.externalPaymentStatus], ['OPEN', 0, 'PAID'])
  const before = await snapshot(paidMeal.mealId, paidOrder.billNo!)
  const refusal = await refused(tryVoid(paidMeal.mealId), 'PAYMENT_FACT_EXISTS', 409)
  assert.deepEqual(refusal.details, { paymentIntentId: legacy.id, paymentIntentStatus: 'PAID', completedLineCount: 1 })
  assert.equal(await snapshot(paidMeal.mealId, paidOrder.billNo!), before)
  // Through the route: the same refusal, a FAILED audit row without amounts, still nothing changed.
  const viaRoute = await r.call(r.handlers.session.POST, { storeCode: f.a.code, headers: owner, params: { id: paidMeal.mealId }, body: { action: 'VOID', requestKey: key() } })
  assert.deepEqual([viaRoute.status, viaRoute.body.error, viaRoute.body.details.paymentIntentStatus], [409, 'PAYMENT_FACT_EXISTS', 'PAID'])
  const failed = await db.operationLog.findMany({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_VOID_MEAL' } })
  assert.deepEqual(failed.map((entry) => [entry.status, entry.message, entry.targetId]), [['FAILED', 'PAYMENT_FACT_EXISTS', paidMeal.mealId]])
  assert.ok(!/amount|price|\d\.\d\d/i.test(JSON.stringify(failed[0].payloadSnapshot)))
  assert.equal(await snapshot(paidMeal.mealId, paidOrder.billNo!), before)
  // Nothing in this module adopts that payment: the bill cannot be settled, grown, cleared or voided here.
  await refused(settle(f, stuck), 'NOTHING_TO_SETTLE')
  await refused(order(f, paidMeal.mealId, [{ barcode: f.drink.barcode, quantity: 1 }]), 'EXTERNAL_PAYMENT_EXISTS')
  await refused(clearMeal(db, f.a.scope, f.owner, { mealId: paidMeal.mealId, requestKey: key() }), 'MEAL_NOT_PAID')
  assert.equal(await snapshot(paidMeal.mealId, paidOrder.billNo!), before)
  assert.equal((await listTables(db, f.a.scope)).find((table) => table.id === f.tableId)?.meal?.state, 'OPEN')

  // 2. A payment that is still being taken (PENDING), every line already voided.
  const pendingMeal = await open(f, f.table2Id)
  const pendingOrder = (await order(f, pendingMeal.mealId, [{ barcode: f.drink.barcode, quantity: 1 }])).meal
  await voidLines(db, f.a.scope, f.owner, { mealId: pendingMeal.mealId, requestKey: key(), lines: [{ saleRecordId: pendingOrder.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'left' })
  const inFlight = await db.paymentIntent.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, orderNo: pendingOrder.billNo!, paymentMethod: 'KHQR', status: 'PENDING', amount: '1.20' } })
  const beforePending = await snapshot(pendingMeal.mealId, pendingOrder.billNo!)
  assert.deepEqual((await refused(tryVoid(pendingMeal.mealId), 'PAYMENT_FACT_EXISTS')).details, { paymentIntentId: inFlight.id, paymentIntentStatus: 'PENDING', completedLineCount: 0 })
  assert.equal(await snapshot(pendingMeal.mealId, pendingOrder.billNo!), beforePending)
  // 3. A completed line with no payment row at all is still money that was taken.
  await db.paymentIntent.delete({ where: { id: inFlight.id } })
  await db.saleRecord.updateMany({ where: { orderNo: pendingOrder.billNo! }, data: { status: 'COMPLETED' } })
  assert.deepEqual((await refused(tryVoid(pendingMeal.mealId), 'PAYMENT_FACT_EXISTS')).details, { paymentIntentId: null, paymentIntentStatus: null, completedLineCount: 1 })
  await db.saleRecord.updateMany({ where: { orderNo: pendingOrder.billNo! }, data: { status: 'CANCELLED' } })
  // 4. A payment attempt that ended without money (cancelled, failed, expired) is not a payment fact.
  for (const status of ['CANCELLED', 'FAILED', 'EXPIRED'] as const) {
    const dead = await db.paymentIntent.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, orderNo: pendingOrder.billNo!, paymentMethod: 'KHQR', status, amount: '1.20' } })
    if (status !== 'EXPIRED') await db.paymentIntent.delete({ where: { id: dead.id } })
  }
  const ended = await tryVoid(pendingMeal.mealId)
  assert.deepEqual([ended.state, ended.noSendEvidenceVoidSeqs], ['VOIDED', []])
  assert.equal(await db.paymentIntent.count({ where: { orderNo: pendingOrder.billNo!, status: { in: ['PAID', 'PENDING'] } } }), 0)
})

test('after payment: only an existing void notice can still be sent or re-sent, by a person, under a new identity', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const soup = (await db.product.findFirstOrThrow({ where: { tenantId: f.tenantId, name: 'Noodle soup' } })).barcode
  const meal = await open(f)
  // Batch 1 reached the kitchen. Its soup is voided (batch 2, void notice unsent). Batch 3 is ordered and its notice never taken.
  const first = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: soup, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: first.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: first.batchId, outcome: 'CROSSED' })
  await cloudPrinted(f, first.meal.billNo, first.seq)
  const soupLine = first.meal.batches[0].lines.find((line) => line.name === 'Noodle soup')!
  const voided = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: soupLine.saleRecordId, quantity: 1 }], reason: 'changed mind' })
  const third = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 2 }])
  assert.deepEqual([third.meal.pendingNoticeSeqs, third.meal.unpaidAmount], [[2, 3], '10.50'])
  assert.equal((await listTables(db, f.a.scope)).find((table) => table.id === f.tableId)?.meal?.pendingNoticeCount, 2)

  // Payment goes through with both notices unsent. No confirmation field exists; an old client's stray one changes nothing.
  const settleKey = key()
  const paid = await settle(f, third.meal, { requestKey: settleKey })
  assert.deepEqual([paid.meal.state, paid.payment.amount, paid.kitchenWarnings], ['PAID', '10.50', { orderSeqs: [3], voidSeqs: [2] }])
  const replay = await settleMeal(db, f.a.scope, f.owner, { store: f.a.store, mealId: meal.mealId, requestKey: settleKey, paymentMethod: 'CASH', expectedAmount: '10.50', expectedVersion: third.meal.version, ...({ acceptedNoticeSeqs: [9] } as object) })
  assert.deepEqual([replay.replayed, replay.payment.paymentIntentId, replay.kitchenWarnings], [true, paid.payment.paymentIntentId, { orderSeqs: [3], voidSeqs: [2] }])
  assert.equal((await listTables(db, f.a.scope)).find((table) => table.id === f.tableId)?.meal?.pendingNoticeCount, 1)
  const money = async () => JSON.stringify({
    payments: await db.paymentIntent.findMany({ where: { tenantId: f.tenantId } }),
    sales: await db.saleRecord.findMany({ where: { tenantId: f.tenantId }, orderBy: { recordNo: 'asc' } }),
  })
  const books = await money()

  // The order notice of batch 3 is gone for good; the void notice of batch 2 is handed out exactly once.
  const view = paid.meal.batches
  assert.deepEqual(view.map((entry) => [entry.seq, entry.notice.status, entry.notice.canClaim, entry.notice.canRenotify]), [[1, 'SENT', false, false], [2, 'PENDING_SUBMIT', true, false], [3, 'NOT_NOTIFIED_SETTLED', false, false]])
  const gone = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: third.batchId })
  assert.deepEqual([gone.claimed, 'status' in gone && gone.status], [false, 'NOT_NOTIFIED_SETTLED'])
  for (const refBatchId of [first.batchId, third.batchId]) {
    await refused(renotifyBatch(db, f.a.scope, f.owner, { mealId: meal.mealId, refBatchId, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'MEAL_NOT_OPEN')
  }
  await refused(renotifyBatch(db, f.a.scope, f.owner, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: key(), reason: 'x', duplicateRiskAccepted: true }), 'NOTICE_NOT_SUBMITTED_YET')
  const claims = await Promise.all(Array.from({ length: 6 }, (_, i) => claimNotice(worker(i), f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId })))
  const won = claims.filter((claim) => claim.claimed)
  assert.equal(won.length, 1)
  const notice = won[0].claimed ? won[0].notice : null
  assert.deepEqual([notice?.content.subject, notice?.content.lines.map((line) => line.name), notice?.printOrderNo], ['VOID', ['Noodle soup'], `${first.meal.billNo}.2`])
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId, outcome: 'FAILED_NOT_CROSSED' })

  // Certainly not sent. Nothing re-sends by itself; a person asks, and gets a new batch with a new identity.
  const quiet = await counts(f)
  for (let i = 0; i < 3; i += 1) { await getMealView(db, f.a.scope, meal.mealId); await listTables(db, f.a.scope); await recoverList(f.a.scope) }
  assert.deepEqual(await counts(f), quiet)
  const params = { id: meal.mealId }, owner = r.device(f.tenantId, f.a)
  const resent = await r.call(r.handlers.renotify.POST, { storeCode: f.a.code, headers: owner, params: { ...params, batchId: voided.batchId }, body: { requestKey: key(), reason: 'printer was off' } })
  assert.deepEqual([resent.status, resent.body.seq, resent.body.meal.state], [201, 4, 'PAID'])
  const resentClaim = await r.call(r.handlers.claim.POST, { storeCode: f.a.code, headers: owner, params, body: { batchId: resent.body.batchId } })
  assert.deepEqual([resentClaim.body.claimed, resentClaim.body.notice.content.kind, resentClaim.body.notice.content.subject, resentClaim.body.notice.printOrderNo], [true, 'RENOTIFY', 'VOID', `${first.meal.billNo}.4`])
  assert.notEqual(resentClaim.body.notice.printJobId, notice?.printJobId)
  await r.call(r.handlers.report.POST, { storeCode: f.a.code, headers: owner, params, body: { batchId: resent.body.batchId, outcome: 'CROSSING_UNKNOWN' } })

  // Cleared. The table is free; the meal is listed for as long as the kitchen is not known to have the void notice.
  const cleared = await clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  // The re-sent void notice has an unknown result, so the clearing says it is still open — the same thing the list says.
  assert.deepEqual([cleared.state, cleared.noSendEvidenceVoidSeqs], ['CLOSED', [2]])
  const tables = await r.call(r.handlers.tables.GET, { method: 'GET', storeCode: f.a.code, headers: owner })
  assert.deepEqual([tables.body.tables.find((table: { id: string }) => table.id === f.tableId).meal, tables.body.recoverable.items.map((entry: { mealId: string; state: string; voidNoticeSeqs: number[] }) => [entry.mealId, entry.state, entry.voidNoticeSeqs])], [null, [[meal.mealId, 'CLOSED', [2]]]])
  const last = await renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: key(), reason: 'still nothing', duplicateRiskAccepted: true })
  assert.equal(last.seq, 5)
  const lastClaim = await claimNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: last.batchId })
  assert.ok(lastClaim.claimed)
  assert.equal(lastClaim.notice.printOrderNo, `${first.meal.billNo}.5`)
  await reportNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: last.batchId, outcome: 'CROSSED' })
  assert.equal((await recoverList(f.a.scope)).length, 1)
  await cloudPrinted(f, first.meal.billNo, last.seq)
  assert.deepEqual(await recoverList(f.a.scope), [])

  // None of this touched money, sale rows, the meal's payment, or wrote a print job.
  assert.equal(await money(), books)
  const done = await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } })
  // The only print job rows are the two fixture rows above that stand in for the print core's report; the module wrote none.
  assert.deepEqual([done.state, done.paymentIntentId, (await counts(f)).printJobs], ['CLOSED', paid.payment.paymentIntentId, 2])
})

test('kitchen warnings follow sending evidence, not merely whether a page took the notice', { skip }, async () => {
  const f = await fixture(), db = admin()
  const soup = (await db.product.findFirstOrThrow({ where: { tenantId: f.tenantId, name: 'Noodle soup' } })).barcode
  const meal = await open(f)
  // Batch 1: taken by a page, printer certainly did not get it. Batch 2: taken, sent. Batch 3: sent, then re-notified without need.
  const one = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: one.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: one.batchId, outcome: 'FAILED_NOT_CROSSED' })
  const two = await order(f, meal.mealId, [{ barcode: soup, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: two.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: two.batchId, outcome: 'CROSSED' })
  await cloudPrinted(f, two.meal.billNo, two.seq)
  const three = await order(f, meal.mealId, [{ barcode: soup, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: three.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: three.batchId, outcome: 'CROSSED' })
  await cloudPrinted(f, three.meal.billNo, three.seq)
  await renotifyBatch(db, f.a.scope, f.owner, { mealId: meal.mealId, refBatchId: three.batchId, requestKey: key(), reason: 'again', duplicateRiskAccepted: true })
  // The soup of batch 2 is voided; its void notice is taken and certainly not sent.
  const voided = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: two.meal.batches[1].lines[0].saleRecordId, quantity: 1 }], reason: 'x' })
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId, outcome: 'FAILED_NOT_CROSSED' })

  const before = await getMealView(db, f.a.scope, meal.mealId)
  // Nothing is "pending" in the sense of untaken except the needless re-notification (seq 4)…
  assert.deepEqual(before.pendingNoticeSeqs, [4])
  // …but there is no evidence that batch 1 was sent, nor the void of batch 2's soup (seq 5). Batch 3 has sending evidence from its first notice.
  assert.deepEqual(before.noSendEvidence, { orderSeqs: [1], voidSeqs: [5] })

  const paid = await settle(f, before)
  assert.deepEqual([paid.meal.state, paid.kitchenWarnings], ['PAID', { orderSeqs: [1], voidSeqs: [5] }])
  const log = await db.operationLog.findFirstOrThrow({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_SETTLE', status: 'SUCCESS' } })
  const snapshot = log.payloadSnapshot as { noSendEvidence: { orderSeqs: number[]; voidSeqs: number[] } }
  assert.deepEqual([snapshot.noSendEvidence.orderSeqs, snapshot.noSendEvidence.voidSeqs], [[1], [5]])
  // After payment batch 1 cannot be sent again; the void notice can.
  const notices = Object.fromEntries(paid.meal.batches.map((batch) => [batch.seq, [batch.notice.status, batch.notice.canClaim, batch.notice.canRenotify]]))
  assert.deepEqual(notices, { 1: ['NOT_SENT', false, false], 2: ['SENT', false, false], 3: ['SENT', false, false], 4: ['NOT_NOTIFIED_SETTLED', false, false], 5: ['NOT_SENT', false, true] })
  const cleared = await clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  assert.deepEqual([cleared.noSendEvidenceVoidSeqs, (await recoverList(f.a.scope)).map((entry) => entry.voidNoticeSeqs)], [[5], [[5]]])
})

test('request digests cover every input that changes the outcome', { skip }, async () => {
  const f = await fixture(), db = admin()
  const meal = await open(f)
  const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: f.drink.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId })
  const [rice, cola] = ['Fried rice', 'Cola'].map((name) => batch.meal.batches[0].lines.find((line) => line.name === name)!)

  // Void: the in-person confirmation is part of the request.
  const voidKey = key()
  const voidInput = { mealId: meal.mealId, requestKey: voidKey, lines: [{ saleRecordId: rice.saleRecordId, quantity: 1 }], reason: 'x' }
  await refused(voidLines(db, f.a.scope, f.owner, voidInput), 'KITCHEN_CONFIRMATION_REQUIRED')
  const done = await voidLines(db, f.a.scope, f.owner, { ...voidInput, kitchenConfirmed: true })
  assert.equal((await voidLines(db, f.a.scope, f.owner, { ...voidInput, kitchenConfirmed: true })).batchId, done.batchId)
  await refused(voidLines(db, f.a.scope, f.owner, voidInput), 'REQUEST_KEY_REUSED')
  await refused(voidLines(db, f.a.scope, f.owner, { ...voidInput, kitchenConfirmed: true, reason: 'y' }), 'REQUEST_KEY_REUSED')

  // Re-notification: accepting the duplicate risk is part of the request.
  const againKey = key()
  const againInput = { mealId: meal.mealId, refBatchId: done.batchId, requestKey: againKey, reason: 'again' }
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: done.batchId })
  await refused(renotifyBatch(db, f.a.scope, f.owner, againInput), 'DUPLICATE_RISK_NOT_ACCEPTED')
  const again = await renotifyBatch(db, f.a.scope, f.owner, { ...againInput, duplicateRiskAccepted: true })
  assert.equal((await renotifyBatch(db, f.a.scope, f.owner, { ...againInput, duplicateRiskAccepted: true })).batchId, again.batchId)
  await refused(renotifyBatch(db, f.a.scope, f.owner, againInput), 'REQUEST_KEY_REUSED')

  // Settle: method, amount, bill version and the manual confirmation are all part of the request.
  const current = await getMealView(db, f.a.scope, meal.mealId)
  assert.deepEqual([current.unpaidAmount, cola.lineAmount], ['1.20', '1.20'])
  const settleKey = key()
  const base = { store: f.a.store, mealId: meal.mealId, requestKey: settleKey, paymentMethod: 'KHQR', expectedAmount: '1.20', expectedVersion: current.version, manualPaymentConfirmed: true }
  const paid = await settleMeal(db, f.a.scope, f.owner, base)
  assert.equal((await settleMeal(db, f.a.scope, f.owner, base)).payment.paymentIntentId, paid.payment.paymentIntentId)
  for (const changed of [{ expectedVersion: current.version + 1 }, { expectedVersion: current.version - 1 }, { expectedAmount: '1.21' }, { paymentMethod: 'CASH' }, { manualPaymentConfirmed: false }]) {
    await refused(settleMeal(db, f.a.scope, f.owner, { ...base, ...changed }), 'REQUEST_KEY_REUSED')
  }
  assert.equal((await counts(f)).payments, 1)
})

test('refund after settlement still goes through the existing sales route and leaves the meal as it was', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const sales = await import('../app/api/sales/route')
  const meal = await open(f)
  const ordered = (await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 2 }, { barcode: f.drink.barcode, quantity: 1 }])).meal
  const paid = await settle(f, ordered)
  const rice = paid.meal.batches[0].lines.find((line) => line.name === 'Fried rice')!
  const ownerAccount = r.account(f.tenantId, f.a.id, f.owner.userId, 'OWNER')
  const refund = (refundQty: number) => r.call(sales.POST, { headers: ownerAccount, body: { saleType: 'REFUND', originalSaleRecordId: rice.saleRecordId, refundQty, refundReason: 'cold' } })

  for (const state of ['PAID', 'CLOSED'] as const) {
    if (state === 'CLOSED') await clearMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
    const before = await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } })
    const done = await refund(1)
    assert.ok(done.status >= 200 && done.status < 300, JSON.stringify(done))
    assert.deepEqual(await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } }), before)
    assert.equal(before.state, state)
  }
  const tooMany = await refund(1)
  assert.deepEqual([tooMany.status, tooMany.body.error], [422, 'REFUND_QTY_EXCEEDED'])

  const refunds = await db.saleRecord.findMany({ where: { tenantId: f.tenantId, saleType: 'REFUND' } })
  assert.deepEqual(refunds.map((row) => [row.originalSaleRecordId, row.status, row.diningBatchId, row.lineAmount.toFixed(2), row.orderNo === ordered.billNo]), [[rice.saleRecordId, 'COMPLETED', null, '-3.50', false], [rice.saleRecordId, 'COMPLETED', null, '-3.50', false]])
  // The original rows and the one payment are untouched; the bill view still shows what was sold and paid.
  const original = await db.saleRecord.findUniqueOrThrow({ where: { id: rice.saleRecordId } })
  assert.deepEqual([original.status, original.quantity.toFixed(0), original.diningBatchId], ['COMPLETED', '2', paid.meal.batches[0].id])
  const payments = await db.paymentIntent.findMany({ where: { tenantId: f.tenantId } })
  assert.deepEqual(payments.map((payment) => [payment.status, payment.amount.toFixed(2)]), [['PAID', '8.20']])
  const view = await getMealView(db, f.a.scope, meal.mealId)
  assert.deepEqual([view.state, view.payment?.amount, view.batches.length, view.batches[0].lines.length], ['CLOSED', '8.20', 1, 2])
})

// ── r4: external payment and line voids; print evidence; recovery list without a time window ──

test('void lines: a payment that was taken or is being taken on the bill refuses the void and changes nothing; a dead attempt does not', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const owner = r.device(f.tenantId, f.a)
  const meal = await open(f)
  const soupBarcode = (await db.product.findFirstOrThrow({ where: { tenantId: f.tenantId, name: 'Noodle soup' } })).barcode
  const ordered = (await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }, { barcode: f.drink.barcode, quantity: 2 }, { barcode: soupBarcode, quantity: 1 }])).meal
  const [rice, cola, soup] = ['Fried rice', 'Cola', 'Noodle soup'].map((name) => ordered.batches[0].lines.find((line) => line.name === name)!)
  const snapshot = async () => JSON.stringify({
    meal: await db.diningMeal.findUniqueOrThrow({ where: { id: meal.mealId } }),
    batches: await db.diningBatch.findMany({ where: { mealId: meal.mealId }, orderBy: { seq: 'asc' } }),
    sales: await db.saleRecord.findMany({ where: { orderNo: ordered.billNo! }, orderBy: { recordNo: 'asc' } }),
    payments: await db.paymentIntent.findMany({ where: { orderNo: ordered.billNo! } }),
    voids: await db.diningVoidLine.findMany({ where: { mealId: meal.mealId } }),
  })
  const voidCola = (requestKey = key()) => voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey, lines: [{ saleRecordId: cola.saleRecordId, quantity: 2 }], reason: 'guest left' })
  const external = (status: 'PENDING' | 'PAID' | 'CANCELLED' | 'FAILED' | 'EXPIRED') => db.paymentIntent.create({ data: {
    ...f.a.scope, operatorUserId: f.owner.userId, orderNo: ordered.billNo!, paymentMethod: 'KHQR', status, amount: '10.15', paidAt: status === 'PAID' ? new Date() : null,
  } })

  // A payment in progress (what a legacy KHQR checkout during an application rollback leaves) and a payment taken.
  for (const status of ['PENDING', 'PAID'] as const) {
    const payment = await external(status)
    const before = await snapshot()
    const refusal = await refused(voidCola(), 'EXTERNAL_PAYMENT_EXISTS', 409)
    assert.deepEqual(refusal.details, { paymentIntentId: payment.id, status })
    assert.equal(await snapshot(), before, status)
    // Through the route: the same refusal, with a FAILED audit row that carries no amount.
    const viaRoute = await r.call(r.handlers.batches.POST, { storeCode: f.a.code, headers: owner, params: { id: meal.mealId }, body: { type: 'VOID', requestKey: key(), reason: 'x', lines: [{ saleRecordId: rice.saleRecordId, quantity: 1 }] } })
    assert.deepEqual([viaRoute.status, viaRoute.body.error, viaRoute.body.details.status], [409, 'EXTERNAL_PAYMENT_EXISTS', status])
    assert.equal(await snapshot(), before, `${status} via route`)
    await db.paymentIntent.delete({ where: { id: payment.id } })
  }
  const failedAudit = await db.operationLog.findMany({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_VOID_LINES', status: 'FAILED' } })
  assert.deepEqual(failedAudit.map((entry) => entry.message), ['EXTERNAL_PAYMENT_EXISTS', 'EXTERNAL_PAYMENT_EXISTS'])
  assert.ok(failedAudit.every((entry) => !/amount|price|\d\.\d\d/i.test(JSON.stringify(entry.payloadSnapshot))))
  assert.deepEqual([await db.diningVoidLine.count({ where: { mealId: meal.mealId } }), await db.diningBatch.count({ where: { mealId: meal.mealId, kind: 'VOID' } })], [0, 0])

  // A payment attempt that ended without money is not a reason to stop ordinary handling of the bill.
  const voidedIds: string[] = []
  for (const [status, line] of [['CANCELLED', cola], ['FAILED', rice], ['EXPIRED', soup]] as const) {
    const dead = await external(status)
    const done = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: line.saleRecordId, quantity: line.quantity }], reason: 'guest left' })
    assert.equal(done.replayed, false)
    voidedIds.push(line.saleRecordId)
    await db.paymentIntent.delete({ where: { id: dead.id } })
  }
  const rows = await db.saleRecord.findMany({ where: { id: { in: voidedIds } } })
  assert.deepEqual(rows.map((row) => row.status), ['CANCELLED', 'CANCELLED', 'CANCELLED'])
  assert.equal(await db.diningVoidLine.count({ where: { mealId: meal.mealId } }), 3)
  // A request that was committed before a payment appeared still answers with its own result.
  const committedKey = key()
  const other = await open(f, f.table2Id)
  const otherOrder = (await order(f, other.mealId, [{ barcode: f.drink.barcode, quantity: 1 }, { barcode: f.food.barcode, quantity: 1 }])).meal
  const input = { mealId: other.mealId, requestKey: committedKey, lines: [{ saleRecordId: otherOrder.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'x' }
  const committed = await voidLines(db, f.a.scope, f.owner, input)
  await db.paymentIntent.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, orderNo: otherOrder.billNo!, paymentMethod: 'CASH', status: 'PAID', amount: '1.20', paidAt: new Date() } })
  const replay = await voidLines(db, f.a.scope, f.owner, input)
  assert.deepEqual([replay.replayed, replay.batchId], [true, committed.batchId])
  await refused(voidLines(db, f.a.scope, f.owner, { ...input, requestKey: key(), lines: [{ saleRecordId: otherOrder.batches[0].lines[1].saleRecordId, quantity: 1 }] }), 'EXTERNAL_PAYMENT_EXISTS')
})

test('print evidence: a page saying "sent" is never enough; only the print job row is, for every reader', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const meal = await open(f)
  const first = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: first.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: first.batchId, outcome: 'CROSSED' })
  await cloudPrinted(f, first.meal.billNo, first.seq)
  // The dish is voided; the void notice is taken by a page that then reports CROSSED.
  const voided = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: first.meal.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'x' })
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId, outcome: 'CROSSED' })
  await voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  const printOrderNo = diningNoticePrintOrderNo(first.meal.billNo!, voided.seq)
  const jobKey = canonicalV3OriginalPrintJobId(printOrderNo, 'KITCHEN')

  // Every reader: the command layer on two independent connections, the route as the store's device, the route as a staff account.
  const readers = {
    connectionA: async () => (await getMealView(worker(0), f.a.scope, meal.mealId)).batches[1].notice,
    connectionB: async () => (await getMealView(worker(1), f.a.scope, meal.mealId)).batches[1].notice,
    device: async () => (await r.call(r.handlers.session.GET, { method: 'GET', storeCode: f.a.code, headers: r.device(f.tenantId, f.a), params: { id: meal.mealId } })).body.meal.batches[1].notice,
    staffAccount: async () => (await r.call(r.handlers.session.GET, { method: 'GET', storeCode: f.a.code, headers: r.account(f.tenantId, f.a.id, f.staff.userId, 'STAFF'), params: { id: meal.mealId } })).body.meal.batches[1].notice,
  }
  const everyone = async () => Object.fromEntries(await Promise.all(Object.entries(readers).map(async ([name, read]) => {
    const notice = await read()
    return [name, [notice.status, notice.canRenotify, notice.duplicateRisk]]
  })))
  const all = (value: unknown) => Object.fromEntries(Object.keys(readers).map((name) => [name, value]))
  const stillListed = async () => [
    (await recoverList(f.a.scope)).map((entry) => entry.voidNoticeSeqs),
    await hasActiveMeals(db, f.a.scope),
    (await getMealView(db, f.a.scope, meal.mealId)).noSendEvidence.voidSeqs,
    (await r.call(r.handlers.eligibility.GET, { method: 'GET', storeCode: f.a.code, headers: r.device(f.tenantId, f.a) })).body.hasActiveMeals,
  ]
  const pending = [[[2]], true, [2], true]
  const quiet = await counts(f)

  // 1. No job row at all (the print core's report has not arrived, or never will).
  assert.deepEqual(await everyone(), all(['UNKNOWN', true, true]))
  assert.deepEqual(await stillListed(), pending)
  // 2. A row exists but is not conclusive: taken by the device and not finished…
  const row = await db.eshopTrayPrintJob.create({ data: {
    ...f.a.scope, idempotencyKey: jobKey, requestHash: 'e'.repeat(64), schemaVersion: 3, payload: { schemaVersion: 3 }, status: 'PENDING', expiresAt: new Date(Date.now() + 60_000),
  } })
  assert.deepEqual(await everyone(), all(['UNKNOWN', true, true]))
  assert.deepEqual(await stillListed(), pending)
  // …or finished with an unknown crossing.
  await db.eshopTrayPrintJob.update({ where: { id: row.id }, data: { status: 'FAILED', resultStatus: 'CROSSING_UNKNOWN', effectBoundary: 'CROSSING_UNKNOWN', completedAt: new Date(), resultCode: 'TEST_FIXTURE' } })
  assert.deepEqual(await everyone(), all(['UNKNOWN', true, true]))
  assert.deepEqual(await stillListed(), pending)
  // 3. Conflict: the page said sent, the row says certainly not sent.
  await db.eshopTrayPrintJob.update({ where: { id: row.id }, data: { status: 'FAILED', resultStatus: 'FAILED_NOT_CROSSED', effectBoundary: 'NOT_CROSSED' } })
  assert.deepEqual(await everyone(), all(['UNKNOWN', true, true]))
  assert.deepEqual(await stillListed(), pending)
  // 4. Rows that look close to "printed" but are not the trusted shape: wrong schema version, no terminal evidence, another store.
  for (const almost of [
    { schemaVersion: 2, status: 'SUCCEEDED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: 'TEST_FIXTURE' },
    { schemaVersion: 3, status: 'SUCCEEDED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: null, resultCode: 'TEST_FIXTURE' },
    { schemaVersion: 3, status: 'SUCCEEDED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: null },
    { schemaVersion: 3, status: 'SUCCEEDED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: '' },
    { schemaVersion: 3, status: 'SUCCEEDED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSING_UNKNOWN', completedAt: new Date(), resultCode: 'TEST_FIXTURE' },
    { schemaVersion: 3, status: 'FAILED' as const, resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: 'TEST_FIXTURE' },
  ]) {
    await db.eshopTrayPrintJob.update({ where: { id: row.id }, data: almost })
    assert.equal((await readers.connectionA()).status === 'SENT', false, JSON.stringify(almost))
    assert.deepEqual(await stillListed(), pending, JSON.stringify(almost))
  }
  await db.eshopTrayPrintJob.create({ data: { ...f.b.scope, idempotencyKey: jobKey, requestHash: 'e'.repeat(64), schemaVersion: 3, payload: {}, status: 'SUCCEEDED', resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: 'X', expiresAt: new Date(Date.now() + 60_000) } })
  assert.deepEqual(await stillListed(), pending)
  // Through all of this nothing was created by the system: no batch, no re-notification, no print job of its own.
  const after = await counts(f)
  assert.deepEqual([after.batches, after.voids, after.sales, after.payments, after.printJobs - quiet.printJobs], [quiet.batches, quiet.voids, quiet.sales, quiet.payments, 2])
  assert.equal(await db.diningBatch.count({ where: { mealId: meal.mealId, kind: 'RENOTIFY' } }), 0)

  // 5. The trusted "printed" row: sent, for every reader at once; the meal leaves the list and the entrance closes.
  await db.eshopTrayPrintJob.update({ where: { id: row.id }, data: { schemaVersion: 3, status: 'SUCCEEDED', resultStatus: 'CROSSED', effectBoundary: 'CROSSED', completedAt: new Date(), resultCode: 'TEST_FIXTURE' } })
  assert.deepEqual(await everyone(), all(['SENT', true, true]))
  assert.deepEqual(await stillListed(), [[], false, [], false])
})

/** A meal on `tableId` that ended with a void notice nobody took: order sent, dish voided, table cancelled. */
async function endedWithUnsentVoidNotice(f: Fixture, tableId: string) {
  const db = admin()
  const meal = await open(f, tableId)
  const batch = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: batch.batchId })
  await cloudPrinted(f, batch.meal.billNo, batch.seq)
  const voided = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: batch.meal.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'x' })
  await voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  return { mealId: meal.mealId, billNo: batch.meal.billNo!, voidBatchId: voided.batchId, voidSeq: voided.seq }
}

test('recovery list: no time window, bounded pages with a cursor, and an entrance check that does not read the list', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const TOTAL = 55
  const hour = 60 * 60 * 1000
  const base = Date.now()
  const made: Awaited<ReturnType<typeof endedWithUnsentVoidNotice>>[] = []
  for (let i = 0; i < TOTAL; i += 1) {
    const one = await endedWithUnsentVoidNotice(f, f.tableId)
    // Newest first is index 0. Each is an hour older than the one before, so the list spans more than two days;
    // indexes 30 and 31 share one instant, to exercise the tie-break.
    await db.diningMeal.update({ where: { id: one.mealId }, data: { endedAt: new Date(base - (i === 31 ? 30 : i) * hour) } })
    made.push(one)
  }
  const ids = new Set(made.map((one) => one.mealId))

  // The entrance check is its own question to the database.
  assert.deepEqual([await hasActiveMeals(db, f.a.scope), await hasActiveMeals(db, f.b.scope), await hasActiveMeals(db, f.other.store.scope)], [true, false, false])
  assert.equal(await db.diningMeal.count({ where: { ...f.a.scope, state: { in: ['OPEN', 'PAID'] } } }), 0)

  // Pages: bounded, in order, no gap, no repeat, and an honest hasMore / nextCursor.
  const walk = async (limit?: number) => {
    const pages: Awaited<ReturnType<typeof listRecoverableMeals>>[] = []
    let cursor: string | null | undefined
    do {
      const page = await listRecoverableMeals(db, f.a.scope, { cursor, limit })
      pages.push(page)
      cursor = page.nextCursor
    } while (cursor)
    return pages
  }
  const pages = await walk()
  assert.deepEqual(pages.map((page) => [page.items.length, page.hasMore, page.nextCursor !== null]), [[20, true, true], [20, true, true], [15, false, false]])
  const listed = pages.flatMap((page) => page.items)
  assert.equal(new Set(listed.map((entry) => entry.mealId)).size, TOTAL)
  assert.ok(listed.every((entry) => ids.has(entry.mealId)))
  const expected = made.map((one, i) => ({ id: one.mealId, at: base - (i === 31 ? 30 : i) * hour }))
    .sort((x, y) => (y.at - x.at) || (x.id < y.id ? 1 : -1)).map((one) => one.id)
  assert.deepEqual(listed.map((entry) => entry.mealId), expected)
  // Far beyond 24 hours, and still there: the oldest entry is 54 hours old.
  assert.ok(base - Date.parse(listed.at(-1)!.endedAt) >= 54 * hour - 1)
  // What the database selects is exactly what the bill view computes: every listed meal has a void batch without sending evidence.
  assert.ok(listed.every((entry) => entry.voidNoticeSeqs.length === 1 && entry.state === 'VOIDED' && entry.tableName === 'T1'))
  // The page size is capped; a tie at the page boundary is neither lost nor repeated.
  assert.deepEqual((await walk(500)).map((page) => page.items.length), [50, 5])
  assert.deepEqual((await walk(31)).flatMap((page) => page.items.map((entry) => entry.mealId)), expected)
  assert.deepEqual((await walk(1)).length, TOTAL)

  // The list changes while someone is paging: an entry of page 1 gets sending evidence, an older one is re-sent without it.
  const page1 = pages[0]
  const resolved = made.find((one) => one.mealId === page1.items[4].mealId)!
  await claimNotice(db, f.a.scope, f.owner, { mealId: resolved.mealId, batchId: resolved.voidBatchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: resolved.mealId, batchId: resolved.voidBatchId, outcome: 'CROSSED' })
  assert.ok((await walk()).flatMap((page) => page.items.map((entry) => entry.mealId)).includes(resolved.mealId), 'a page report alone does not remove it')
  await cloudPrinted(f, resolved.billNo, resolved.voidSeq)
  const rest = await listRecoverableMeals(db, f.a.scope, { cursor: page1.nextCursor })
  assert.deepEqual(rest.items.map((entry) => entry.mealId), expected.slice(20, 40))
  const again = (await walk()).flatMap((page) => page.items.map((entry) => entry.mealId))
  assert.deepEqual(again, expected.filter((id) => id !== resolved.mealId))
  assert.deepEqual((await getMealView(db, f.a.scope, resolved.mealId)).noSendEvidence.voidSeqs, [])
  // Sending evidence on a manual re-notification resolves the void batch too.
  const viaResend = made.find((one) => one.mealId === expected[50])!
  await claimNotice(db, f.a.scope, f.owner, { mealId: viaResend.mealId, batchId: viaResend.voidBatchId })
  await reportNotice(db, f.a.scope, f.owner, { mealId: viaResend.mealId, batchId: viaResend.voidBatchId, outcome: 'FAILED_NOT_CROSSED' })
  const resend = await renotifyBatch(db, f.a.scope, f.staff, { mealId: viaResend.mealId, refBatchId: viaResend.voidBatchId, requestKey: key(), reason: 'printer was off' })
  await claimNotice(db, f.a.scope, f.staff, { mealId: viaResend.mealId, batchId: resend.batchId })
  assert.ok((await walk()).flatMap((page) => page.items.map((entry) => entry.mealId)).includes(viaResend.mealId))
  await cloudPrinted(f, viaResend.billNo, resend.seq)
  assert.ok(!(await walk()).flatMap((page) => page.items.map((entry) => entry.mealId)).includes(viaResend.mealId))
  assert.deepEqual((await getMealView(db, f.a.scope, viaResend.mealId)).noSendEvidence.voidSeqs, [])

  // Through the route: first page with the tables, following pages on their own, a bad cursor is an error.
  const owner = r.device(f.tenantId, f.a)
  const firstCall = await r.call(r.handlers.tables.GET, { method: 'GET', storeCode: f.a.code, headers: owner })
  assert.deepEqual([firstCall.status, firstCall.body.tables.length, firstCall.body.recoverable.items.length, firstCall.body.recoverable.hasMore], [200, 2, 20, true])
  const tablesGet = async (cursor: string) => {
    const { NextRequest } = await import('next/server')
    const res = await r.handlers.tables.GET(new NextRequest(`https://isolated.test/api/x?storeCode=${f.a.code}&recoverCursor=${encodeURIComponent(cursor)}`, { headers: owner }))
    return { status: res.status, body: await res.json() }
  }
  const nextCall = await tablesGet(firstCall.body.recoverable.nextCursor)
  assert.deepEqual([nextCall.status, Object.keys(nextCall.body), nextCall.body.recoverable.items.length], [200, ['recoverable'], 20])
  assert.equal(nextCall.body.recoverable.items[0].mealId, again[20])
  for (const bad of ['not-a-cursor', Buffer.from('["yesterday","x"]').toString('base64url'), Buffer.from('{"a":1}').toString('base64url'), 'x'.repeat(500),
    Buffer.from('["+275760-09-13T00:00:00.000Z","x"]').toString('base64url'), Buffer.from('["-000001-01-01T00:00:00.000Z","x"]').toString('base64url'),
    Buffer.from(JSON.stringify(['2026-10-10T00:00:00.000Z', 'a\u0000b'])).toString('base64url'), Buffer.from(JSON.stringify(['2026-10-10T00:00:00.000Z', "x'; DROP TABLE \"DiningMeal\"; --"])).toString('base64url')]) {
    const refusedCall = await tablesGet(bad)
    assert.deepEqual([refusedCall.status, refusedCall.body.error], [400, 'RECOVER_CURSOR_INVALID'], bad.slice(0, 20))
  }
  await refused(listRecoverableMeals(db, f.a.scope, { cursor: 42 }), 'RECOVER_CURSOR_INVALID', 400)
  // Another store's cursor shows nothing of this store, and this store's list shows nothing to another store.
  assert.deepEqual((await listRecoverableMeals(db, f.b.scope, { cursor: page1.nextCursor })).items, [])
  assert.deepEqual((await listRecoverableMeals(db, f.other.store.scope)).items, [])

  // The entrance check does not depend on any page: one single waiting meal, ended more than a year ago, in a store of its own.
  const lone = await db.store.create({ data: { tenantId: f.tenantId, code: `DIL${randomUUID().slice(0, 6).toUpperCase()}`, name: 'lone', businessType: 'FOOD', printKitchenTicket: true } })
  const loneFx: Fixture = { ...f, a: { id: lone.id, code: lone.code, scope: { tenantId: f.tenantId, storeId: lone.id }, store: { code: lone.code, printKitchenTicket: true, currencyCode: 'USD' } } }
  const loneTable = await db.diningTable.create({ data: { ...loneFx.a.scope, name: 'L1' } })
  const old = await endedWithUnsentVoidNotice(loneFx, loneTable.id)
  await db.diningMeal.update({ where: { id: old.mealId }, data: { endedAt: new Date(base - 400 * 24 * hour) } })
  assert.equal(await hasActiveMeals(db, loneFx.a.scope), true)
  assert.deepEqual((await listRecoverableMeals(db, loneFx.a.scope)).items.map((entry) => [entry.mealId, entry.voidNoticeSeqs]), [[old.mealId, [2]]])
  // The bill of such an old meal is still an ordinary business query.
  const oldView = await getMealView(db, loneFx.a.scope, old.mealId)
  assert.deepEqual([oldView.state, oldView.batches.length, oldView.noSendEvidence.voidSeqs], ['VOIDED', 2, [2]])
})

test('recovery list: the SQL job key and "printed" condition are the ones the TypeScript classifier uses', { skip }, async () => {
  const db = admin()
  for (const [billNo, seq] of [['S-20261010-STORE-0001', 2], ['S-20261010-DIabc.x_y:z-0042', 17], ['A', 1]] as const) {
    const rows = await db.$queryRaw<{ key: string }[]>`
      SELECT 'network:' || encode(sha256(convert_to('cashier-network-v2:' || ${billNo} || '.' || ${seq}::int || ':KITCHEN', 'UTF8')), 'hex') AS key`
    assert.equal(rows[0].key, canonicalV3OriginalPrintJobId(diningNoticePrintOrderNo(billNo, seq), 'KITCHEN'))
  }
})

test('stale notices: an identity nobody took in time is never handed out; the meal stays queryable; a person re-sends under a new identity', { skip }, async () => {
  const f = await fixture(), db = admin()
  const age = (batchId: string, minutes: number) => db.diningBatch.update({ where: { id: batchId }, data: { createdAt: new Date(Date.now() - minutes * 60_000) } })
  const notice = async (mealId: string, seq: number) => {
    const view = (await getMealView(db, f.a.scope, mealId)).batches[seq - 1].notice
    return [view.status, view.canClaim, view.canRenotify, view.duplicateRisk]
  }
  const meal = await open(f)
  const first = await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: first.batchId })
  await cloudPrinted(f, first.meal.billNo, first.seq)
  const voided = await voidLines(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key(), lines: [{ saleRecordId: first.meal.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'x' })

  // Inside the window the void notice can be taken; just past it, it cannot — and nothing is written by the attempt.
  await age(voided.batchId, 29)
  assert.deepEqual(await notice(meal.mealId, 2), ['PENDING_SUBMIT', true, false, false])
  // Taken at minute 29, an identity gets the one minute that is left of its batch's window, not a fresh half hour.
  const lateTable = await db.diningTable.create({ data: { ...f.a.scope, name: 'T3' } })
  const lateMeal = await open(f, lateTable.id)
  const lateOrder = await order(f, lateMeal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await age(lateOrder.batchId, 29)
  const lateClaim = await claimNotice(db, f.a.scope, f.owner, { mealId: lateMeal.mealId, batchId: lateOrder.batchId })
  assert.ok(lateClaim.claimed)
  const left = Date.parse(lateClaim.notice.expiresAt) - Date.now()
  assert.ok(left > 0 && left <= 61_000, String(left))
  await age(voided.batchId, 31)
  assert.deepEqual(await notice(meal.mealId, 2), ['NOT_SENT', false, true, false])
  const before = await counts(f)
  const attempt = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId })
  assert.deepEqual([attempt.claimed, 'status' in attempt && attempt.status], [false, 'NOT_SENT'])
  const row = await db.diningBatch.findUniqueOrThrow({ where: { id: voided.batchId } })
  assert.deepEqual([row.noticeClaimedAt, row.noticeContentDigest, row.noticeWithdrawnAt], [null, null, null])
  assert.deepEqual(await counts(f), before)
  assert.equal(await db.operationLog.count({ where: { tenantId: f.tenantId, actionType: 'DINE_IN_NOTICE_CLAIM', targetId: voided.batchId } }), 0)

  // The table is cancelled; days later the meal is still listed and its bill still opens.
  await voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  await db.diningMeal.update({ where: { id: meal.mealId }, data: { endedAt: new Date(Date.now() - 3 * 24 * 60 * 60_000) } })
  await age(voided.batchId, 3 * 24 * 60)
  assert.deepEqual((await recoverList(f.a.scope)).map((entry) => [entry.mealId, entry.voidNoticeSeqs]), [[meal.mealId, [2]]])
  assert.deepEqual(await notice(meal.mealId, 2), ['NOT_SENT', false, true, false])
  const stillRefused = await claimNotice(db, f.a.scope, f.owner, { mealId: meal.mealId, batchId: voided.batchId })
  assert.equal(stillRefused.claimed, false)
  // A person re-sends: no duplicate warning is needed (the old identity was certainly never sent), and the identity is new.
  const resend = await renotifyBatch(db, f.a.scope, f.staff, { mealId: meal.mealId, refBatchId: voided.batchId, requestKey: key(), reason: 'kitchen still needs to know' })
  assert.equal(resend.seq, 3)
  const claim = await claimNotice(db, f.a.scope, f.staff, { mealId: meal.mealId, batchId: resend.batchId })
  assert.ok(claim.claimed)
  assert.deepEqual([claim.notice.printOrderNo, claim.notice.content.kind, claim.notice.content.subject, claim.notice.content.lines.map((line) => line.name)], [`${first.meal.billNo}.3`, 'RENOTIFY', 'VOID', ['Fried rice']])
  assert.notEqual(claim.notice.printJobId, canonicalV3OriginalPrintJobId(`${first.meal.billNo}.2`, 'KITCHEN'))
  // The new identity has its own full window, counted from the re-notification batch, not from the old one.
  assert.ok(Date.parse(claim.notice.expiresAt) > Date.now() + 29 * 60_000)
  await cloudPrinted(f, first.meal.billNo, resend.seq)
  assert.deepEqual(await recoverList(f.a.scope), [])
  // The old identity never got a print job row, from this module or the fixture.
  assert.equal(await db.eshopTrayPrintJob.count({ where: { ...f.a.scope, idempotencyKey: canonicalV3OriginalPrintJobId(`${first.meal.billNo}.2`, 'KITCHEN') } }), 0)

  // A re-notification that itself went stale does not block the next one; a taken notice is never made stale by age.
  const second = await endedWithUnsentVoidNotice(f, f.table2Id)
  await age(second.voidBatchId, 45)
  const r1 = await renotifyBatch(db, f.a.scope, f.staff, { mealId: second.mealId, refBatchId: second.voidBatchId, requestKey: key(), reason: 'again' })
  await refused(renotifyBatch(db, f.a.scope, f.staff, { mealId: second.mealId, refBatchId: second.voidBatchId, requestKey: key(), reason: 'again' }), 'RENOTIFY_ALREADY_PENDING')
  await age(r1.batchId, 45)
  assert.equal((await claimNotice(db, f.a.scope, f.staff, { mealId: second.mealId, batchId: r1.batchId })).claimed, false)
  const r2 = await renotifyBatch(db, f.a.scope, f.staff, { mealId: second.mealId, refBatchId: second.voidBatchId, requestKey: key(), reason: 'again' })
  const taken = await claimNotice(db, f.a.scope, f.staff, { mealId: second.mealId, batchId: r2.batchId })
  assert.ok(taken.claimed)
  await age(r2.batchId, 600)
  assert.deepEqual(await notice(second.mealId, r2.seq), ['UNKNOWN', false, false, false])
  await cloudPrinted(f, second.billNo, r2.seq)
  assert.equal((await getMealView(db, f.a.scope, second.mealId)).batches[r2.seq - 1].notice.status, 'SENT')

  // The same rule while a meal is open: a cooking notice nobody took in time is not sent under its old identity either,
  // and a dish of it can be voided without telling a kitchen that was never told.
  const openMealFx = await open(f, f.table2Id)
  const late = await order(f, openMealFx.mealId, [{ barcode: f.food.barcode, quantity: 1 }])
  await age(late.batchId, 31)
  assert.deepEqual(await notice(openMealFx.mealId, 1), ['NOT_SENT', false, true, false])
  // The table card keeps saying a kitchen notice has not gone out, however old it is.
  assert.equal((await listTables(db, f.a.scope)).find((table) => table.id === f.table2Id)?.meal?.pendingNoticeCount, 1)
  const lateVoid = await voidLines(db, f.a.scope, f.owner, { mealId: openMealFx.mealId, requestKey: key(), lines: [{ saleRecordId: late.meal.batches[0].lines[0].saleRecordId, quantity: 1 }], reason: 'x' })
  assert.equal(lateVoid.meal.batches[lateVoid.seq - 1].notice.status, 'NOT_REQUIRED')
})

// ── Tables ──────────────────────────────────────────────────────────────────

test('tables: owner maintenance, name uniqueness, and no disabling a table that is in use', { skip }, async () => {
  const f = await fixture(), db = admin()
  await refused(saveTable(db, f.a.scope, f.staff, { name: 'S1' }), 'OWNER_REQUIRED', 403)
  const created = await saveTable(db, f.a.scope, f.owner, { name: ' Room 8 ', areaKind: 'ROOM', sortOrder: 5 })
  assert.deepEqual([created.name, created.areaKind, created.sortOrder, created.isActive], ['Room 8', 'ROOM', 5, true])
  await refused(saveTable(db, f.a.scope, f.owner, { name: 'T1' }), 'TABLE_NAME_TAKEN')
  await refused(saveTable(db, f.a.scope, f.owner, { name: '' }), 'TABLE_NAME_INVALID', 400)
  await refused(saveTable(db, f.b.scope, f.owner, { tableId: created.id, name: 'stolen' }), 'TABLE_NOT_FOUND', 404)
  assert.equal((await saveTable(db, f.b.scope, f.owner, { name: 'T1' })).name, 'T1')

  const renamed = await saveTable(db, f.a.scope, f.owner, { tableId: created.id, name: 'Room 9', areaKind: 'HALL', sortOrder: 1 })
  assert.deepEqual([renamed.name, renamed.areaKind, renamed.sortOrder], ['Room 9', 'HALL', 1])
  const meal = await open(f, created.id)
  await refused(saveTable(db, f.a.scope, f.owner, { tableId: created.id, isActive: false }), 'TABLE_OCCUPIED')
  await voidMeal(db, f.a.scope, f.owner, { mealId: meal.mealId, requestKey: key() })
  assert.equal((await saveTable(db, f.a.scope, f.owner, { tableId: created.id, isActive: false })).isActive, false)
  await refused(openMeal(db, f.a.scope, f.owner, { tableId: created.id, guestCount: 1, requestKey: key() }), 'TABLE_INACTIVE')

  const occupied = await open(f)
  await order(f, occupied.mealId, [{ barcode: f.food.barcode, quantity: 2 }])
  const listed = await listTables(db, f.a.scope)
  const t1 = listed.find((table) => table.name === 'T1')!
  assert.deepEqual([t1.meal?.state, t1.meal?.unpaidAmount, t1.meal?.batchCount, t1.meal?.pendingNoticeCount, t1.meal?.guestCount], ['OPEN', '7.00', 1, 1, 2])
  assert.equal(listed.find((table) => table.name === 'T2')!.meal, null)
  assert.equal((await listTables(db, f.b.scope)).length, 1)
})

// ── Route level: gates, roles, isolation, legacy guards, audit ──────────────

type Call = { status: number; body: any }
async function routes() {
  ;(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage
  const { NextRequest } = await import('next/server')
  // The legacy order routes schedule work with next/server `after`; give it the request scope it expects.
  const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external')
  const { signPosDeviceToken } = await import('../lib/desktop-pos-auth')
  const load = async (path: string) => await import(path)
  const handlers = {
    eligibility: await load('../app/api/dine-in/eligibility/route'),
    tables: await load('../app/api/dine-in/tables/route'),
    sessions: await load('../app/api/dine-in/sessions/route'),
    session: await load('../app/api/dine-in/sessions/[id]/route'),
    batches: await load('../app/api/dine-in/sessions/[id]/batches/route'),
    renotify: await load('../app/api/dine-in/sessions/[id]/batches/[batchId]/renotify/route'),
    settle: await load('../app/api/dine-in/sessions/[id]/settle/route'),
    close: await load('../app/api/dine-in/sessions/[id]/close/route'),
    claim: await load('../app/api/dine-in/sessions/[id]/kitchen/claim/route'),
    report: await load('../app/api/dine-in/sessions/[id]/kitchen/report/route'),
    legacyCheckout: await load('../app/api/orders/[orderNo]/checkout/route'),
    legacyCancel: await load('../app/api/orders/[orderNo]/cancel/route'),
  }
  const call = async (handler: (req: any, ctx: any) => Promise<Response>, input: { method?: string; storeCode?: string; headers?: Record<string, string>; body?: unknown; params?: Record<string, string> }): Promise<Call> => {
    const url = `https://isolated.test/api/x${input.storeCode ? `?storeCode=${encodeURIComponent(input.storeCode)}` : ''}`
    const init = { method: input.method ?? 'POST', headers: { 'content-type': 'application/json', ...(input.headers ?? {}) }, ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) }
    return workAsyncStorage.run({ afterContext: { after: () => {} } } as never, async () => {
      const res = await handler(new NextRequest(url, init), { params: Promise.resolve(input.params ?? {}) })
      return { status: res.status, body: await res.json() }
    })
  }
  const device = (tenantId: string, store: StoreFx, marker = true): Record<string, string> => {
    const deviceId = `dev-${store.code}`
    return {
      ...(marker ? { 'x-lightops-client': 'desktop-pos', 'x-pos-operator-source': 'DEVICE' } : {}),
      'x-pos-device-id': deviceId,
      'x-pos-device-token': signPosDeviceToken({ tenantId, storeId: store.id, storeCode: store.code, deviceId, issuedBy: 'test' }),
    }
  }
  const account = (tenantId: string, storeId: string, userId: string, role: 'OWNER' | 'STAFF'): Record<string, string> => ({
    'x-lightops-client': 'desktop-pos', 'x-pos-operator-source': 'ACCOUNT',
    'x-tenant-id': tenantId, 'x-store-id': storeId, 'x-user-id': userId, 'x-role': role,
  })
  return { handlers, call, device, account }
}

test('routes: new-business gate versus recovery gate, condition by condition', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  const owner = r.device(f.tenantId, f.a)
  const code = f.a.code
  const trial = (on: boolean) => { process.env.DINE_IN_TRIAL_STORE_CODES = on ? `OTHER, ${code} ,X` : 'OTHER' }
  const openBody = (tableId = f.tableId) => ({ tableId, guestCount: 2, requestKey: key() })
  const eligibility = async (headers = owner) => (await r.call(r.handlers.eligibility.GET, { method: 'GET', storeCode: code, headers })).body

  trial(true)
  assert.deepEqual([(await eligibility()).eligible, (await eligibility()).reasons, (await eligibility()).hasActiveMeals, (await eligibility()).role, (await eligibility()).operatorSource], [true, [], false, 'OWNER', 'DEVICE'])
  const firstOpenBody = openBody()
  const opened = await r.call(r.handlers.sessions.POST, { storeCode: code, headers: owner, body: firstOpenBody })
  assert.equal(opened.status, 201)
  const mealId = opened.body.mealId
  const params = { id: mealId }
  const firstOrderBody = { type: 'ORDER', requestKey: key(), items: [{ barcode: f.food.barcode, quantity: 1 }, { barcode: f.drink.barcode, quantity: 1 }] }
  const ordered = await r.call(r.handlers.batches.POST, { storeCode: code, headers: owner, params, body: firstOrderBody })
  assert.equal(ordered.status, 201)
  assert.equal((await eligibility()).hasActiveMeals, true)

  // Each new-business condition, removed one at a time: no open, no order — and the bill stays fully workable.
  const blocked = async (reason: string, headers = owner) => {
    const open = await r.call(r.handlers.sessions.POST, { storeCode: code, headers, body: openBody(f.table2Id) })
    assert.deepEqual([open.status, open.body.error, open.body.details.reasons], [403, 'DINE_IN_NEW_BUSINESS_UNAVAILABLE', [reason]])
    const add = await r.call(r.handlers.batches.POST, { storeCode: code, headers, params, body: { type: 'ORDER', requestKey: key(), items: [{ barcode: f.drink.barcode, quantity: 1 }] } })
    assert.deepEqual([add.status, add.body.error], [403, 'DINE_IN_NEW_BUSINESS_UNAVAILABLE'])
    const table = await r.call(r.handlers.tables.POST, { storeCode: code, headers, body: { name: `blocked-${reason}` } })
    assert.equal(table.status, 403)
    // Requests that had already been committed still answer with their result while the gate is closed.
    const openAgain = await r.call(r.handlers.sessions.POST, { storeCode: code, headers, body: firstOpenBody })
    assert.deepEqual([openAgain.status, openAgain.body.mealId, openAgain.body.replayed], [200, mealId, true])
    const orderAgain = await r.call(r.handlers.batches.POST, { storeCode: code, headers, params, body: firstOrderBody })
    assert.deepEqual([orderAgain.status, orderAgain.body.batchId, orderAgain.body.replayed], [200, ordered.body.batchId, true])
    const changed = await r.call(r.handlers.batches.POST, { storeCode: code, headers, params, body: { ...firstOrderBody, items: [{ barcode: f.food.barcode, quantity: 9 }] } })
    assert.deepEqual([changed.status, changed.body.error], [409, 'REQUEST_KEY_REUSED'])
    const state = await eligibility(headers)
    assert.deepEqual([state.eligible, state.reasons, state.recoveryAvailable, state.hasActiveMeals], [false, [reason], true, true])
    assert.equal((await r.call(r.handlers.session.GET, { method: 'GET', storeCode: code, headers, params })).status, 200)
    assert.equal((await r.call(r.handlers.tables.GET, { method: 'GET', storeCode: code, headers })).status, 200)
  }
  trial(false); await blocked('STORE_NOT_IN_TRIAL'); trial(true)
  delete process.env.DINE_IN_TRIAL_STORE_CODES; await blocked('STORE_NOT_IN_TRIAL'); trial(true)
  await db.store.update({ where: { id: f.a.id }, data: { businessType: 'RETAIL' } }); await blocked('BUSINESS_TYPE_NOT_FOOD')
  await db.store.update({ where: { id: f.a.id }, data: { businessType: 'FOOD' } })
  await db.v3PrintControlPlane.update({ where: { storeId: f.a.id }, data: { mode: 'V2_ACTIVE' } }); await blocked('V3_LOCAL_MODE_REQUIRED')
  await db.v3PrintControlPlane.delete({ where: { storeId: f.a.id } }); await blocked('V3_LOCAL_MODE_REQUIRED')
  await db.v3PrintControlPlane.create({ data: { ...f.a.scope, mode: 'V3_ACTIVE' } })
  await blocked('DESKTOP_REQUEST_REQUIRED', r.device(f.tenantId, f.a, false))
  await db.v3PrintControlPlane.update({ where: { storeId: f.a.id }, data: { mode: 'V3_DRAINING' } })

  // With the print mode still off, every recovery action works end to end: claim, report, re-notify, void, settle, clear.
  const view = (await r.call(r.handlers.session.GET, { method: 'GET', storeCode: code, headers: owner, params })).body.meal as DiningMealView
  const batchId = view.batches[0].id
  const claim = await r.call(r.handlers.claim.POST, { storeCode: code, headers: owner, params, body: { batchId } })
  assert.deepEqual([claim.status, claim.body.claimed, claim.body.notice.content.lines.length], [200, true, 1])
  assert.equal((await r.call(r.handlers.claim.POST, { storeCode: code, headers: owner, params, body: { batchId } })).body.notice, undefined)
  assert.deepEqual((await r.call(r.handlers.report.POST, { storeCode: code, headers: owner, params, body: { batchId, outcome: 'V2_FALLBACK_REQUIRED' } })).body.recorded, true)
  const noAck = await r.call(r.handlers.renotify.POST, { storeCode: code, headers: owner, params: { ...params, batchId }, body: { requestKey: key(), reason: 'again' } })
  assert.deepEqual([noAck.status, noAck.body.error], [409, 'DUPLICATE_RISK_NOT_ACCEPTED'])
  assert.equal((await r.call(r.handlers.renotify.POST, { storeCode: code, headers: owner, params: { ...params, batchId }, body: { requestKey: key(), reason: 'again', duplicateRiskAccepted: true } })).status, 201)
  const drink = view.batches[0].lines.find((line) => !line.kitchen)!
  assert.equal((await r.call(r.handlers.batches.POST, { storeCode: code, headers: owner, params, body: { type: 'VOID', requestKey: key(), reason: 'no cola', lines: [{ saleRecordId: drink.saleRecordId, quantity: 1 }] } })).status, 201)
  const current = (await r.call(r.handlers.session.GET, { method: 'GET', storeCode: code, headers: owner, params })).body.meal as DiningMealView
  const wrong = await r.call(r.handlers.settle.POST, { storeCode: code, headers: owner, params, body: { requestKey: key(), paymentMethod: 'CASH', expectedAmount: '4.70', expectedVersion: current.version } })
  assert.deepEqual([wrong.status, wrong.body.error, wrong.body.details], [409, 'BILL_CHANGED', { amount: '3.50', version: current.version }])
  const settleBody = { requestKey: key(), paymentMethod: 'CASH', expectedAmount: current.unpaidAmount, expectedVersion: current.version }
  // Batch 1 was handed out with an unknown result and its re-notification has not been sent: there is no evidence
  // that batch 1 was sent. The payment is taken all the same, and says so.
  assert.deepEqual(current.pendingNoticeSeqs, [2])
  const paid = await r.call(r.handlers.settle.POST, { storeCode: code, headers: owner, params, body: settleBody })
  assert.deepEqual([paid.status, paid.body.payment.amount, paid.body.meal.state, paid.body.kitchenWarnings], [200, '3.50', 'PAID', { orderSeqs: [1], voidSeqs: [] }])
  assert.equal((await r.call(r.handlers.close.POST, { storeCode: code, headers: owner, params, body: { requestKey: key() } })).body.state, 'CLOSED')
  assert.equal((await eligibility()).hasActiveMeals, false)

  // Refusals that matter leave a FAILED audit row; every committed action left a SUCCESS row.
  const logs = await db.operationLog.findMany({ where: { tenantId: f.tenantId, actionType: { startsWith: 'DINE_IN_' } }, orderBy: { createdAt: 'asc' } })
  const failed = logs.filter((log) => log.status === 'FAILED').map((log) => [log.actionType, log.message])
  assert.deepEqual(failed, [['DINE_IN_RENOTIFY', 'DUPLICATE_RISK_NOT_ACCEPTED'], ['DINE_IN_SETTLE', 'BILL_CHANGED']])
  assert.deepEqual([...new Set(logs.filter((log) => log.status === 'SUCCESS').map((log) => log.actionType))].sort(), ['DINE_IN_CLEAR', 'DINE_IN_NOTICE_CLAIM', 'DINE_IN_NOTICE_REPORT', 'DINE_IN_OPEN', 'DINE_IN_ORDER', 'DINE_IN_RENOTIFY', 'DINE_IN_SETTLE', 'DINE_IN_VOID_LINES'])
  assert.ok(logs.every((log) => log.storeId === f.a.id && log.userId === f.owner.userId))
  // Audit snapshots, refused ones included, carry no amounts: money has exactly one home.
  assert.ok(logs.every((log) => !/amount|price|\d\.\d\d/i.test(JSON.stringify(log.payloadSnapshot))), JSON.stringify(logs.map((log) => log.payloadSnapshot)))

  // A disabled store: nothing at all, through any dine-in entry.
  await db.v3PrintControlPlane.update({ where: { storeId: f.a.id }, data: { mode: 'V3_ACTIVE' } })
  const second = await r.call(r.handlers.sessions.POST, { storeCode: code, headers: owner, body: openBody(f.table2Id) })
  assert.equal(second.status, 201)
  await db.store.update({ where: { id: f.a.id }, data: { status: 'DISABLED' } })
  const p2 = { id: second.body.mealId }
  for (const attempt of [
    r.call(r.handlers.session.GET, { method: 'GET', storeCode: code, headers: owner, params: p2 }),
    r.call(r.handlers.tables.GET, { method: 'GET', storeCode: code, headers: owner }),
    r.call(r.handlers.sessions.POST, { storeCode: code, headers: owner, body: openBody() }),
    r.call(r.handlers.batches.POST, { storeCode: code, headers: owner, params: p2, body: { type: 'ORDER', requestKey: key(), items: [{ barcode: f.drink.barcode, quantity: 1 }] } }),
    r.call(r.handlers.batches.POST, { storeCode: code, headers: owner, params: p2, body: { type: 'VOID', requestKey: key(), reason: 'x', lines: [{ saleRecordId: 'x', quantity: 1 }] } }),
    r.call(r.handlers.settle.POST, { storeCode: code, headers: owner, params: p2, body: { requestKey: key(), paymentMethod: 'CASH', expectedAmount: '0.00', expectedVersion: 1 } }),
    r.call(r.handlers.close.POST, { storeCode: code, headers: owner, params: p2, body: { requestKey: key() } }),
    r.call(r.handlers.session.POST, { storeCode: code, headers: owner, params: p2, body: { action: 'VOID', requestKey: key() } }),
    r.call(r.handlers.claim.POST, { storeCode: code, headers: owner, params: p2, body: { batchId: 'x' } }),
    r.call(r.handlers.report.POST, { storeCode: code, headers: owner, params: p2, body: { batchId: 'x', outcome: 'CROSSED' } }),
    r.call(r.handlers.renotify.POST, { storeCode: code, headers: owner, params: { ...p2, batchId: 'x' }, body: { requestKey: key(), reason: 'x' } }),
  ]) assert.equal((await attempt).status, 403)
  const disabled = await eligibility()
  assert.deepEqual([disabled.eligible, disabled.recoveryAvailable, disabled.hasActiveMeals], [false, false, false])
})

test('routes: OWNER / STAFF matrix, and tenant / store isolation of every entry', { skip }, async () => {
  const f = await fixture(), r = await routes()
  process.env.DINE_IN_TRIAL_STORE_CODES = `${f.a.code},${f.b.code},${f.other.store.code}`
  const code = f.a.code
  const owner = r.device(f.tenantId, f.a)
  const staff = r.account(f.tenantId, f.a.id, f.staff.userId, 'STAFF')
  assert.equal((await r.call(r.handlers.eligibility.GET, { method: 'GET', storeCode: code, headers: staff })).body.role, 'STAFF')

  // STAFF may open, order, handle notices, settle and clear.
  const opened = await r.call(r.handlers.sessions.POST, { storeCode: code, headers: staff, body: { tableId: f.tableId, guestCount: 3, requestKey: key() } })
  assert.equal(opened.status, 201)
  const params = { id: opened.body.mealId }
  const ordered = await r.call(r.handlers.batches.POST, { storeCode: code, headers: staff, params, body: { type: 'ORDER', requestKey: key(), items: [{ barcode: f.food.barcode, quantity: 1 }] } })
  assert.equal(ordered.status, 201)
  const batchId = ordered.body.batchId, line = ordered.body.meal.batches[0].lines[0]
  // STAFF may not void a line, void a meal, or maintain tables.
  for (const denied of [
    r.call(r.handlers.batches.POST, { storeCode: code, headers: staff, params, body: { type: 'VOID', requestKey: key(), reason: 'x', lines: [{ saleRecordId: line.saleRecordId, quantity: 1 }] } }),
    r.call(r.handlers.session.POST, { storeCode: code, headers: staff, params, body: { action: 'VOID', requestKey: key() } }),
    r.call(r.handlers.tables.POST, { storeCode: code, headers: staff, body: { name: 'staff table' } }),
  ]) assert.deepEqual([(await denied).status, (await denied).body.error], [403, 'OWNER_REQUIRED'])
  assert.equal((await r.call(r.handlers.claim.POST, { storeCode: code, headers: staff, params, body: { batchId } })).body.claimed, true)
  assert.equal((await r.call(r.handlers.report.POST, { storeCode: code, headers: staff, params, body: { batchId, outcome: 'FAILED_NOT_CROSSED' } })).body.recorded, true)
  assert.equal((await r.call(r.handlers.renotify.POST, { storeCode: code, headers: staff, params: { ...params, batchId }, body: { requestKey: key(), reason: 'printer off' } })).status, 201)
  assert.equal((await r.call(r.handlers.tables.POST, { storeCode: code, headers: owner, body: { name: 'owner table', areaKind: 'ROOM' } })).status, 201)

  // Isolation. Another store's device, another tenant's device, a staff account of another store, no identity.
  const strangers: Record<string, string>[] = [
    r.device(f.tenantId, f.b),
    r.device(f.other.tenantId, f.other.store),
    r.account(f.tenantId, f.b.id, f.staff.userId, 'STAFF'),
    r.account(f.other.tenantId, f.other.store.id, f.other.owner.userId, 'OWNER'),
    { 'x-lightops-client': 'desktop-pos' },
    { ...owner, 'x-pos-device-id': 'another-device' },
  ]
  for (const headers of strangers) {
    for (const attempt of [
      r.call(r.handlers.eligibility.GET, { method: 'GET', storeCode: code, headers }),
      r.call(r.handlers.tables.GET, { method: 'GET', storeCode: code, headers }),
      r.call(r.handlers.session.GET, { method: 'GET', storeCode: code, headers, params }),
      r.call(r.handlers.sessions.POST, { storeCode: code, headers, body: { tableId: f.table2Id, guestCount: 1, requestKey: key() } }),
      r.call(r.handlers.settle.POST, { storeCode: code, headers, params, body: { requestKey: key(), paymentMethod: 'CASH', expectedAmount: '3.50', expectedVersion: 2 } }),
      r.call(r.handlers.close.POST, { storeCode: code, headers, params, body: { requestKey: key() } }),
      r.call(r.handlers.claim.POST, { storeCode: code, headers, params, body: { batchId } }),
    ]) assert.deepEqual([(await attempt).status, (await attempt).body.error], [403, 'POS_DEVICE_UNAUTHORIZED'])
  }
  // Properly authorised for their own store, but naming this store's meal: not found, nothing leaked or changed.
  for (const [storeCode, headers] of [[f.b.code, r.device(f.tenantId, f.b)], [f.other.store.code, r.device(f.other.tenantId, f.other.store)]] as const) {
    for (const attempt of [
      r.call(r.handlers.session.GET, { method: 'GET', storeCode, headers, params }),
      r.call(r.handlers.batches.POST, { storeCode, headers, params, body: { type: 'ORDER', requestKey: key(), items: [{ barcode: f.food.barcode, quantity: 1 }] } }),
      r.call(r.handlers.batches.POST, { storeCode, headers, params, body: { type: 'VOID', requestKey: key(), reason: 'x', lines: [{ saleRecordId: line.saleRecordId, quantity: 1 }] } }),
      r.call(r.handlers.settle.POST, { storeCode, headers, params, body: { requestKey: key(), paymentMethod: 'CASH', expectedAmount: '3.50', expectedVersion: 2 } }),
      r.call(r.handlers.close.POST, { storeCode, headers, params, body: { requestKey: key() } }),
      r.call(r.handlers.session.POST, { storeCode, headers, params, body: { action: 'VOID', requestKey: key() } }),
      r.call(r.handlers.claim.POST, { storeCode, headers, params, body: { batchId } }),
      r.call(r.handlers.report.POST, { storeCode, headers, params, body: { batchId, outcome: 'CROSSED' } }),
      r.call(r.handlers.renotify.POST, { storeCode, headers, params: { ...params, batchId }, body: { requestKey: key(), reason: 'x', duplicateRiskAccepted: true } }),
    ]) assert.deepEqual([(await attempt).status, (await attempt).body.error], [404, 'MEAL_NOT_FOUND'])
    const open = await r.call(r.handlers.sessions.POST, { storeCode, headers, body: { tableId: f.table2Id, guestCount: 1, requestKey: key() } })
    assert.deepEqual([open.status, open.body.error], [404, 'TABLE_NOT_FOUND'])
    assert.ok((await r.call(r.handlers.tables.GET, { method: 'GET', storeCode, headers })).body.tables.every((table: { name: string }) => !['T1', 'T2', 'owner table'].includes(table.name)))
  }
  assert.equal((await r.call(r.handlers.eligibility.GET, { method: 'GET', storeCode: 'NO-SUCH-STORE', headers: owner })).status, 404)
  assert.equal((await r.call(r.handlers.eligibility.GET, { method: 'GET', headers: owner })).status, 400)
  const untouched = (await r.call(r.handlers.session.GET, { method: 'GET', storeCode: code, headers: owner, params })).body.meal as DiningMealView
  assert.deepEqual([untouched.state, untouched.unpaidAmount, untouched.batches.length], ['OPEN', '3.50', 2])
})

test('legacy checkout and cancel refuse a dining bill and still serve an ordinary pending order', { skip }, async () => {
  const f = await fixture(), db = admin(), r = await routes()
  process.env.DINE_IN_TRIAL_STORE_CODES = f.a.code
  const meal = await open(f)
  const dining = (await order(f, meal.mealId, [{ barcode: f.food.barcode, quantity: 1 }])).meal
  const ownerAccount = r.account(f.tenantId, f.a.id, f.owner.userId, 'OWNER')
  const before = await counts(f)

  const checkout = await r.call(r.handlers.legacyCheckout.POST, { headers: ownerAccount, params: { orderNo: dining.billNo! }, body: { paymentMethod: 'CASH' } })
  assert.deepEqual([checkout.status, checkout.body.error], [409, 'DINING_CHECKOUT_REQUIRED'])
  const cancel = await r.call(r.handlers.legacyCancel.POST, { headers: ownerAccount, params: { orderNo: dining.billNo! }, body: {} })
  assert.deepEqual([cancel.status, cancel.body.error], [409, 'DINING_VOID_REQUIRED'])
  assert.deepEqual(await counts(f), before)
  assert.equal((await db.saleRecord.findFirstOrThrow({ where: { orderNo: dining.billNo! } })).status, 'PENDING_PAYMENT')

  // An ordinary DEFER-style pending order (no dining batch) is not touched by the guard.
  const pending = async () => {
    const recordNo = `S-${randomUUID()}`
    await db.saleRecord.create({ data: { ...f.a.scope, operatorUserId: f.owner.userId, recordNo, orderNo: recordNo, saleType: 'SALE', status: 'PENDING_PAYMENT', barcode: f.drink.barcode, productNameSnapshot: 'Cola', unitPrice: 1.2, quantity: 1, lineAmount: 1.2 } })
    return recordNo
  }
  const toPay = await pending(), toCancel = await pending()
  const paid = await r.call(r.handlers.legacyCheckout.POST, { headers: ownerAccount, params: { orderNo: toPay }, body: { paymentMethod: 'CASH' } })
  assert.ok(paid.status >= 200 && paid.status < 300, JSON.stringify(paid))
  assert.equal((await db.saleRecord.findFirstOrThrow({ where: { orderNo: toPay } })).status, 'COMPLETED')
  const cancelled = await r.call(r.handlers.legacyCancel.POST, { headers: ownerAccount, params: { orderNo: toCancel }, body: {} })
  assert.ok(cancelled.status >= 200 && cancelled.status < 300, JSON.stringify(cancelled))
  assert.equal((await db.saleRecord.findFirstOrThrow({ where: { orderNo: toCancel } })).status, 'CANCELLED')

  // The dining bill settles only through its own state machine, and never leaves a non-PAID payment row.
  await settle(f, dining)
  const diningPayments = await db.paymentIntent.findMany({ where: { tenantId: f.tenantId, orderNo: dining.billNo! } })
  assert.deepEqual(diningPayments.map((payment) => payment.status), ['PAID'])
  const after = await r.call(r.handlers.legacyCheckout.POST, { headers: ownerAccount, params: { orderNo: dining.billNo! }, body: { paymentMethod: 'CASH' } })
  assert.notEqual(after.status, 200)
  assert.equal(await db.paymentIntent.count({ where: { tenantId: f.tenantId, orderNo: dining.billNo! } }), 1)
})

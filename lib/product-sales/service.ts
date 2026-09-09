import { Prisma, type ProductSalesGroup } from '@prisma/client'
import { prisma } from '../prisma'
import { getActiveOwnerStoresByTelegramId, type OwnerStoreAccess } from '../owner-store-hub'
import { createAccumulator } from './aggregate'
import { businessWindow, localDate, reportRange, shiftDate } from './dates'
import { identifier, object, parseSelection, productKey, ReportError, type GroupView, type ProductSalesResult, type ReportRange, type ReportStore, type Selection } from './contract'

export type ReportDb = Prisma.TransactionClient
const PAGE_SIZE = 1000
const MAX_SOURCE_ROWS = 50_000
export const asJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
export function groupView(group: ProductSalesGroup): GroupView {
  return { id: group.id, name: group.name, selection: parseSelection(group.selection), enabled: group.enabled, createdAt: group.createdAt.toISOString(), updatedAt: group.updatedAt.toISOString() }
}
export function selectedStores(selection: Selection, allowed: OwnerStoreAccess[]): OwnerStoreAccess[] {
  const stores = selection.storeId ? allowed.filter((store) => store.storeId === selection.storeId) : allowed
  if (stores.length === 0) throw new ReportError('STORE_ACCESS_DENIED', 403)
  if (selection.products.some((product) => !stores.some((store) => store.tenantId === product.tenantId))) throw new ReportError('PRODUCT_ACCESS_DENIED', 403)
  return stores
}
export async function selectedProducts(selection: Selection, stores: OwnerStoreAccess[], db: ReportDb = prisma) {
  selectedStores(selection, stores)
  const products = await db.product.findMany({
    where: { OR: selection.products.map((product) => ({ id: product.productId, tenantId: product.tenantId })) },
    select: { id: true, tenantId: true, name: true, barcode: true },
  })
  const byKey = new Map(products.map((product) => [productKey({ tenantId: product.tenantId, productId: product.id }), product]))
  return selection.products.map((ref) => {
    const product = byKey.get(productKey(ref))
    if (!product) throw new ReportError('PRODUCT_UNAVAILABLE', 422)
    return { ...ref, name: product.name, barcode: product.barcode }
  })
}

export async function querySales(selection: Selection, allowed: OwnerStoreAccess[], range: ReportRange, now = new Date(), db: ReportDb = prisma) {
  const stores = selectedStores(selection, allowed)
  const products = await selectedProducts(selection, stores, db)
  const visibleStores: ReportStore[] = stores.map(({ tenantId, storeId, storeName, currencyCode }) => ({ tenantId, storeId, storeName, currencyCode }))
  const accumulator = createAccumulator(products, visibleStores, range, now)
  if (!range.windows.length) return accumulator.finish()
  const scope = stores.map(({ tenantId, storeId }) => ({ tenantId, storeId }))
  const times = range.windows.map(({ from, to }) => ({ gte: new Date(from), lt: new Date(to) }))
  // Read all eligible lines in scope: unidentifiable legacy products must be
  // disclosed, not silently reported as a complete set of zero sales.
  let cursor: string | undefined
  let count = 0
  for (;;) {
    const lines = await db.saleRecord.findMany({
      where: { status: 'COMPLETED', AND: [{ OR: scope }, { OR: times.map((createdAt) => ({ createdAt })) }], ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: PAGE_SIZE,
      select: { id: true, tenantId: true, storeId: true, productId: true, saleType: true, quantity: true, lineAmount: true, originalSaleRecord: { select: { productId: true, tenantId: true } } },
    })
    count += lines.length
    if (count > MAX_SOURCE_ROWS) throw new ReportError('QUERY_TOO_LARGE', 422)
    for (const line of lines) accumulator.sale(line)
    if (lines.length < PAGE_SIZE) break
    cursor = lines[lines.length - 1].id
  }
  cursor = undefined
  for (;;) {
    const orders: Array<{ id: string; tenantId: string; storeId: string; itemsJson: string }> = await db.customerOrder.findMany({
      where: { status: 'COMPLETED', paymentStatus: 'PAID', AND: [{ OR: scope }, { OR: times.map((paidAt) => ({ paidAt })) }], ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' }, take: PAGE_SIZE,
      select: { id: true, tenantId: true, storeId: true, itemsJson: true },
    })
    count += orders.length
    if (count > MAX_SOURCE_ROWS) throw new ReportError('QUERY_TOO_LARGE', 422)
    for (const order of orders) accumulator.customer(order)
    if (orders.length < PAGE_SIZE) break
    cursor = orders[orders.length - 1].id
  }
  return accumulator.finish()
}

export function parseGroup(body: unknown) {
  const input = object(body)
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80 || typeof input.enabled !== 'boolean') throw new ReportError('INVALID_GROUP')
  return { name: input.name.trim(), enabled: input.enabled, selection: parseSelection(input.selection) }
}
export async function createGroup(body: unknown, ownerTelegramId: string, allowed: OwnerStoreAccess[], db: ReportDb = prisma) {
  const input = object(body)
  const id = identifier(input.id)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new ReportError('INVALID_REQUEST_ID')
  const data = parseGroup(input)
  await selectedProducts(data.selection, selectedStores(data.selection, allowed), db)
  // Caller-generated UUID is also the create idempotency key. No duplicate
  // group or reset of an edited group on network retries.
  try {
    return groupView(await db.productSalesGroup.create({ data: { id, ownerTelegramId, ...data, selection: asJson(data.selection) } }))
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await db.productSalesGroup.findFirst({ where: { id, ownerTelegramId } })
    if (!existing || existing.name !== data.name || existing.enabled !== data.enabled || JSON.stringify(parseSelection(existing.selection)) !== JSON.stringify(data.selection)) throw new ReportError('REQUEST_CONFLICT', 409)
    return groupView(existing)
  }
}
export async function updateGroup(id: string, body: unknown, ownerTelegramId: string, allowed: OwnerStoreAccess[], db: ReportDb = prisma) {
  identifier(id)
  const input = object(body)
  const existing = await db.productSalesGroup.findFirst({ where: { id, ownerTelegramId } })
  if (!existing) throw new ReportError('GROUP_NOT_FOUND', 404)
  if (typeof input.updatedAt !== 'string' || input.updatedAt !== existing.updatedAt.toISOString()) throw new ReportError('GROUP_CHANGED', 409)
  // Disabling must still work after a product disappears or access is revoked.
  const data = input.enabled === false && input.name === undefined && input.selection === undefined
    ? { enabled: false }
    : (() => { const parsed = parseGroup(input); return { ...parsed, selection: asJson(parsed.selection) } })()
  if ('selection' in data) {
    const selection = parseSelection(data.selection)
    await selectedProducts(selection, selectedStores(selection, allowed), db)
  }
  const updatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1))
  const update = await db.productSalesGroup.updateMany({ where: { id, ownerTelegramId, updatedAt: existing.updatedAt }, data: { ...data, updatedAt } })
  if (update.count !== 1) throw new ReportError('GROUP_CHANGED', 409)
  return groupView({ ...existing, ...data, selection: ('selection' in data ? data.selection : existing.selection) as Prisma.JsonValue, updatedAt })
}

export function canReadReport(result: unknown, allowed: OwnerStoreAccess[]): result is ProductSalesResult {
  if (!result || typeof result !== 'object') return false
  const report = result as ProductSalesResult
  return Array.isArray(report.stores) && report.stores.length > 0 && report.stores.every((saved) => allowed.some((store) => store.tenantId === saved.tenantId && store.storeId === saved.storeId))
}

export async function generateDailyGroup(groupId: string, now = new Date(), client = prisma) {
  const reportDate = shiftDate(localDate(now), -1)
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.$transaction(async (db) => {
        // Serialize generation against PATCH/disable and other invocations.
        await db.$queryRaw`SELECT "id" FROM "ProductSalesGroup" WHERE "id" = ${groupId} FOR UPDATE`
        const group = await db.productSalesGroup.findUnique({ where: { id: groupId } })
        if (!group || !group.enabled || group.createdAt >= new Date(businessWindow(reportDate).to)) return 'skipped' as const
        if (await db.productSalesDailyReport.findUnique({ where: { groupId_reportDate: { groupId, reportDate } }, select: { id: true } })) return 'existing' as const
        const stores = await getActiveOwnerStoresByTelegramId(group.ownerTelegramId, db as typeof prisma)
        const range = reportRange({ period: 'CUSTOM', dateFrom: reportDate, dateTo: reportDate }, now)
        const result = await querySales(parseSelection(group.selection), stores, range, now, db)
        // An automatic saved report must not silently archive partial coverage.
        if (result.unidentifiedSales) throw new ReportError('INCOMPLETE_SALES_DATA', 422)
        result.groupName = group.name
        await db.productSalesDailyReport.create({ data: { groupId, reportDate, generatedAt: now, result: asJson(result) } })
        return 'created' as const
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 })
    } catch (error) {
      if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) continue
      throw error
    }
  }
}

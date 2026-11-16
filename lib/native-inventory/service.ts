import { createHash } from 'node:crypto'
import { Prisma, type NativeInventoryMovementType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { baseQuantity, decimal, InventoryError, object, operationId, optionalText, requiredText, revision } from './input'

export type InventoryScope = { tenantId: string; storeId: string }
export type InventoryPerson = InventoryScope & { userId: string; role: 'OWNER' | 'RECEIVER'; currencyCode: string; storeName: string; salesTracking: boolean }

const receiptIncludes = { lines: { orderBy: { lineNo: 'asc' } }, supplier: { select: { name: true } } } satisfies Prisma.NativeInventoryReceiptInclude
const itemIncludes = {
  units: { orderBy: { name: 'asc' } },
  product: { select: { name: true, barcode: true, sellPrice: true } },
  _count: { select: { movements: true } },
} satisfies Prisma.NativeInventoryItemInclude
const limit = 100

function scopeFor(person: InventoryPerson): InventoryScope {
  return { tenantId: person.tenantId, storeId: person.storeId }
}

async function lockInventory(tx: Prisma.TransactionClient, person: InventoryPerson) {
  const scope = scopeFor(person)
  const [enabled] = await tx.$queryRaw<{ storeId: string }[]>`
    SELECT n."storeId" FROM "NativeInventoryStore" n
    JOIN "Store" s ON s."id" = n."storeId" AND s."tenantId" = n."tenantId"
    WHERE n."tenantId" = ${scope.tenantId} AND n."storeId" = ${scope.storeId}
      AND n."enabledAt" IS NOT NULL AND n."currencyCode" = s."currencyCode"
      AND s."currencyCode" = ${person.currencyCode}
    FOR UPDATE OF n
  `
  if (!enabled) throw new InventoryError('NATIVE_INVENTORY_DISABLED', 403)
  if (person.role === 'RECEIVER') {
    const grant = await tx.nativeInventoryReceiver.findUnique({
      where: { tenantId_storeId_userId: { ...scope, userId: person.userId } },
    })
    if (!grant) throw new InventoryError('RECEIVING_ACCESS_DENIED', 403)
  }
}

async function move(
  tx: Prisma.TransactionClient,
  person: InventoryPerson,
  data: {
    itemId: string
    sourceId: string
    type: NativeInventoryMovementType
    quantity: Prisma.Decimal
    cost: Prisma.Decimal | null
    reason?: string
  },
) {
  if (data.quantity.gt(0) && data.cost !== null) {
    // Unknown opening valuation takes the first known inbound cost. The
    // store lock serializes this initialization with every stock movement.
    await tx.nativeInventoryItem.updateMany({
      where: { ...scopeFor(person), id: data.itemId, onHand: { gt: 0 }, averageUnitCost: null },
      data: { averageUnitCost: data.cost },
    })
  }
  const [{ applied }] = await tx.$queryRaw<{ applied: boolean }[]>`
    SELECT public.native_inventory_move(
      ${person.tenantId}, ${person.storeId}, ${data.itemId}, ${data.sourceId},
      ${data.type}::"NativeInventoryMovementType", ${data.quantity},
      ${data.cost}, ${data.cost}, NULL, ${person.userId}, ${data.reason ?? null}, NULL
    ) AS applied
  `
  return applied
}

type StockFilter = 'LOW' | 'ZERO' | 'NEGATIVE' | 'UNTRACKED'

export async function listItems(person: InventoryPerson, query: string, exact = false, after?: string, db: Pick<Prisma.TransactionClient, 'nativeInventoryItem'> = prisma, page?: { size: number; filter?: StockFilter; kind?: 'PRODUCT' | 'MATERIAL' }) {
  const scope = scopeFor(person)
  const match = exact ? { equals: query } : { contains: query, mode: 'insensitive' as const }
  const where = query ? {
    OR: [
      { product: { barcode: match } },
      { units: { some: { barcode: match } } },
      ...(!exact ? [{ product: { name: match } }, { materialName: match }, { productName: match }] : []),
    ],
  } : {}
  const tracked = { movements: { some: {} } }
  const filter: Prisma.NativeInventoryItemWhereInput =
    page?.filter === 'UNTRACKED' ? { movements: { none: {} } } :
    page?.filter === 'NEGATIVE' ? { ...tracked, onHand: { lt: 0 } } :
    page?.filter === 'ZERO' ? { ...tracked, onHand: 0 } :
    page?.filter === 'LOW' ? { ...tracked, onHand: { gt: 0, lte: db.nativeInventoryItem.fields.lowStockAt } } : {}
  const kind = page?.kind === 'MATERIAL' ? { materialName: { not: null } }
    : page?.kind === 'PRODUCT' ? { materialName: null } : {}
  const items = await db.nativeInventoryItem.findMany({
    where: { ...scope, ...where, ...filter, ...kind, ...(after ? { id: { gt: after } } : {}) },
    include: itemIncludes,
    orderBy: { id: 'asc' },
    take: page?.size ?? limit,
  })
  return items.map((item) => serializeItem(item, person))
}

function serializeItem(item: Prisma.NativeInventoryItemGetPayload<{ include: typeof itemIncludes }>, person: InventoryPerson) {
  const units = [
    { id: 'BASE', name: item.baseUnitName, factor: '1', barcode: item.product?.barcode ?? null },
    ...item.units.map((unit) => ({ id: unit.id, name: unit.name, factor: unit.factor.toString(), barcode: unit.barcode })),
  ]
  const tracked = item._count.movements > 0
  return {
    id: item.id,
    name: item.product?.name ?? item.productName ?? item.materialName,
    productId: item.productId,
    kind: item.materialName ? 'MATERIAL' : 'PRODUCT',
    tracked,
    sellPrice: item.product?.sellPrice ?? null,
    onHand: tracked ? item.onHand : null,
    lowStockAt: item.lowStockAt,
    lowStock: tracked && item.onHand.lte(item.lowStockAt),
    units,
    ...(person.role === 'OWNER' ? { averageUnitCost: item.onHand.gt(0) ? item.averageUnitCost : null } : {}),
  }
}

export async function resolveImportRows(person: InventoryPerson, values: unknown) {
  if (!Array.isArray(values) || !values.length || values.length > limit) {
    throw new InventoryError('INVALID_IMPORT_ROWS')
  }
  const input = values.map((value) => {
    const row = object(value)
    return { barcode: requiredText(row.barcode), quantity: row.quantity, unitPrice: row.unitPrice }
  })
  const barcodes = [...new Set(input.map((row) => row.barcode))]
  const items = await prisma.nativeInventoryItem.findMany({
    where: {
      ...scopeFor(person),
      OR: [
        { product: { barcode: { in: barcodes } } },
        { units: { some: { barcode: { in: barcodes } } } },
      ],
    },
    include: itemIncludes,
  })
  const matches = new Map<string, { itemId: string; unitId: string }[]>()
  for (const row of items) {
    const item = serializeItem(row, person)
    for (const unit of item.units) {
      if (!unit.barcode) continue
      const list = matches.get(unit.barcode) ?? []
      list.push({ itemId: item.id, unitId: unit.id })
      matches.set(unit.barcode, list)
    }
  }
  return input.map((row, index) => {
    const candidates = matches.get(row.barcode) ?? []
    const base = { row: index + 1, barcode: row.barcode }
    if (candidates.length !== 1) {
      return { ...base, error: candidates.length ? 'AMBIGUOUS_BARCODE' : 'ITEM_NOT_FOUND' }
    }
    try {
      return {
        ...base,
        ...candidates[0],
        quantity: decimal(row.quantity, { min: 0, nonzero: true }).toString(),
        unitPrice: decimal(row.unitPrice, { min: 0 }).toString(),
      }
    } catch (error) {
      if (error instanceof InventoryError) return { ...base, error: error.code }
      throw error
    }
  })
}

export async function createItem(person: InventoryPerson, body: Record<string, unknown>) {
  const scope = scopeFor(person)
  const id = operationId(body.id)
  const productId = optionalText(body.productId)
  const materialName = optionalText(body.materialName)
  if (Boolean(productId) === Boolean(materialName)) throw new InventoryError('ITEM_KIND_REQUIRED')
  const lowStockAt = decimal(body.lowStockAt ?? '0', { min: 0 })
  if (body.units !== undefined && (!Array.isArray(body.units) || body.units.length > 20)) {
    throw new InventoryError('INVALID_UNITS')
  }
  const units = ((body.units ?? []) as unknown[]).map((value) => {
    const unit = object(value)
    return {
      name: requiredText(unit.name, 40),
      factor: decimal(unit.factor, { min: 0, nonzero: true }),
      barcode: optionalText(unit.barcode),
    }
  })
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const product = productId ? await tx.product.findFirst({
      where: { id: productId, tenantId: scope.tenantId, status: 'ACTIVE' },
      select: { name: true },
    }) : null
    if (productId && !product) throw new InventoryError('PRODUCT_NOT_FOUND', 404)
    const baseUnitName = requiredText(body.baseUnitName, 40)
    const existing = await tx.nativeInventoryItem.findUnique({
      where: { tenantId_storeId_id: { ...scope, id } },
      include: { units: { orderBy: { name: 'asc' } } },
    })
    if (existing) {
      const sameUnits = existing.units.length === units.length && existing.units.every((unit) =>
        units.some((incoming) => incoming.name === unit.name && incoming.barcode === unit.barcode && incoming.factor.eq(unit.factor)))
      if (existing.productId !== productId || existing.materialName !== materialName ||
        existing.baseUnitName !== baseUnitName || !existing.lowStockAt.eq(lowStockAt) || !sameUnits) {
        throw new InventoryError('OPERATION_CONFLICT', 409)
      }
      return { id }
    }
    return tx.nativeInventoryItem.create({
      data: {
        ...scope, id, productId, productTenantId: product ? scope.tenantId : null, materialName, productName: product?.name, lowStockAt, baseUnitName,
        units: { createMany: { data: units } },
      },
      select: { id: true },
    })
  })
}

export async function adjust(person: InventoryPerson, body: Record<string, unknown>) {
  const scope = scopeFor(person)
  const sourceId = operationId(body.id)
  const itemId = requiredText(body.itemId)
  const reason = requiredText(body.reason, 250)
  const physicalCount = reason === '盘点差异' || reason.startsWith('盘点差异 · ')
  const openingCount = physicalCount && body.expectedOnHand === null
  const quantity = decimal(body.quantity, openingCount ? { min: 0 } : { nonzero: true })
  const expectedOnHand = body.expectedOnHand === undefined || openingCount ? null : decimal(body.expectedOnHand)
  if (physicalCount && expectedOnHand === null && !openingCount) throw new InventoryError('EXPECTED_STOCK_REQUIRED')
  const cost = quantity.gt(0) && !(physicalCount && body.unitCost === null) ? decimal(body.unitCost, { min: 0 }) : null
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const existing = await tx.nativeInventoryMovement.findUnique({
      where: { tenantId_storeId_type_sourceId: { ...scope, type: 'ADJUSTMENT', sourceId } },
    })
    if (existing) {
      if (existing.itemId !== itemId || !existing.quantity.eq(quantity) || existing.reason !== reason ||
        (cost ? !existing.unitCost?.eq(cost) : existing.unitCost !== null)) {
        throw new InventoryError('OPERATION_CONFLICT', 409)
      }
      return existing
    }
    const item = await tx.nativeInventoryItem.findUnique({ where: { tenantId_storeId_id: { ...scope, id: itemId } } })
    if (!item) throw new InventoryError('ITEM_NOT_FOUND', 404)
    if (openingCount) {
      const firstMovement = await tx.nativeInventoryMovement.findFirst({ where: { ...scope, itemId }, select: { sourceId: true } })
      if (firstMovement || !item.onHand.isZero()) throw new InventoryError('STOCK_CHANGED', 409)
    }
    if (expectedOnHand && !item.onHand.eq(expectedOnHand)) throw new InventoryError('STOCK_CHANGED', 409)
    await move(tx, person, { itemId, sourceId, type: 'ADJUSTMENT', quantity, cost, reason })
    return tx.nativeInventoryMovement.findUniqueOrThrow({
      where: { tenantId_storeId_type_sourceId: { ...scope, type: 'ADJUSTMENT', sourceId } },
    })
  })
}

export async function saveSupplier(person: InventoryPerson, body: Record<string, unknown>) {
  const scope = scopeFor(person)
  const id = operationId(body.id)
  const data = { name: requiredText(body.name), contact: optionalText(body.contact, 250) }
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const where = { tenantId_storeId_id: { ...scope, id } }
    if (person.role === 'RECEIVER') {
      const existing = await tx.nativeInventorySupplier.findUnique({ where })
      if (existing) {
        if (existing.name !== data.name || existing.contact !== data.contact) {
          throw new InventoryError('SUPPLIER_EDIT_REQUIRES_OWNER', 403)
        }
        return existing
      }
    }
    return tx.nativeInventorySupplier.upsert({ where, create: { ...scope, id, ...data }, update: data })
  })
}

export async function listSuppliers(person: InventoryPerson, query: string) {
  const scope = scopeFor(person)
  const contains = { contains: query, mode: 'insensitive' as const }
  const suppliers = await prisma.nativeInventorySupplier.findMany({
    where: { ...scope, OR: [{ name: contains }, { contact: contains }] },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: limit,
  })
  if (person.role !== 'OWNER' || !suppliers.length) return suppliers
  const totals = await prisma.nativeInventoryReceipt.groupBy({
    by: ['supplierId'], where: { ...scope, supplierId: { in: suppliers.map(({ id }) => id) }, postedAt: { not: null }, currencyCode: person.currencyCode },
    _count: true, _sum: { total: true },
  })
  const byId = new Map(totals.map((row) => [row.supplierId, row]))
  return suppliers.map((supplier) => ({
    ...supplier,
    postedCount: byId.get(supplier.id)?._count ?? 0,
    purchaseTotal: byId.get(supplier.id)?._sum.total ?? '0',
  }))
}

export async function getSupplierPurchases(person: InventoryPerson, supplierId: string) {
  const scope = scopeFor(person)
  const supplier = await prisma.nativeInventorySupplier.findUnique({
    where: { tenantId_storeId_id: { ...scope, id: supplierId } },
  })
  if (!supplier) throw new InventoryError('SUPPLIER_NOT_FOUND', 404)
  const where = { ...scope, supplierId, postedAt: { not: null } }
  const [totals, receipts, items] = await Promise.all([
    prisma.nativeInventoryReceipt.groupBy({ by: ['currencyCode'], where, _sum: { total: true }, _count: true }),
    prisma.nativeInventoryReceipt.findMany({ where, include: receiptIncludes, orderBy: [{ postedAt: 'desc' }, { id: 'desc' }], take: limit }),
    prisma.nativeInventoryItem.findMany({
      where: { ...scope, receiptLines: { some: { receipt: where } } },
      select: { id: true, materialName: true, productName: true, product: { select: { name: true } } },
      orderBy: { id: 'asc' },
      take: limit,
    }),
  ])
  return { supplier, totals, receipts, items }
}

function receiptVisibility(person: InventoryPerson) {
  return person.role === 'OWNER' ? {} : { createdBy: person.userId }
}

export async function getReceipt(person: InventoryPerson, id: string) {
  const receipt = await prisma.nativeInventoryReceipt.findFirst({
    where: { ...scopeFor(person), id, ...receiptVisibility(person) },
    include: receiptIncludes,
  })
  if (!receipt) throw new InventoryError('RECEIPT_NOT_FOUND', 404)
  return receipt
}

export async function checkReceiptResult(person: InventoryPerson, id: string) {
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const receipt = await tx.nativeInventoryReceipt.findFirst({
      where: { ...scopeFor(person), id, ...receiptVisibility(person) },
      include: receiptIncludes,
    })
    if (!receipt) throw new InventoryError('RECEIPT_NOT_FOUND', 404)
    return receipt
  })
}

export async function deleteDraft(person: InventoryPerson, id: string, expectedRevision: number) {
  const scope = scopeFor(person)
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const where = { ...scope, id, ...receiptVisibility(person) }
    const receipt = await tx.nativeInventoryReceipt.findFirst({ where })
    if (!receipt) return { id }
    if (receipt.postedAt || receipt.revision !== expectedRevision) {
      throw new InventoryError('RECEIPT_REVISION_CONFLICT', 409)
    }
    await tx.nativeInventoryReceiptLine.deleteMany({ where: { ...scope, receiptId: id } })
    await tx.nativeInventoryReceipt.deleteMany({ where })
    return { id }
  })
}

export async function listReceipts(person: InventoryPerson, before?: { createdAt: Date; id: string }) {
  return prisma.nativeInventoryReceipt.findMany({
    where: {
      ...scopeFor(person), ...receiptVisibility(person),
      ...(before ? { OR: [
        { createdAt: { lt: before.createdAt } },
        { createdAt: before.createdAt, id: { lt: before.id } },
      ] } : {}),
    },
    include: receiptIncludes,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  })
}

export async function saveReceipt(person: InventoryPerson, body: Record<string, unknown>) {
  const scope = scopeFor(person)
  const id = operationId(body.id)
  const expectedRevision = revision(body.revision, true)
  const supplierId = operationId(body.supplierId)
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > limit) {
    throw new InventoryError('INVALID_RECEIPT_LINES')
  }
  const input = body.lines.map((value) => {
    const line = object(value)
    return {
      itemId: requiredText(line.itemId),
      unitId: requiredText(line.unitId),
      quantity: decimal(line.quantity, { min: 0, nonzero: true }),
      unitPrice: decimal(line.unitPrice, { min: 0 }),
    }
  })
  const hash = createHash('sha256').update(JSON.stringify({ expectedRevision, supplierId, input })).digest('hex')
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const where = { tenantId_storeId_id: { ...scope, id } }
    const existing = await tx.nativeInventoryReceipt.findUnique({ where, include: receiptIncludes })
    if (existing && person.role !== 'OWNER' && existing.createdBy !== person.userId) {
      throw new InventoryError('RECEIPT_NOT_FOUND', 404)
    }
    if (existing?.lastDraftRequestHash === hash) return existing
    if (existing?.postedAt || (existing?.revision ?? 0) !== expectedRevision) {
      throw new InventoryError('RECEIPT_REVISION_CONFLICT', 409)
    }
    const supplier = await tx.nativeInventorySupplier.findUnique({ where: { tenantId_storeId_id: { ...scope, id: supplierId } } })
    if (!supplier) throw new InventoryError('SUPPLIER_NOT_FOUND', 404)
    const items = await tx.nativeInventoryItem.findMany({
      where: { ...scope, id: { in: input.map((line) => line.itemId) } },
      include: itemIncludes,
    })
    const byId = new Map(items.map((item) => [item.id, item]))
    const lines = input.map((line, index) => {
      const item = byId.get(line.itemId)
      if (!item) throw new InventoryError('ITEM_NOT_FOUND', 404)
      let factor = new Prisma.Decimal(1)
      let unitName = item.baseUnitName
      if (line.unitId !== 'BASE') {
        const unit = item.units.find((unit) => unit.id === line.unitId)
        if (!unit) throw new InventoryError('UNIT_NOT_FOUND', 404)
        factor = unit.factor
        unitName = unit.name
      }
      return {
        lineNo: index + 1, itemId: item.id, factor, unitName, unitId: line.unitId,
        itemName: item.product?.name ?? item.productName ?? item.materialName ?? item.id,
        quantity: line.quantity, baseQty: baseQuantity(line.quantity, factor), unitPrice: line.unitPrice,
        amount: line.quantity.mul(line.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
      }
    })
    const total = lines.reduce((sum, line) => sum.add(line.amount), new Prisma.Decimal(0))
    if (existing) {
      await tx.nativeInventoryReceiptLine.deleteMany({ where: { ...scope, receiptId: id } })
      return tx.nativeInventoryReceipt.update({
        where,
        data: { supplierId, revision: expectedRevision + 1, lastDraftRequestHash: hash, total, lines: { createMany: { data: lines } } },
        include: receiptIncludes,
      })
    }
    return tx.nativeInventoryReceipt.create({
      data: { ...scope, id, supplierId, createdBy: person.userId, lastDraftRequestHash: hash, total, currencyCode: person.currencyCode, lines: { createMany: { data: lines } } },
      include: receiptIncludes,
    })
  })
}

export async function confirmReceipt(person: InventoryPerson, id: string, expectedRevision: number) {
  const scope = scopeFor(person)
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    const where = { tenantId_storeId_id: { ...scope, id } }
    const receipt = await tx.nativeInventoryReceipt.findUnique({ where, include: receiptIncludes })
    if (!receipt || (person.role !== 'OWNER' && receipt.createdBy !== person.userId)) {
      throw new InventoryError('RECEIPT_NOT_FOUND', 404)
    }
    if (receipt.revision !== expectedRevision) throw new InventoryError('RECEIPT_REVISION_CONFLICT', 409)
    if (receipt.postedAt) return receipt
    if (receipt.currencyCode !== person.currencyCode) throw new InventoryError('RECEIPT_CURRENCY_CHANGED', 409)
    if (!receipt.lines.length) throw new InventoryError('RECEIPT_LEDGER_CONFLICT', 409)
    const [{ outOfRange }] = await tx.$queryRaw<{ outOfRange: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM "NativeInventoryReceiptLine"
        WHERE "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId} AND "receiptId" = ${id}
          AND round("unitPrice"::numeric(45, 30) / "factor", 10) >= 100000000000000
      ) AS "outOfRange"
    `
    if (outOfRange) throw new InventoryError('INVENTORY_UNIT_COST_OUT_OF_RANGE')
    // When an item has positive quantity but no valuation, seed it with its
    // first known incoming cost before the normal weighted-average movement.
    await tx.$executeRaw`
      UPDATE "NativeInventoryItem" item SET "averageUnitCost" = first_line.cost
      FROM (
        SELECT DISTINCT ON ("itemId") "itemId", round("unitPrice"::numeric(45, 30) / "factor", 10) AS cost
        FROM "NativeInventoryReceiptLine"
        WHERE "tenantId" = ${scope.tenantId} AND "storeId" = ${scope.storeId} AND "receiptId" = ${id}
        ORDER BY "itemId", "lineNo"
      ) first_line
      WHERE item."tenantId" = ${scope.tenantId} AND item."storeId" = ${scope.storeId}
        AND item."id" = first_line."itemId" AND item."onHand" > 0 AND item."averageUnitCost" IS NULL
    `
    // PostgreSQL evaluates the volatile output expression after ordering on
    // lineNo. Repeated products therefore retain sequential movement balances.
    const movements = await tx.$queryRaw<{ applied: boolean }[]>`
      SELECT public.native_inventory_move(
        ${scope.tenantId}, ${scope.storeId}, line."itemId", ${id} || ':' || line."lineNo", 'RECEIPT',
        line."baseQty", round(line."unitPrice"::numeric(45, 30) / line."factor", 10),
        round(line."unitPrice"::numeric(45, 30) / line."factor", 10), NULL, ${person.userId}, NULL, NULL
      ) AS applied
      FROM "NativeInventoryReceiptLine" line
      WHERE line."tenantId" = ${scope.tenantId} AND line."storeId" = ${scope.storeId} AND line."receiptId" = ${id}
      ORDER BY line."lineNo"
    `
    if (movements.length !== receipt.lines.length || movements.some(({ applied }) => !applied)) {
      throw new InventoryError('RECEIPT_LEDGER_CONFLICT', 409)
    }
    return tx.nativeInventoryReceipt.update({
      where,
      data: { postedAt: new Date(), postedBy: person.userId },
      include: receiptIncludes,
    })
  })
}

export async function setReceiver(person: InventoryPerson, userId: string, enabled: boolean) {
  const scope = scopeFor(person)
  return prisma.$transaction(async (tx) => {
    await lockInventory(tx, person)
    if (enabled) {
      const membership = await tx.userStoreRole.findFirst({
        where: { ...scope, userId, status: 'ACTIVE', role: 'STAFF', user: { tenantId: scope.tenantId, status: 'ACTIVE' } },
      })
      if (!membership) throw new InventoryError('STAFF_NOT_FOUND', 404)
      await tx.nativeInventoryReceiver.upsert({
        where: { tenantId_storeId_userId: { ...scope, userId } }, create: { ...scope, userId }, update: {},
      })
    } else {
      await tx.nativeInventoryReceiver.deleteMany({ where: { ...scope, userId } })
    }
  })
}

export async function listCatalog(person: InventoryPerson, query: string, page?: { after?: string; size?: number }, db: Pick<Prisma.TransactionClient, 'product'> = prisma) {
  const contains = { contains: query, mode: 'insensitive' as const }
  return db.product.findMany({
    where: {
      tenantId: person.tenantId,
      status: 'ACTIVE',
      ...(query ? { OR: [{ name: contains }, { barcode: contains }] } : {}),
      nativeInventoryItems: { none: scopeFor(person) },
      ...(page?.after ? { id: { gt: page.after } } : {}),
    },
    select: { id: true, name: true, barcode: true },
    orderBy: page ? { id: 'asc' } : [{ name: 'asc' }, { id: 'asc' }],
    take: page?.size ?? limit,
  })
}

export async function listStockOverview(person: InventoryPerson, query: string, includeCatalog: boolean, catalogAfter?: string) {
  if (person.role !== 'OWNER' || !includeCatalog) {
    return { items: await listItems(person, query), catalog: [], registeredCount: null }
  }

  return prisma.$transaction(async (tx) => ({
    items: catalogAfter ? [] : await listItems(person, query, false, undefined, tx),
    catalog: await listCatalog(person, query, { after: catalogAfter }, tx),
    registeredCount: await tx.nativeInventoryItem.count({ where: { ...scopeFor(person), productId: { not: null } } }),
  }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
}

const stockPageSize = 24

export async function listStockPage(person: InventoryPerson, query: string, options: {
  catalog: boolean
  catalogAfter?: string
  itemAfter?: string
  filter?: StockFilter
  kind?: 'PRODUCT' | 'MATERIAL'
}) {
  const { catalog, catalogAfter, itemAfter, filter, kind } = options
  const catalogAllowed = catalog && person.role === 'OWNER' && kind !== 'MATERIAL'
    && (!filter || filter === 'UNTRACKED')
  const size = stockPageSize + 1
  async function read(db: Prisma.TransactionClient) {
    const itemRows = catalogAfter ? [] : await listItems(person, query, false, itemAfter, db, { size, filter, kind })
    const catalogRows = catalogAllowed && !itemAfter ? await listCatalog(person, query, { after: catalogAfter, size }, db) : []
    const registeredCount = catalogAllowed
      ? await db.nativeInventoryItem.count({ where: { ...scopeFor(person), productId: { not: null } } })
      : null
    const items = itemRows.slice(0, stockPageSize)
    const products = catalogRows.slice(0, stockPageSize)
    return {
      items,
      catalog: products,
      registeredCount,
      nextItem: itemRows.length > stockPageSize ? items.at(-1)!.id : null,
      nextCatalog: catalogRows.length > stockPageSize ? products.at(-1)!.id : null,
    }
  }
  // A product that is registered between the two reads must still appear in
  // one of the lists. This also keeps the registration count on their snapshot.
  return catalogAllowed
    ? prisma.$transaction(read, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    : read(prisma)
}

export async function listMovements(person: InventoryPerson, itemId?: string) {
  return prisma.nativeInventoryMovement.findMany({
    where: { ...scopeFor(person), itemId },
    orderBy: [{ createdAt: 'desc' }, { sourceId: 'desc' }, { type: 'desc' }],
    take: limit,
  })
}

export async function listProfit(person: InventoryPerson, from: Date, until: Date) {
  return prisma.$queryRaw`
    WITH totals AS (
      SELECT m."itemId", -sum(m."quantity") AS quantity, sum(m."revenue") AS revenue,
        -sum(m."quantity" * m."unitCost") AS cost,
        count(*) FILTER (WHERE m."unitCost" IS NULL AND m."quantity" <> 0)::int AS "unknownCostCount",
        count(*) FILTER (WHERE m."reason" = 'CURRENCY_MISMATCH')::int AS "currencyMismatchCount"
      FROM "NativeInventoryMovement" m
      WHERE m."tenantId" = ${person.tenantId} AND m."storeId" = ${person.storeId}
        AND m."createdAt" >= ${from.toISOString()}::timestamptz AND m."createdAt" < ${until.toISOString()}::timestamptz AND m."type" IN ('SALE', 'REFUND', 'SALE_CANCEL', 'REFUND_CANCEL', 'CUSTOMER_SALE', 'CUSTOMER_SALE_CANCEL')
      GROUP BY m."itemId"
    )
    SELECT t."itemId", coalesce(p."name", i."productName") AS name, c."name" AS category, t.quantity, t.revenue, t."unknownCostCount", t."currencyMismatchCount",
      CASE WHEN t."unknownCostCount" = 0 AND t."currencyMismatchCount" = 0 THEN round(coalesce(t.cost, 0), 2) END AS cost,
      CASE WHEN t."unknownCostCount" = 0 AND t."currencyMismatchCount" = 0 THEN round(t.revenue - coalesce(t.cost, 0), 2) END AS profit,
      CASE WHEN t."unknownCostCount" = 0 AND t."currencyMismatchCount" = 0 AND t.revenue > 0
        THEN round(100 * (t.revenue - coalesce(t.cost, 0)) / t.revenue, 2) END AS "marginPercent"
    FROM totals t
    JOIN "NativeInventoryItem" i ON i."tenantId" = ${person.tenantId}
      AND i."storeId" = ${person.storeId} AND i."id" = t."itemId"
    LEFT JOIN "Product" p ON p."id" = i."productId" AND p."tenantId" = i."tenantId"
    LEFT JOIN "ProductCategory" c ON c."id" = p."categoryId" AND c."tenantId" = p."tenantId"
    ORDER BY t.revenue DESC, t."itemId"
  `
}

import type { Prisma } from '@prisma/client'

export async function lockOrderSettlement(tx: Prisma.TransactionClient, tenantId: string, orderNo: string) {
  const key = JSON.stringify(['pos-order-settlement', tenantId, orderNo])
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0)) IS NULL AS locked`
}

// Early deferred checkouts could store the owner's selected store on the
// intent, even when the sale lines belonged to a different store.
export async function orderRecordStore(
  tx: Prisma.TransactionClient, order: { tenantId: string; orderNo: string; storeId: string },
) {
  const stores = await tx.saleRecord.findMany({
    where: { tenantId: order.tenantId, orderNo: order.orderNo },
    distinct: ['storeId'],
    select: { storeId: true },
    take: 2,
  })
  if (stores.length > 1) return null
  return stores[0]?.storeId ?? order.storeId
}

/**
 * Generates a unique recordNo within a Prisma transaction.
 *
 * Format: {prefix}-{yyyyMMdd}-{storeCode}-{seq:0000}
 * Example: S-20260331-MAIN-0003
 *
 * Runs inside a transaction so the count and create are atomic at the
 * serializable level. At low concurrency this is safe; if a unique
 * constraint violation occurs the caller should surface a 409.
 *
 * Date is computed in UTC. If the store operates across a timezone
 * boundary, add timezone offset handling here.
 */

// Minimal subset of the transaction client used in this function.
// Avoids importing the Prisma namespace, which may not be available
// in environments where prisma generate has not yet run.
type TxClient = {
  saleRecord: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    count: (args: { where: Record<string, any> }) => Promise<number>
  }
}

export async function generateRecordNo(
  tx: TxClient,
  prefix: 'S' | 'R',
  tenantId: string,
  storeId: string,
  storeCode: string,
): Promise<string> {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '') // yyyyMMdd UTC

  const startOfDay = new Date(now)
  startOfDay.setUTCHours(0, 0, 0, 0)
  const endOfDay = new Date(now)
  endOfDay.setUTCHours(23, 59, 59, 999)

  // TODO: TEST VERSION ONLY — count+1 inside a transaction is safe at low
  // concurrency, but will produce duplicate recordNos under high parallel load.
  // Upgrade to a DB sequence (e.g. Postgres SEQUENCE via raw SQL) before
  // going to production with multiple concurrent write servers.
  const count = await tx.saleRecord.count({
    where: {
      tenantId,
      storeId,
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
  })

  const seq = String(count + 1).padStart(4, '0')
  return `${prefix}-${dateStr}-${storeCode}-${seq}`
}

import type { Prisma } from '@prisma/client'

type CurrencySource = {
  tenantId: string
  storeId: string
  currencyCode: string | null
  kind: 'POS' | 'POS_PAYMENT' | 'H5' | 'H5_PAYMENT'
  paymentCurrencyCode?: string | null
}

export function inventoryDisplayedCurrency(displayed: unknown, current: string) {
  return typeof displayed === 'string' && /^[A-Z]{3}$/.test(displayed) && displayed === current ? current : null
}

// A transaction-local value accompanies the actual priced insert. It is never
// carried into a later checkout transaction or another pooled connection.
export async function recordInventoryOrderCurrency(tx: Prisma.TransactionClient, source: CurrencySource) {
  if (source.currencyCode === null && !source.paymentCurrencyCode) return
  await tx.$queryRaw`SELECT set_config('eshop.inventory_order_currency', ${JSON.stringify(source)}, true)`
}

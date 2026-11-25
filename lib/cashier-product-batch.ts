import { Prisma } from '@prisma/client'
import {
  isMultiUnitBusinessType,
  ProductUnitError,
  resolveProductSellingUnit,
  type ProductUnitDb,
  type ResolvedProductUnit,
} from './product-unit'

type BatchDb = ProductUnitDb & {
  product: ProductUnitDb['product'] & { findMany(args: unknown): Promise<any[]> }
}
type CartItem = { barcode: string; quantity: number | string | Prisma.Decimal }

/** Isolated candidate: keep the existing unit resolver as the validation authority. */
export async function resolveCashierProductsBatched(
  db: BatchDb,
  scope: { tenantId: string; businessType: string | null | undefined },
  items: readonly CartItem[],
): Promise<ResolvedProductUnit[]> {
  if (items.length === 0) return []
  const codes = [...new Set(items.map(item => {
    const barcode = item.barcode.trim()
    const quantity = new Prisma.Decimal(item.quantity)
    if (!barcode || !quantity.isFinite() || quantity.lte(0)) {
      throw new ProductUnitError('INVALID_SALE_ITEM', 400, '销售条码和数量无效')
    }
    return barcode
  }))]
  const eligible = isMultiUnitBusinessType(scope.businessType)
  const rows = await db.product.findMany({
    where: {
      tenantId: scope.tenantId,
      status: 'ACTIVE',
      OR: [
        { barcode: { in: codes } },
        ...(eligible ? [{ auxEnabled: true, auxBarcode: { in: codes } }] : []),
      ],
    },
  })
  const byCode = new Map<string, any[]>()
  const wanted = new Set(codes)
  for (const product of rows) {
    const productCodes = new Set([
      product.barcode,
      ...(eligible && product.auxEnabled ? [product.auxBarcode] : []),
    ])
    for (const code of productCodes) {
      if (!wanted.has(code)) continue
      const matches = byCode.get(code) ?? []
      matches.push(product)
      byCode.set(code, matches)
    }
  }
  const result: ResolvedProductUnit[] = []
  for (const item of items) {
    const matches = byCode.get(item.barcode.trim()) ?? []
    // Old data may contain a main/aux cross-product collision. Retain the old
    // database selection in that case instead of inventing a selection rule.
    const productDb = matches.length > 1 ? db : {
      product: { findFirst: async () => matches[0] ?? null },
    }
    result.push(await resolveProductSellingUnit(productDb, {
      tenantId: scope.tenantId,
      businessType: scope.businessType,
      barcode: item.barcode,
      quantity: item.quantity,
    }))
  }
  return result
}

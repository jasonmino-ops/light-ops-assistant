import { Prisma } from '@prisma/client'

export type SellingUnitType = 'MAIN' | 'AUX'

export type ProductUnitDb = {
  product: {
    findFirst(args: unknown): Promise<any>
  }
}

export class ProductUnitError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function isMultiUnitBusinessType(value: string | null | undefined): boolean {
  return value === 'RETAIL' || value === 'ECOMMERCE'
}

export function decimalToMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
}

export type ResolvedProductUnit = {
  product: any
  multiUnitEligible: boolean
  barcode: string
  sellingUnitType: SellingUnitType
  sellingUnitName: string
  sellingQuantity: Prisma.Decimal
  conversionFactor: number
  baseQuantity: Prisma.Decimal
  unitPrice: Prisma.Decimal
  lineAmount: Prisma.Decimal
}

export async function resolveProductSellingUnit(
  db: ProductUnitDb,
  input: {
    tenantId: string
    businessType: string | null | undefined
    barcode: string
    quantity: number | string | Prisma.Decimal
    includeDisabled?: boolean
  },
): Promise<ResolvedProductUnit> {
  const barcode = input.barcode.trim()
  const eligible = isMultiUnitBusinessType(input.businessType)
  const quantity = new Prisma.Decimal(input.quantity)
  if (!barcode || !quantity.isFinite() || quantity.lte(0)) {
    throw new ProductUnitError('INVALID_SALE_ITEM', 400, '销售条码和数量无效')
  }

  const product = await db.product.findFirst({
    where: {
      tenantId: input.tenantId,
      ...(input.includeDisabled ? {} : { status: 'ACTIVE' }),
      OR: [
        { barcode },
        ...(eligible ? [{ auxEnabled: true, auxBarcode: barcode }] : []),
      ],
    },
  })
  if (!product) throw new ProductUnitError('PRODUCT_NOT_FOUND', 404, '商品不存在或已停用')

  const isAux = eligible && product.auxEnabled === true && product.auxBarcode === barcode
  if (isAux) {
    const factor = product.auxConversionFactor
    if (!product.auxUnitName || !product.auxSellPrice || !Number.isInteger(factor) || factor < 2) {
      throw new ProductUnitError('AUX_UNIT_CONFIG_INVALID', 409, '辅单位配置不完整')
    }
    if (!quantity.isInteger()) {
      throw new ProductUnitError('AUX_QUANTITY_MUST_BE_INTEGER', 400, '辅单位只能按整包装销售')
    }
    const unitPrice = new Prisma.Decimal(product.auxSellPrice)
    return {
      product,
      multiUnitEligible: eligible,
      barcode,
      sellingUnitType: 'AUX',
      sellingUnitName: product.auxUnitName,
      sellingQuantity: quantity,
      conversionFactor: factor,
      baseQuantity: quantity.mul(factor),
      unitPrice,
      lineAmount: decimalToMoney(unitPrice.mul(quantity)),
    }
  }

  const unitPrice = new Prisma.Decimal(product.sellPrice)
  return {
    product,
    multiUnitEligible: eligible,
    barcode,
    sellingUnitType: 'MAIN',
    sellingUnitName: eligible ? product.mainUnitName?.trim() || '件' : '件',
    sellingQuantity: quantity,
    conversionFactor: 1,
    baseQuantity: quantity,
    unitPrice,
    lineAmount: decimalToMoney(unitPrice.mul(quantity)),
  }
}

export async function assertProductUnitBarcodesAvailable(
  db: ProductUnitDb,
  input: { tenantId: string; barcode: string; auxBarcode?: string | null; excludeProductId?: string },
): Promise<void> {
  const barcode = input.barcode.trim()
  const auxBarcode = input.auxBarcode?.trim() || null
  if (!barcode || (auxBarcode && auxBarcode === barcode)) {
    throw new ProductUnitError('BARCODE_COLLISION', 409, '主条码与辅条码冲突')
  }
  const candidates = [barcode, ...(auxBarcode ? [auxBarcode] : [])]
  const existing = await db.product.findFirst({
    where: {
      tenantId: input.tenantId,
      ...(input.excludeProductId ? { id: { not: input.excludeProductId } } : {}),
      OR: [
        { barcode: { in: candidates } },
        { auxBarcode: { in: candidates } },
      ],
    },
    select: { id: true },
  })
  if (existing) throw new ProductUnitError('BARCODE_COLLISION', 409, '条码已被其他商品主单位或辅单位使用')
}

export type MultiUnitMutation = {
  mainUnitName?: string | null
  auxUnitName?: string | null
  auxBarcode?: string | null
  auxConversionFactor?: number | null
  auxSellPrice?: number | string | null
  auxEnabled?: boolean
}

export function normalizeMultiUnitMutation(
  input: MultiUnitMutation,
  current?: MultiUnitMutation,
): Required<MultiUnitMutation> {
  const normalized = {
    mainUnitName: input.mainUnitName === undefined ? current?.mainUnitName ?? null : input.mainUnitName?.trim() || null,
    auxUnitName: input.auxUnitName === undefined ? current?.auxUnitName ?? null : input.auxUnitName?.trim() || null,
    auxBarcode: input.auxBarcode === undefined ? current?.auxBarcode ?? null : input.auxBarcode?.trim() || null,
    auxConversionFactor: input.auxConversionFactor === undefined ? current?.auxConversionFactor ?? null : input.auxConversionFactor,
    auxSellPrice: input.auxSellPrice === undefined ? current?.auxSellPrice ?? null : input.auxSellPrice,
    auxEnabled: input.auxEnabled === undefined ? current?.auxEnabled ?? false : input.auxEnabled,
  }
  if (normalized.auxConversionFactor != null && (!Number.isInteger(Number(normalized.auxConversionFactor)) || Number(normalized.auxConversionFactor) < 2)) {
    throw new ProductUnitError('INVALID_AUX_FACTOR', 400, '辅单位换算率必须是大于等于 2 的整数')
  }
  if (normalized.auxSellPrice != null && (!Number.isFinite(Number(normalized.auxSellPrice)) || Number(normalized.auxSellPrice) <= 0)) {
    throw new ProductUnitError('INVALID_AUX_PRICE', 400, '辅单位售价必须大于 0')
  }
  if (normalized.auxEnabled && (!normalized.auxUnitName || !normalized.auxBarcode || normalized.auxConversionFactor == null || normalized.auxSellPrice == null)) {
    throw new ProductUnitError('AUX_UNIT_CONFIG_INCOMPLETE', 400, '启用辅单位前必须填写单位、条码、换算率和售价')
  }
  return normalized
}

export function productUnitSnapshot(unit: ResolvedProductUnit) {
  return {
    barcode: unit.barcode,
    unitPrice: unit.unitPrice,
    quantity: unit.baseQuantity,
    lineAmount: unit.lineAmount,
    ...(unit.multiUnitEligible ? {
      sellingUnitType: unit.sellingUnitType,
      sellingUnitNameSnapshot: unit.sellingUnitName,
      sellingQuantity: unit.sellingQuantity,
      sellingConversionFactor: unit.conversionFactor,
    } : {}),
  }
}

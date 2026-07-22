import {
  PRODUCT_IMPORT_FIELDS,
  type ProductImportField,
  type ProductImportPreviewRow,
} from './product-spreadsheet'

const IMPORT_FIELD_SET = new Set<ProductImportField>(PRODUCT_IMPORT_FIELDS)

export type ProductImportUpdateData = {
  sku?: string | null
  name?: string
  nameZh?: string | null
  nameEn?: string | null
  nameKm?: string | null
  descZh?: string | null
  descEn?: string | null
  descKm?: string | null
  spec?: string | null
  sellPrice?: string
  status?: 'ACTIVE' | 'DISABLED'
  categoryId?: string | null
  imageUrl?: string | null
  imageUrls?: string | null
  imageStorageKey?: string | null
  imageStorageKeys?: string | null
}

/** 只接受服务端已知字段，防止确认请求借由 providedFields 扩展写入面。 */
export function providedImportFields(row: Pick<ProductImportPreviewRow, 'providedFields'>): Set<ProductImportField> {
  return new Set(
    (Array.isArray(row.providedFields) ? row.providedFields : [])
      .filter((field): field is ProductImportField => typeof field === 'string' && IMPORT_FIELD_SET.has(field as ProductImportField)),
  )
}

export function hasImportedField(row: Pick<ProductImportPreviewRow, 'providedFields'>, ...fields: ProductImportField[]): boolean {
  const provided = providedImportFields(row)
  return fields.some((field) => provided.has(field))
}

/**
 * 生成已有商品的最小更新补丁。条码仅用于定位，绝不通过导入更新；未映射字段
 * 完全不出现在 data 中，因此 Prisma 会保留其原值。
 */
export function buildProductImportUpdate(
  row: ProductImportPreviewRow,
  imageUrls: string[],
  categoryId: string | null,
): ProductImportUpdateData {
  const provided = providedImportFields(row)
  const data: ProductImportUpdateData = {}
  if (provided.has('sku')) data.sku = row.sku

  const hasName = ['nameZh', 'nameEn', 'nameKm'].some((field) => provided.has(field as ProductImportField))
  if (hasName) {
    data.name = row.name.trim()
    if (provided.has('nameZh')) data.nameZh = row.nameZh
    if (provided.has('nameEn')) data.nameEn = row.nameEn
    if (provided.has('nameKm')) data.nameKm = row.nameKm
  }
  if (provided.has('descZh')) data.descZh = row.descZh
  if (provided.has('descEn')) data.descEn = row.descEn
  if (provided.has('descKm')) data.descKm = row.descKm
  if (provided.has('spec')) data.spec = row.spec
  if (provided.has('sellPrice')) data.sellPrice = String(row.sellPrice)
  if (provided.has('status')) data.status = row.status
  if (provided.has('category1')) data.categoryId = categoryId

  if (provided.has('imageUrl') || provided.has('imageUrls')) {
    data.imageUrl = imageUrls[0] ?? null
    data.imageUrls = imageUrls.length > 0 ? JSON.stringify(imageUrls) : null
    // 外部表格图片不携带本系统 storage key，覆盖图片引用时同步移除旧 key。
    data.imageStorageKey = null
    data.imageStorageKeys = null
  }
  return data
}

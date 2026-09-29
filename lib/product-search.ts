export type ProductSearchFields = {
  name?: string | null
  barcode?: string | null
  sku?: string | null
  spec?: string | null
}

/** Search identity fields independently; SKU is not a barcode alias. */
export function matchesProductSearch(product: ProductSearchFields, rawQuery: string): boolean {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  return [product.name, product.barcode, product.sku, product.spec]
    .some((value) => (value ?? '').toLowerCase().includes(query))
}

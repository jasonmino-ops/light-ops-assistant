export type BrowserPosDisplayLang = 'zh' | 'en' | 'km'

/**
 * Build the customer-display target only from the Browser POS page's already
 * authorized store context. This helper deliberately returns no URL for a
 * missing store rather than falling back to a storeCode-less display page.
 */
export function browserPosCustomerDisplayPath(
  storeCode: string | null | undefined,
  lang: BrowserPosDisplayLang,
) {
  const verifiedStoreCode = storeCode?.trim() ?? ''
  if (!verifiedStoreCode) return null

  const params = new URLSearchParams({ storeCode: verifiedStoreCode, lang })
  return `/desktop/display?${params.toString()}`
}

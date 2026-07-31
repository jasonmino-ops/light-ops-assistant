export type BrowserPosDisplayLang = 'zh' | 'en' | 'km'

export function browserPosCustomerDisplayPath(
  storeCode: string | null | undefined,
  lang: BrowserPosDisplayLang,
) {
  const verifiedStoreCode = storeCode?.trim() ?? ''
  if (!verifiedStoreCode) return null

  const params = new URLSearchParams({ storeCode: verifiedStoreCode, lang })
  return `/desktop/display?${params.toString()}`
}

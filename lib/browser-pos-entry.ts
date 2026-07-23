export type BrowserPosEntryLang = 'zh' | 'en' | 'km'

function normalizeLang(value: string | null | undefined): BrowserPosEntryLang {
  return value === 'zh' || value === 'km' ? value : 'en'
}

/** The only post-bind destination for the browser POS shared-link flow. */
export function browserPosReturnTo(storeCode: string, lang: string | null | undefined) {
  const params = new URLSearchParams({
    storeCode,
    lang: normalizeLang(lang),
    mode: 'pos',
  })
  return `/desktop/pos?${params.toString()}`
}

/** Adds only a safe, token-free local return destination to an owner shared URL. */
export function browserPosSharedLinkUrl(
  shareUrl: string,
  input: { storeCode: string; lang: string | null | undefined; origin: string },
) {
  const url = new URL(shareUrl, input.origin)
  url.searchParams.set('returnTo', browserPosReturnTo(input.storeCode, input.lang))
  return url.toString()
}

/**
 * A shared capability must never become an open redirect. Bind only returns to
 * the bound store's employee POS page and preserves the supported language.
 */
export function resolveBrowserPosReturnTo(
  returnTo: string | null | undefined,
  input: { storeCode: string; origin: string },
) {
  const fallback = browserPosReturnTo(input.storeCode, 'en')
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return fallback
  try {
    const target = new URL(returnTo, input.origin)
    if (target.origin !== input.origin || target.pathname !== '/desktop/pos') return fallback
    if (target.searchParams.get('storeCode') !== input.storeCode) return fallback
    return browserPosReturnTo(input.storeCode, target.searchParams.get('lang'))
  } catch {
    return fallback
  }
}

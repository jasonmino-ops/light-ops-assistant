export function isDesktopRecordsRoute(pathname: string, search = '') {
  if (pathname !== '/records') return false

  const params = new URLSearchParams(search)
  return params.get('from') === 'desktop' && !!params.get('storeCode')?.trim()
}

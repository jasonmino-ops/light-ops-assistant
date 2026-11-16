const attempts = new Map<string, string>()

// Keep the request identity through a network error and a same-tab reload.
// The stored value contains only a payload digest and a random identifier.
export async function posRequestKey(operation: string, body: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  const fingerprint = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  const scope = `eshop.pos.request.${operation}.${fingerprint}`
  let key = attempts.get(scope)
  try { key ??= sessionStorage.getItem(scope) ?? undefined } catch { /* in-memory fallback */ }
  key ??= crypto.randomUUID()
  attempts.set(scope, key)
  try { sessionStorage.setItem(scope, key) } catch { /* in-memory fallback */ }
  return key
}

export function finishPosRequest(key: string, response: Response): void {
  if (response.status >= 500 || [408, 425, 429].includes(response.status)) return
  for (const [scope, value] of attempts) {
    if (value !== key) continue
    attempts.delete(scope)
    try { sessionStorage.removeItem(scope) } catch { /* in-memory fallback */ }
  }
}

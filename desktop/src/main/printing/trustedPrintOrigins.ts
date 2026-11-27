import { createHash } from 'node:crypto'
import type { WebContents } from 'electron'

type Role = 'FRONT' | 'KITCHEN'
type Batch = { tenantId: string; storeId: string; ownerDeviceId: string; executionStartAt?: string }
type NetworkEvent = { webContentsId?: number; frame?: unknown; method: string; url: string; resourceType: string }
const header = 'x-eshop-print-origin'
const id = /^[A-Za-z0-9._:-]{1,128}$/
const cashier = /^\/api\/cashier\/(?:sales|member-balance-pay)$/
const dining = /^\/api\/dine-in\/sessions\/[A-Za-z0-9_-]+\/(kitchen\/claim|settle)$/

// The main process observes the network response before the employee's fetch resolves.
// No renderer IPC or response body is accepted into this cache.
export class TrustedPrintOrigins {
  private facts = new Map<string, number | null>()

  attach(web: WebContents, baseUrl: string) {
    this.facts.clear()
    const origin = new URL(baseUrl).origin
    if (!origin.startsWith('https://')) return
    const filter = { urls: [origin + '/api/cashier/*', origin + '/api/dine-in/sessions/*'] }
    const eligible = (d: NetworkEvent) => {
      if (web.isDestroyed() || d.webContentsId !== web.id || !d.frame || d.frame !== web.mainFrame ||
          d.method !== 'POST' || d.resourceType !== 'xhr') return false
      const url = new URL(d.url)
      return url.origin === origin && new URL(web.mainFrame.url).origin === origin &&
        (cashier.test(url.pathname) || dining.test(url.pathname))
    }
    web.session.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const headers = details.requestHeaders
      if (eligible(details)) headers['X-EShop-Print-Origin-Version'] = '1'
      callback({ requestHeaders: headers })
    })
    web.session.webRequest.onResponseStarted(filter, details => {
      if (!eligible(details) || details.fromCache || ![200, 201].includes(details.statusCode)) return
      const values = Object.entries(details.responseHeaders ?? {}).filter(([k]) => k.toLowerCase() === header)
      if (values.length !== 1 || values[0][1].length !== 1) return
      this.observe(values[0][1][0], new URL(details.url).pathname)
    })
  }

  private observe(value: string, endpoint: string) {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(value)) return
    let fact
    try { fact = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { return }
    if (!fact || ![fact.tenantId, fact.storeId, fact.deviceId, fact.orderNo].every(v => typeof v === 'string' && id.test(v)) ||
        !Array.isArray(fact.roles) || fact.roles.length < 1 || fact.roles.length > 2 ||
        !fact.roles.every((r: unknown) => r === 'FRONT' || r === 'KITCHEN')) return
    const purpose = dining.exec(endpoint)?.[1]
    if (purpose && (fact.roles.length !== 1 || fact.roles[0] !== (purpose === 'settle' ? 'FRONT' : 'KITCHEN'))) return
    const born = Date.parse(fact.occurredAt)
    if (!Number.isFinite(born) || new Date(born).toISOString() !== fact.occurredAt) return
    for (const role of fact.roles as Role[]) {
      const effect = 'network:' + createHash('sha256').update('cashier-network-v2:' + fact.orderNo + ':' + role).digest('hex')
      const key = JSON.stringify([fact.tenantId, fact.storeId, fact.deviceId, effect, role])
      const previous = this.facts.get(key)
      this.facts.set(key, previous === undefined || previous === born ? born : null)
    }
    while (this.facts.size > 4096) this.facts.delete(this.facts.keys().next().value!)
  }

  eligible(batch: Batch, role: Role, effect: string): boolean | null {
    const key = JSON.stringify([batch.tenantId, batch.storeId, batch.ownerDeviceId, effect, role])
    const born = this.facts.get(key)
    return born == null || !batch.executionStartAt ? null : born > Date.parse(batch.executionStartAt)
  }
}

export const trustedPrintOrigins = new TrustedPrintOrigins()

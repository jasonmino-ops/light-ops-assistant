import { createHash } from 'node:crypto'
import type { ExecutionBatchProjection } from './controlPlaneClient'
import type { OutboxEntry } from './executionOutbox'
import type { PrintIntentSource } from './localFirstPrintCoordinator'
import type { PrinterRole } from './localEndpointAuthority'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>
type DeliveredBase = { printJobId: string; source: PrintIntentSource; role: PrinterRole; rendererVersion: string; expiresAt: string }
export type DeliveredV3Job = DeliveredBase & ({ payloadKind: 'RAW_BYTES'; payload: Uint8Array } | { payloadKind: 'NETWORK_REQUEST'; networkRequest: unknown })
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }

export class V3PrintJobClient {
  private readonly baseUrl: string
  public constructor(baseUrl: string, private readonly token: string, private readonly fetchImpl: FetchLike = fetch) { this.baseUrl = baseUrl.replace(/\/+$/, '') }
  public async receive(batch: ExecutionBatchProjection): Promise<{ ok: true; job: DeliveredV3Job | null } | { ok: false }> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/desktop/v3-print-jobs?batchId=${encodeURIComponent(batch.id)}`, { method: 'GET', headers: { Authorization: `Bearer ${this.token}` } })
      const body = record(await response.json().catch(() => null))
      if (!response.ok || body?.ok !== true) return { ok: false }
      if (body.job === null) return { ok: true, job: null }
      const job = record(body.job), intent = record(job?.intent)
      if (!job || !intent || job.printJobId !== intent.printJobId || typeof job.expiresAt !== 'string' || !Number.isFinite(Date.parse(job.expiresAt)) || intent.schemaVersion !== 3 ||
        !['LOCAL_DESKTOP', 'CLOUD_H5', 'CLOUD_THIRD_PARTY', 'CLOUD_REMOTE_REPRINT'].includes(String(intent.source)) ||
        (intent.role !== 'FRONT' && intent.role !== 'KITCHEN') || typeof intent.rendererVersion !== 'string' || typeof intent.payloadHash !== 'string') return { ok: false }
      const base = { printJobId: job.printJobId as string, source: intent.source as PrintIntentSource, role: intent.role as PrinterRole,
        rendererVersion: intent.rendererVersion, expiresAt: job.expiresAt }
      if (intent.payloadKind === 'RAW_BYTES' && typeof intent.payloadBase64 === 'string' && Number.isInteger(intent.byteLength)) {
        const payload = Buffer.from(intent.payloadBase64, 'base64')
        if (payload.length !== intent.byteLength || payload.toString('base64') !== intent.payloadBase64 || createHash('sha256').update(payload).digest('hex') !== intent.payloadHash) return { ok: false }
        return { ok: true, job: { ...base, payloadKind: 'RAW_BYTES', payload: new Uint8Array(payload) } }
      }
      if (intent.payloadKind === 'NETWORK_REQUEST' && intent.networkRequest && typeof intent.networkRequest === 'object' &&
        createHash('sha256').update(JSON.stringify(intent.networkRequest)).digest('hex') === intent.payloadHash) {
        return { ok: true, job: { ...base, payloadKind: 'NETWORK_REQUEST', networkRequest: intent.networkRequest } }
      }
      return { ok: false }
    } catch { return { ok: false } }
  }
  public async holdLocal(input: { orderNo: string; printJobId: string; role: PrinterRole; rendererVersion: string; expiresAt: string; payload: Uint8Array }): Promise<'DURABLY_HELD' | 'DURABLY_ACCEPTED' | null> {
    try {
      const bytes = Buffer.from(input.payload)
      const response = await this.fetchImpl(`${this.baseUrl}/api/desktop/v3-print-jobs`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'HOLD_LOCAL', orderNo: input.orderNo, printJobId: input.printJobId, role: input.role,
          rendererVersion: input.rendererVersion, expiresAt: input.expiresAt, payloadBase64: bytes.toString('base64'), byteLength: bytes.length,
          payloadHash: createHash('sha256').update(bytes).digest('hex') }) })
      const body = record(await response.json().catch(() => null))
      return response.ok && body?.ok === true && (body.status === 'DURABLY_HELD' || body.status === 'DURABLY_ACCEPTED') ? body.status : null
    } catch { return null }
  }
  public async report(entry: OutboxEntry): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/desktop/v3-print-jobs`, { method: 'POST', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REPORT', batchId: entry.batchId, printJobId: entry.printJobId, source: entry.source, role: entry.role,
          executionId: entry.executionId, ownerEpoch: entry.ownerEpoch, outcome: entry.outcome, reportVersion: entry.factVersion }) })
      const body = record(await response.json().catch(() => null))
      return response.ok && body?.ok === true && body.acknowledged === true
    } catch { return false }
  }
}

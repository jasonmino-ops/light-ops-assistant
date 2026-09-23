export type ControlPlaneProjection = {
  id: string
  tenantId: string
  storeId: string
  ownerDeviceId: string | null
  ownerEpoch: number
  leaseId: string | null
  leaseExpiresAt: string | null
  mode: 'V2_ACTIVE' | 'V2_DRAINING' | 'V3_ACTIVE' | 'V3_DRAINING' | 'BLOCKED_UNKNOWN'
  stateVersion: number
  updatedAt: string
}

export type ExecutionBatchProjection = {
  id: string
  controlPlaneId: string
  tenantId: string
  storeId: string
  ownerDeviceId: string
  ownerEpoch: number
  stateVersion: number
  leaseId: string
  mode: 'V3_ACTIVE'
  expiresAt: string
  revokedAt: string | null
  createdAt: string
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>
const MODES = new Set(['V2_ACTIVE', 'V2_DRAINING', 'V3_ACTIVE', 'V3_DRAINING', 'BLOCKED_UNKNOWN'])

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function projection(value: unknown): ControlPlaneProjection | null {
  const row = record(value)
  if (!row || typeof row.id !== 'string' || typeof row.tenantId !== 'string' || typeof row.storeId !== 'string' ||
    (row.ownerDeviceId !== null && typeof row.ownerDeviceId !== 'string') || !Number.isInteger(row.ownerEpoch) ||
    (row.leaseId !== null && typeof row.leaseId !== 'string') || (row.leaseExpiresAt !== null && typeof row.leaseExpiresAt !== 'string') ||
    typeof row.mode !== 'string' || !MODES.has(row.mode) || !Number.isInteger(row.stateVersion) || typeof row.updatedAt !== 'string') return null
  return row as unknown as ControlPlaneProjection
}

function batch(value: unknown): ExecutionBatchProjection | null {
  const row = record(value)
  if (!row || typeof row.id !== 'string' || typeof row.controlPlaneId !== 'string' || typeof row.tenantId !== 'string' ||
    typeof row.storeId !== 'string' || typeof row.ownerDeviceId !== 'string' || !Number.isInteger(row.ownerEpoch) ||
    !Number.isInteger(row.stateVersion) || typeof row.leaseId !== 'string' || row.mode !== 'V3_ACTIVE' ||
    typeof row.expiresAt !== 'string' || typeof row.createdAt !== 'string' || (row.revokedAt !== null && typeof row.revokedAt !== 'string')) return null
  return row as unknown as ExecutionBatchProjection
}

export class V3ControlPlaneClient {
  private readonly baseUrl: string
  public constructor(baseUrl: string, private readonly deviceToken: string, private readonly fetchImpl: FetchLike = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  public read(): Promise<{ ok: true; controlPlane: ControlPlaneProjection } | { ok: false; error: string }> {
    return this.request('GET')
  }

  public acquire(): Promise<{ ok: true; controlPlane: ControlPlaneProjection } | { ok: false; error: string }> {
    return this.request('POST', { action: 'ACQUIRE' })
  }

  public renew(authority: ControlPlaneProjection): Promise<{ ok: true; controlPlane: ControlPlaneProjection } | { ok: false; error: string }> {
    return this.request('POST', { action: 'RENEW', ownerEpoch: authority.ownerEpoch, stateVersion: authority.stateVersion, leaseId: authority.leaseId })
  }

  public release(authority: ControlPlaneProjection): Promise<{ ok: true; controlPlane: ControlPlaneProjection } | { ok: false; error: string }> {
    return this.request('POST', { action: 'RELEASE', ownerEpoch: authority.ownerEpoch, stateVersion: authority.stateVersion, leaseId: authority.leaseId })
  }

  public issueBatch(authority: ControlPlaneProjection): Promise<{ ok: true; batch: ExecutionBatchProjection } | { ok: false; error: string }> {
    return this.request('POST', { action: 'ISSUE_BATCH', ownerEpoch: authority.ownerEpoch, stateVersion: authority.stateVersion, leaseId: authority.leaseId })
  }

  private async request(method: 'GET' | 'POST', body?: unknown): Promise<any> {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/desktop/v3-print-control-plane`, {
        method,
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.deviceToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const parsed = record(await response.json().catch(() => null))
      if (!response.ok || parsed?.ok !== true) return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : 'CONTROL_PLANE_UNAVAILABLE' }
      if (parsed.controlPlane) {
        const value = projection(parsed.controlPlane)
        return value ? { ok: true, controlPlane: value } : { ok: false, error: 'CONTROL_PLANE_INVALID_RESPONSE' }
      }
      const value = batch(parsed.batch)
      return value ? { ok: true, batch: value } : { ok: false, error: 'CONTROL_PLANE_INVALID_RESPONSE' }
    } catch {
      return { ok: false, error: 'CONTROL_PLANE_NETWORK_ERROR' }
    }
  }
}

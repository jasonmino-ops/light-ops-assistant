import type { V3ControlPlaneClient, ControlPlaneProjection, ExecutionBatchProjection } from './controlPlaneClient'

export type V3RuntimeSnapshot = {
  status: 'STOPPED' | 'RECONCILING' | 'V2_ACTIVE' | 'BLOCKED_UNKNOWN' | 'V3_OWNER' | 'FENCED'
  controlPlane: ControlPlaneProjection | null
  batch: ExecutionBatchProjection | null
}

export class V3ControlPlaneRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private snapshot: V3RuntimeSnapshot = { status: 'STOPPED', controlPlane: null, batch: null }

  public constructor(
    private readonly client: V3ControlPlaneClient,
    private readonly deviceId: string,
    private readonly intervalMs = 30_000,
  ) {}

  public current(): V3RuntimeSnapshot {
    return { ...this.snapshot }
  }

  public async start(): Promise<void> {
    if (this.running) return
    this.running = true
    this.snapshot = { status: 'RECONCILING', controlPlane: null, batch: null }
    await this.reconcile()
    if (this.running) this.timer = setInterval(() => { void this.reconcile() }, this.intervalMs)
  }

  public async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const current = this.snapshot.controlPlane
    if (current?.ownerDeviceId === this.deviceId && current.leaseId) await this.client.release(current)
    this.snapshot = { status: 'STOPPED', controlPlane: null, batch: null }
  }

  public validateExecution(): { ok: true; value: void } | { ok: false; error: { code: string; message: string } } {
    const { controlPlane, batch } = this.snapshot
    const now = Date.now()
    if (this.snapshot.status !== 'V3_OWNER' || !controlPlane || !batch ||
      controlPlane.ownerDeviceId !== this.deviceId || controlPlane.mode !== 'V3_ACTIVE' ||
      !controlPlane.leaseId || batch.leaseId !== controlPlane.leaseId || batch.ownerEpoch !== controlPlane.ownerEpoch ||
      batch.stateVersion !== controlPlane.stateVersion || Date.parse(batch.expiresAt) <= now) {
      return { ok: false, error: { code: 'CONTROL_PLANE_FENCED', message: 'Authoritative V3 execution authority is unavailable.' } }
    }
    return { ok: true, value: undefined }
  }

  private async reconcile(): Promise<void> {
    if (!this.running) return
    const read = await this.client.read()
    if (!read.ok) {
      if (this.snapshot.status !== 'V3_OWNER' || !this.snapshot.batch || Date.parse(this.snapshot.batch.expiresAt) <= Date.now()) {
        this.snapshot = { status: 'FENCED', controlPlane: null, batch: null }
      }
      return
    }
    let controlPlane = read.controlPlane
    if (controlPlane.mode !== 'V3_ACTIVE') {
      this.snapshot = { status: controlPlane.mode === 'V2_ACTIVE' ? 'V2_ACTIVE' : 'BLOCKED_UNKNOWN', controlPlane, batch: null }
      return
    }
    if (controlPlane.ownerDeviceId === null) {
      const acquired = await this.client.acquire()
      if (!acquired.ok) {
        this.snapshot = { status: 'FENCED', controlPlane, batch: null }
        return
      }
      controlPlane = acquired.controlPlane
    } else if (controlPlane.ownerDeviceId === this.deviceId) {
      const renewed = await this.client.renew(controlPlane)
      if (!renewed.ok) {
        if (this.snapshot.status !== 'V3_OWNER' || !this.snapshot.batch ||
          this.snapshot.batch.ownerEpoch !== controlPlane.ownerEpoch || this.snapshot.batch.leaseId !== controlPlane.leaseId ||
          Date.parse(this.snapshot.batch.expiresAt) <= Date.now()) {
          this.snapshot = { status: 'FENCED', controlPlane, batch: null }
        }
        return
      }
      controlPlane = renewed.controlPlane
    } else {
      this.snapshot = { status: 'FENCED', controlPlane, batch: null }
      return
    }
    const issued = await this.client.issueBatch(controlPlane)
    this.snapshot = issued.ok
      ? { status: 'V3_OWNER', controlPlane, batch: issued.batch }
      : { status: 'FENCED', controlPlane, batch: null }
  }
}

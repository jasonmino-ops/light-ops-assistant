import type { V3ControlPlaneClient, ControlPlaneProjection, ExecutionBatchProjection } from './controlPlaneClient'

export type V3RuntimeSnapshot = {
  status: 'STOPPED' | 'RECONCILING' | 'V2_ACTIVE' | 'BLOCKED_UNKNOWN' | 'V3_OWNER' | 'FENCED'
  controlPlane: ControlPlaneProjection | null
  batch: ExecutionBatchProjection | null
}

export type V3ExecutionLifecycleGuard = {
  complete(input: { releaseSafe: boolean }): Promise<void>
}

function sameAuthority(left: ControlPlaneProjection | null, right: ControlPlaneProjection): boolean {
  return left?.ownerDeviceId === right.ownerDeviceId && left?.ownerEpoch === right.ownerEpoch &&
    left?.stateVersion === right.stateVersion && left?.leaseId === right.leaseId
}

export class V3ControlPlaneRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private executionLifecycleReady = false
  private activeExecutions = 0
  private releaseBlocked = false
  private drainingAuthority: ControlPlaneProjection | null = null
  private releasePromise: Promise<void> | null = null
  private reconcileGeneration = 0
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
    this.reconcileGeneration += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const current = this.snapshot.controlPlane
    if (this.executionLifecycleReady && this.activeExecutions === 0 && !this.releaseBlocked &&
      current?.ownerDeviceId === this.deviceId && current.leaseId) await this.client.release(current)
    this.snapshot = { status: 'STOPPED', controlPlane: null, batch: null }
  }

  public async markExecutionLifecycleReady(input: { releaseBlocked?: boolean } = {}): Promise<void> {
    if (input.releaseBlocked) this.releaseBlocked = true
    this.executionLifecycleReady = true
    await this.releaseDrainingAuthorityIfSafe()
  }

  public beginExecutionLifecycle():
    | { ok: true; guard: V3ExecutionLifecycleGuard }
    | { ok: false; error: { code: string; message: string } } {
    const validation = this.validateExecution()
    if (!validation.ok) return validation
    this.activeExecutions += 1
    let completed = false
    return {
      ok: true,
      guard: {
        complete: async ({ releaseSafe }) => {
          if (completed) return
          completed = true
          if (!releaseSafe) this.releaseBlocked = true
          this.activeExecutions -= 1
          await this.releaseDrainingAuthorityIfSafe()
        },
      },
    }
  }

  public validateExecution(): { ok: true; value: void } | { ok: false; error: { code: string; message: string } } {
    const { controlPlane, batch } = this.snapshot
    const now = Date.now()
    if (!this.running || !this.executionLifecycleReady || this.releaseBlocked || this.snapshot.status !== 'V3_OWNER' || !controlPlane || !batch ||
      controlPlane.ownerDeviceId !== this.deviceId || controlPlane.mode !== 'V3_ACTIVE' ||
      !controlPlane.leaseId || batch.leaseId !== controlPlane.leaseId || batch.ownerEpoch !== controlPlane.ownerEpoch ||
      batch.stateVersion !== controlPlane.stateVersion || Date.parse(batch.expiresAt) <= now) {
      return { ok: false, error: { code: 'CONTROL_PLANE_FENCED', message: 'Authoritative V3 execution authority is unavailable.' } }
    }
    return { ok: true, value: undefined }
  }

  private async reconcile(): Promise<void> {
    if (!this.running) return
    const generation = ++this.reconcileGeneration
    const read = await this.client.read()
    if (!this.running || generation !== this.reconcileGeneration) return
    if (!read.ok) {
      if (this.snapshot.status !== 'V3_OWNER' || !this.snapshot.batch || Date.parse(this.snapshot.batch.expiresAt) <= Date.now()) {
        this.snapshot = { status: 'FENCED', controlPlane: null, batch: null }
      }
      return
    }
    let controlPlane = read.controlPlane
    if (controlPlane.mode === 'V3_DRAINING') {
      this.snapshot = { status: 'BLOCKED_UNKNOWN', controlPlane, batch: null }
      this.drainingAuthority = controlPlane.ownerDeviceId === this.deviceId && controlPlane.leaseId
        ? (sameAuthority(this.drainingAuthority, controlPlane) ? this.drainingAuthority : controlPlane)
        : null
      await this.releaseDrainingAuthorityIfSafe()
      return
    }
    this.drainingAuthority = null
    if (controlPlane.mode !== 'V3_ACTIVE') {
      this.snapshot = { status: controlPlane.mode === 'V2_ACTIVE' ? 'V2_ACTIVE' : 'BLOCKED_UNKNOWN', controlPlane, batch: null }
      return
    }
    if (controlPlane.ownerDeviceId === null) {
      const acquired = await this.client.acquire()
      if (!this.running || generation !== this.reconcileGeneration) return
      if (!acquired.ok) {
        this.snapshot = { status: 'FENCED', controlPlane, batch: null }
        return
      }
      controlPlane = acquired.controlPlane
    } else if (controlPlane.ownerDeviceId === this.deviceId) {
      const renewed = await this.client.renew(controlPlane)
      if (!this.running || generation !== this.reconcileGeneration) return
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
    if (!this.running || generation !== this.reconcileGeneration) return
    this.snapshot = issued.ok
      ? { status: 'V3_OWNER', controlPlane, batch: issued.batch }
      : { status: 'FENCED', controlPlane, batch: null }
  }

  private async releaseDrainingAuthorityIfSafe(): Promise<void> {
    if (!this.running || !this.executionLifecycleReady || this.activeExecutions !== 0 || this.releaseBlocked ||
      !this.drainingAuthority || this.releasePromise) return
    const authority = this.drainingAuthority
    this.releasePromise = (async () => {
      const released = await this.client.release(authority)
      if (!released.ok || !sameAuthority(this.drainingAuthority, authority)) return
      this.drainingAuthority = null
      this.snapshot = { status: 'BLOCKED_UNKNOWN', controlPlane: released.controlPlane, batch: null }
    })().finally(() => { this.releasePromise = null })
    await this.releasePromise
  }
}

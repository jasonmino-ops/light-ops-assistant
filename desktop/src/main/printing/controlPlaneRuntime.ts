import type { V3ControlPlaneClient, ControlPlaneProjection, ExecutionBatchProjection } from './controlPlaneClient'
import type { ExecutionAuthority } from './executionAuthority'

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

function sameExecutionLineage(left: ControlPlaneProjection, right: ControlPlaneProjection): boolean {
  return left.id === right.id && left.storeId === right.storeId && left.ownerDeviceId === right.ownerDeviceId &&
    left.ownerEpoch === right.ownerEpoch && left.leaseId === right.leaseId
}

function sameBatch(left: ExecutionBatchProjection | null, right: ExecutionBatchProjection): boolean {
  return left?.id === right.id && left?.controlPlaneId === right.controlPlaneId && left?.tenantId === right.tenantId &&
    left?.storeId === right.storeId && left?.ownerDeviceId === right.ownerDeviceId && left?.ownerEpoch === right.ownerEpoch &&
    left?.stateVersion === right.stateVersion && left?.leaseId === right.leaseId && left?.mode === right.mode &&
    left?.expiresAt === right.expiresAt && left?.revokedAt === right.revokedAt && left?.createdAt === right.createdAt
}

function batchMatchesAuthority(batch: ExecutionBatchProjection, authority: ExecutionAuthority): boolean {
  return batch.id === authority.batchId && batch.storeId === authority.storeId && batch.ownerDeviceId === authority.deviceId &&
    batch.ownerEpoch === authority.ownerEpoch && batch.leaseId === authority.leaseId && batch.expiresAt === authority.batchExpiresAt
}

function controlPlaneContinuesBatch(controlPlane: ControlPlaneProjection, batch: ExecutionBatchProjection): boolean {
  return controlPlane.id === batch.controlPlaneId && controlPlane.storeId === batch.storeId && controlPlane.mode === 'V3_ACTIVE' &&
    controlPlane.ownerDeviceId === batch.ownerDeviceId && controlPlane.ownerEpoch === batch.ownerEpoch &&
    controlPlane.leaseId === batch.leaseId
}

export class V3ControlPlaneRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private executionLifecycleReady = false
  private activeExecutions = 0
  private readonly activeExecutionBatches = new Map<string, { batch: ExecutionBatchProjection; count: number }>()
  private authorityRotationsInProgress = 0
  private pendingAuthoritySnapshot: V3RuntimeSnapshot | null = null
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
    if (this.activeExecutions === 0) this.adoptPendingAuthorityIfSafe()
    this.running = false
    this.reconcileGeneration += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const current = this.snapshot.controlPlane
    if (this.executionLifecycleReady && this.activeExecutions === 0 && !this.releaseBlocked &&
      current?.ownerDeviceId === this.deviceId && current.leaseId) await this.client.release(current)
    this.pendingAuthoritySnapshot = null
    this.snapshot = { status: 'STOPPED', controlPlane: null, batch: null }
  }

  public async markExecutionLifecycleReady(input: { releaseBlocked?: boolean } = {}): Promise<void> {
    if (input.releaseBlocked) this.releaseBlocked = true
    this.executionLifecycleReady = true
    await this.releaseDrainingAuthorityIfSafe()
  }

  public beginExecutionLifecycle(admittedBatch: ExecutionBatchProjection):
    | { ok: true; guard: V3ExecutionLifecycleGuard }
    | { ok: false; error: { code: string; message: string } } {
    const validation = this.validateExecution()
    if (!validation.ok) return validation
    const batch = admittedBatch
    if (!sameBatch(this.snapshot.batch, batch)) return this.fenced()
    this.activeExecutions += 1
    const active = this.activeExecutionBatches.get(batch.id)
    this.activeExecutionBatches.set(batch.id, { batch, count: (active?.count ?? 0) + 1 })
    let completed = false
    return {
      ok: true,
      guard: {
        complete: async ({ releaseSafe }) => {
          if (completed) return
          completed = true
          if (!releaseSafe) this.releaseBlocked = true
          this.activeExecutions -= 1
          const current = this.activeExecutionBatches.get(batch.id)
          if (current?.count === 1) this.activeExecutionBatches.delete(batch.id)
          else if (current) this.activeExecutionBatches.set(batch.id, { batch: current.batch, count: current.count - 1 })
          this.adoptPendingAuthorityIfSafe()
          await this.releaseDrainingAuthorityIfSafe()
        },
      },
    }
  }

  public validateExecution(): { ok: true; value: void } | { ok: false; error: { code: string; message: string } } {
    const { controlPlane, batch } = this.snapshot
    const now = Date.now()
    if (!this.running || !this.executionLifecycleReady || this.releaseBlocked || this.authorityRotationsInProgress !== 0 ||
      this.pendingAuthoritySnapshot || this.snapshot.status !== 'V3_OWNER' || !controlPlane || !batch ||
      controlPlane.ownerDeviceId !== this.deviceId || controlPlane.mode !== 'V3_ACTIVE' ||
      !controlPlane.leaseId || batch.leaseId !== controlPlane.leaseId || batch.ownerEpoch !== controlPlane.ownerEpoch ||
      batch.stateVersion !== controlPlane.stateVersion || Date.parse(batch.expiresAt) <= now) {
      return this.fenced()
    }
    return { ok: true, value: undefined }
  }

  public validateAdmittedExecution(authority: ExecutionAuthority):
    { ok: true; value: void } | { ok: false; error: { code: string; message: string } } {
    const active = this.activeExecutionBatches.get(authority.batchId)
    const controlPlane = this.pendingAuthoritySnapshot?.controlPlane ?? this.snapshot.controlPlane
    if (!this.running || !this.executionLifecycleReady || this.releaseBlocked || !active || active.count < 1 ||
      !batchMatchesAuthority(active.batch, authority) || !controlPlane || !controlPlaneContinuesBatch(controlPlane, active.batch) ||
      Date.parse(active.batch.expiresAt) <= Date.now()) return this.fenced()
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
      this.pendingAuthoritySnapshot = null
      this.snapshot = { status: 'BLOCKED_UNKNOWN', controlPlane, batch: null }
      this.drainingAuthority = controlPlane.ownerDeviceId === this.deviceId && controlPlane.leaseId
        ? (sameAuthority(this.drainingAuthority, controlPlane) ? this.drainingAuthority : controlPlane)
        : null
      await this.releaseDrainingAuthorityIfSafe()
      return
    }
    this.drainingAuthority = null
    if (controlPlane.mode !== 'V3_ACTIVE') {
      this.pendingAuthoritySnapshot = null
      this.snapshot = { status: controlPlane.mode === 'V2_ACTIVE' ? 'V2_ACTIVE' : 'BLOCKED_UNKNOWN', controlPlane, batch: null }
      return
    }

    if (this.pendingAuthoritySnapshot && this.activeExecutions !== 0) {
      const pendingControlPlane = this.pendingAuthoritySnapshot.controlPlane
      if (pendingControlPlane && sameExecutionLineage(pendingControlPlane, controlPlane)) {
        if (controlPlane.stateVersion > pendingControlPlane.stateVersion) {
          this.pendingAuthoritySnapshot = { status: 'FENCED', controlPlane, batch: null }
        }
        return
      }
      this.pendingAuthoritySnapshot = null
    }

    if (this.activeExecutions !== 0 && !this.activeExecutionsContinueUnder(controlPlane)) {
      this.snapshot = { status: 'FENCED', controlPlane, batch: null }
      return
    }

    if (controlPlane.ownerDeviceId !== null && controlPlane.ownerDeviceId !== this.deviceId) {
      this.snapshot = { status: 'FENCED', controlPlane, batch: null }
      return
    }

    this.authorityRotationsInProgress += 1
    try {
      if (controlPlane.ownerDeviceId === null) {
        const acquired = await this.client.acquire()
        if (!this.running || generation !== this.reconcileGeneration) return
        if (!acquired.ok) {
          this.snapshot = { status: 'FENCED', controlPlane, batch: null }
          return
        }
        controlPlane = acquired.controlPlane
      } else {
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
      }

      const issued = await this.client.issueBatch(controlPlane)
      if (!this.running || generation !== this.reconcileGeneration) return
      const next: V3RuntimeSnapshot = issued.ok
        ? { status: 'V3_OWNER', controlPlane, batch: issued.batch }
        : { status: 'FENCED', controlPlane, batch: null }
      if (this.activeExecutions !== 0) this.pendingAuthoritySnapshot = next
      else this.snapshot = next
    } finally {
      this.authorityRotationsInProgress -= 1
    }
  }

  private activeExecutionsContinueUnder(controlPlane: ControlPlaneProjection): boolean {
    for (const active of this.activeExecutionBatches.values()) {
      if (!controlPlaneContinuesBatch(controlPlane, active.batch)) return false
    }
    return this.activeExecutionBatches.size !== 0
  }

  private adoptPendingAuthorityIfSafe(): void {
    if (!this.running || this.activeExecutions !== 0 || !this.pendingAuthoritySnapshot) return
    this.snapshot = this.pendingAuthoritySnapshot
    this.pendingAuthoritySnapshot = null
  }

  private fenced(): { ok: false; error: { code: string; message: string } } {
    return { ok: false, error: { code: 'CONTROL_PLANE_FENCED', message: 'Authoritative V3 execution authority is unavailable.' } }
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

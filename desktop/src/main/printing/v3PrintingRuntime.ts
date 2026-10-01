import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PrintIntentSource } from './localFirstPrintCoordinator'
import { LocalFirstPrintCoordinator } from './localFirstPrintCoordinator'
import { createExecutionLedger, type ExecutionLedger } from './executionLedger'
import { ExecutionOutbox } from './executionOutbox'
import { EndpointMutex } from './endpointMutex'
import { RawTcpEffectBoundary } from './rawTcpEffectBoundary'
import { SharedPrintingCore, type SharedPrintIdentity } from './sharedPrintingCore'
import type { V3ControlPlaneRuntime } from './controlPlaneRuntime'
import type { ExecutionBatchProjection } from './controlPlaneClient'
import { proveProcessDead } from './processLiveness'
import { LocalEndpointAuthority, type PrinterRole } from './localEndpointAuthority'
import type { LocalEndpoint } from './localEndpointAuthority'
import { V3PrintJobClient } from './v3PrintJobClient'
import { V3NetworkRenderer } from './v3NetworkRenderer'
import { NoPayloadEndpointReadiness, type RoleReadinessMask } from './endpointReadiness'

const PRINT_ROLES: readonly PrinterRole[] = ['FRONT', 'KITCHEN']
const NO_ROLES_READY: RoleReadinessMask = Object.freeze({ FRONT: false, KITCHEN: false })

function releaseSafeExecutionResult(result: { status: string; record?: { state?: string } }): boolean {
  if (result.status === 'NOT_EXECUTED') return result.record?.state !== 'CROSSING_UNKNOWN'
  return result.status === 'CROSSED' || result.status === 'FAILED_NOT_CROSSED' || result.status === 'V2_FALLBACK_REQUIRED' ||
    result.status === 'MODE_BLOCKED' || result.status === 'AUTHORITY_REJECTED'
}

export async function hasDurableCrossingUnknown(userDataPath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(userDataPath, '.execution-ledger.json'), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    const records = (parsed as { records?: unknown }).records
    if (!records || typeof records !== 'object' || Array.isArray(records)) return true
    return Object.values(records).some((record) =>
      Boolean(record && typeof record === 'object' && !Array.isArray(record) && (record as { state?: unknown }).state === 'CROSSING_UNKNOWN'))
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

export class V3PrintingRuntime {
  private timer: ReturnType<typeof setInterval> | null = null
  private pumpPromise: Promise<void> | null = null
  private running = false
  private started = false
  private lifecycleGeneration = 0
  private roleReadiness: RoleReadinessMask = NO_ROLES_READY
  private roleReadinessRefreshAt = 0
  private roleReadinessPromise: Promise<void> | null = null
  private constructor(
    private readonly ledger: ExecutionLedger,
    private readonly coordinator: LocalFirstPrintCoordinator<Uint8Array>,
    private readonly controlPlane: V3ControlPlaneRuntime,
    private readonly endpoints: LocalEndpointAuthority,
    private readonly outbox: ExecutionOutbox,
    private readonly cloud: V3PrintJobClient | null,
    private readonly pollIntervalMs: number,
    private readonly networkRenderer: V3NetworkRenderer,
    private readonly releaseBlocked = false,
    private readonly endpointReadiness = new NoPayloadEndpointReadiness(),
    private readonly roleReadinessIntervalMs = 30_000,
  ) {}

  public static async open(options: {
    userDataPath: string
    controlPlane: V3ControlPlaneRuntime
    storeId: string
    deviceId: string
    tcpTimeoutMs?: number
    cloud?: V3PrintJobClient
    cloudPollIntervalMs?: number
  }): Promise<V3PrintingRuntime> {
    const recovery = { hasExclusiveRecoveryAuthority: () => true, proveProcessDead }
    const ledger = createExecutionLedger({ userDataPath: options.userDataPath, staleLockRecovery: recovery })
    const opened = await ledger.open()
    if (!opened.ok) throw new Error(opened.error.code)
    const outbox = new ExecutionOutbox(options.userDataPath)
    await outbox.open()
    const releaseBlocked = await hasDurableCrossingUnknown(options.userDataPath) ||
      outbox.list().some(({ outcome }) => outcome === 'CROSSING_UNKNOWN')
    const shared = new SharedPrintingCore(
      ledger,
      new RawTcpEffectBoundary(options.tcpTimeoutMs ?? 10_000),
      new EndpointMutex({ root: options.userDataPath, staleRecovery: recovery }),
    )
    const authority = {
      canAdmit: (candidate: { batchId: string; storeId: string; deviceId: string; ownerEpoch: number; leaseId: string; batchExpiresAt: string }) => {
        const validation = options.controlPlane.validateAdmittedExecution(candidate)
        if (!validation.ok) {
          return { allowed: false as const, mode: 'FENCED' as const, reason: 'AUTHORITATIVE_CONTROL_PLANE_MISMATCH' }
        }
        return { allowed: true as const, mode: 'CONNECTED' as const }
      },
    }
    const mode = { current: () => {
      const value = options.controlPlane.current().controlPlane?.mode
      if (value === 'V2_ACTIVE') return 'V2_ACTIVE' as const
      if (value === 'V3_ACTIVE') return 'V3_ACTIVE' as const
      if (value === 'V2_DRAINING') return 'V2_DRAINING' as const
      if (value === 'V3_DRAINING') return 'V3_DRAINING' as const
      return 'BLOCKED_UNKNOWN' as const
    } }
    const runtime = new V3PrintingRuntime(ledger, new LocalFirstPrintCoordinator(authority, shared, outbox, mode), options.controlPlane,
      new LocalEndpointAuthority(options.userDataPath, { storeId: options.storeId, deviceId: options.deviceId }), outbox,
      options.cloud ?? null, options.cloudPollIntervalMs ?? 2_000, new V3NetworkRenderer(), releaseBlocked)
    return runtime
  }

  public async start(): Promise<void> {
    if (this.started) return
    this.started = true
    this.running = true
    const generation = ++this.lifecycleGeneration
    try {
      await this.controlPlane.markExecutionLifecycleReady({
        releaseBlocked: this.releaseBlocked,
        expiredSelfRecoveryReadiness: () => this.checkExpiredSelfRecoveryReadiness(generation),
      })
      if (!this.releaseBlocked) await this.refreshRoleReadiness(generation, true)
      if (this.running && generation === this.lifecycleGeneration) this.startCloudPump()
    } catch (error) {
      this.running = false
      this.started = false
      throw error
    }
  }

  public async execute(input: { source: PrintIntentSource; orderNo?: string; identity: SharedPrintIdentity; role: PrinterRole; payload: Uint8Array }) {
    const mode = this.controlPlane.current().controlPlane?.mode ?? 'BLOCKED_UNKNOWN'
    if (input.source === 'LOCAL_DESKTOP' && mode === 'V2_ACTIVE') return { status: 'V2_FALLBACK_REQUIRED' as const }
    const batch = this.controlPlane.current().batch
    if (input.source === 'LOCAL_DESKTOP' && (mode !== 'V3_ACTIVE' || !batch)) return this.holdLocal(input)
    if (!batch) return { status: 'AUTHORITY_REJECTED' as const, mode: 'ADMISSION_CLOSED' as const, reason: 'NO_OWNER_SCOPED_BATCH' }
    const readiness = await this.proveRoleReadiness(input.role, this.lifecycleGeneration)
    if (!readiness) {
      if (input.source === 'LOCAL_DESKTOP') return this.holdLocal(input)
      return { status: 'AUTHORITY_REJECTED' as const, mode: 'ADMISSION_CLOSED' as const, reason: `ENDPOINT_${input.role}_UNAVAILABLE` }
    }
    return this.executeAtReadyEndpoint(input, batch, readiness.endpointKey)
  }

  private async executeAtReadyEndpoint(
    input: { source: PrintIntentSource; orderNo?: string; identity: SharedPrintIdentity; role: PrinterRole; payload: Uint8Array },
    batch: ExecutionBatchProjection,
    endpointKey: string,
  ) {
    const lifecycle = this.controlPlane.beginExecutionLifecycle(batch)
    if (!lifecycle.ok) {
      return { status: 'AUTHORITY_REJECTED' as const, mode: 'FENCED' as const, reason: lifecycle.error.code }
    }
    let releaseSafe = false
    try {
      const result = await this.coordinator.execute({
        mode: 'V3_ACTIVE', source: input.source, role: input.role,
        authority: { batchId: batch.id, storeId: batch.storeId, deviceId: batch.ownerDeviceId, ownerEpoch: batch.ownerEpoch, leaseId: batch.leaseId, batchExpiresAt: batch.expiresAt },
        identity: input.identity, endpointKey, payload: input.payload,
      })
      releaseSafe = releaseSafeExecutionResult(result)
      return result.status === 'V2_FALLBACK_REQUIRED' || result.status === 'MODE_BLOCKED' || result.status === 'AUTHORITY_REJECTED' || result.status === 'REJECTED'
        ? result
        : { ...result, admission: 'DURABLY_ACCEPTED' as const }
    } finally {
      await lifecycle.guard.complete({ releaseSafe })
    }
  }

  private async holdLocal(input: { source: PrintIntentSource; orderNo?: string; identity: SharedPrintIdentity; role: PrinterRole; payload: Uint8Array }) {
    if (!this.cloud || !input.orderNo) return { status: 'REJECTED' as const, reason: 'V3_DURABLE_ADMISSION_UNAVAILABLE' }
    const status = await this.cloud.holdLocal({ orderNo: input.orderNo, printJobId: input.identity.printJobId, role: input.role,
      rendererVersion: input.identity.rendererVersion, expiresAt: input.identity.expiresAt, payload: input.payload })
    return status
      ? { status: 'HELD' as const, admission: 'DURABLY_ACCEPTED' as const, durability: status }
      : { status: 'REJECTED' as const, reason: 'V3_DURABLE_ADMISSION_REJECTED' }
  }

  public provisionEndpoints(input: { revision: number; endpoints: Partial<Record<PrinterRole, LocalEndpoint>> }): Promise<void> {
    return this.endpoints.provision(input)
  }

  public async close(): Promise<void> {
    this.running = false
    this.started = false
    this.lifecycleGeneration += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.pumpPromise
    await this.roleReadinessPromise
    this.networkRenderer.dispose()
    const closed = await this.ledger.close()
    if (!closed.ok) throw new Error(closed.error.code)
  }

  private startCloudPump(): void {
    if (!this.cloud) return
    void this.pump()
    this.timer = setInterval(() => { void this.pump() }, this.pollIntervalMs)
  }

  private async checkExpiredSelfRecoveryReadiness(generation: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (!this.running || generation !== this.lifecycleGeneration) return { ok: false, reason: 'RUNTIME_STOPPED' }
    if (this.releaseBlocked) return { ok: false, reason: 'LOCAL_EFFECT_AMBIGUITY' }
    return { ok: true }
  }

  private async refreshRoleReadiness(generation: number, force = false): Promise<void> {
    if (!this.running || generation !== this.lifecycleGeneration) return
    if (!force && Date.now() < this.roleReadinessRefreshAt) return
    if (this.roleReadinessPromise) return this.roleReadinessPromise
    this.roleReadiness = NO_ROLES_READY
    this.roleReadinessRefreshAt = Date.now() + this.roleReadinessIntervalMs
    this.roleReadinessPromise = (async () => {
      const configured = await this.endpoints.configuredForRecovery()
      if (!this.running || generation !== this.lifecycleGeneration || !configured.ok) return
      const ready = await this.endpointReadiness.check(configured.endpoints)
      if (!this.running || generation !== this.lifecycleGeneration || !ready.ok) return
      this.roleReadiness = Object.freeze({ ...ready.roles })
    })().finally(() => { this.roleReadinessPromise = null })
    await this.roleReadinessPromise
  }

  private async proveRoleReadiness(role: PrinterRole, generation: number): Promise<{ endpointKey: string } | null> {
    if (!this.running || generation !== this.lifecycleGeneration) return null
    const configured = await this.endpoints.configuredForRecovery()
    if (!this.running || generation !== this.lifecycleGeneration) return null
    if (!configured.ok) {
      this.roleReadiness = Object.freeze({ ...this.roleReadiness, [role]: false })
      return null
    }
    const endpoint = configured.endpoints.find((candidate) => candidate.role === role)
    if (!endpoint) {
      this.roleReadiness = Object.freeze({ ...this.roleReadiness, [role]: false })
      return null
    }
    const ready = await this.endpointReadiness.check([endpoint])
    if (!this.running || generation !== this.lifecycleGeneration) return null
    const available = ready.ok && ready.roles[role]
    this.roleReadiness = Object.freeze({ ...this.roleReadiness, [role]: available })
    return available ? { endpointKey: endpoint.endpointKey } : null
  }

  private async pump(): Promise<void> {
    if (!this.running || !this.cloud || this.pumpPromise) return
    this.pumpPromise = (async () => {
      await this.flushReports()
      await this.refreshRoleReadiness(this.lifecycleGeneration)
      for (const role of PRINT_ROLES) {
        if (!this.running || !this.roleReadiness[role]) continue
        const readiness = await this.proveRoleReadiness(role, this.lifecycleGeneration)
        if (!readiness) continue
        const batch = this.controlPlane.current().batch
        if (!batch || !this.controlPlane.validateExecution().ok) return
        const delivered = await this.cloud!.receive(batch, role)
        if (!delivered.ok || !delivered.job) continue
        const job = delivered.job
        const payload = job.payloadKind === 'RAW_BYTES' ? job.payload : await this.networkRenderer.render(job.networkRequest)
        const executionBatch = this.controlPlane.current().batch
        if (!executionBatch || !this.controlPlane.validateExecution().ok) return
        await this.executeAtReadyEndpoint({
          source: job.source,
          role: job.role,
          identity: {
            printJobId: job.printJobId,
            requestHash: createHash('sha256').update(payload).digest('hex'),
            rendererVersion: job.rendererVersion,
            expiresAt: job.expiresAt,
          },
          payload,
        }, executionBatch, readiness.endpointKey)
        await this.flushReports()
      }
    })().finally(() => { this.pumpPromise = null })
    await this.pumpPromise
  }

  private async flushReports(): Promise<void> {
    if (!this.cloud) return
    for (const entry of this.outbox.listReportable()) {
      await this.outbox.recordAttempt(entry.executionId)
      if (await this.cloud.report(entry)) await this.outbox.acknowledge(entry.executionId, entry.factVersion)
    }
  }
}

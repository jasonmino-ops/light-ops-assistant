import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { PrintIntentSource } from './localFirstPrintCoordinator'
import { LocalFirstPrintCoordinator } from './localFirstPrintCoordinator'
import { createExecutionLedger, type ExecutionLedger } from './executionLedger'
import { ExecutionOutbox } from './executionOutbox'
import { EndpointMutex } from './endpointMutex'
import { RawTcpEffectBoundary } from './rawTcpEffectBoundary'
import { WindowsUsbPrintBoundary } from './windowsUsbPrintBoundary'
import { discoverWindowsUsbQueues } from './windowsUsbQueueDiscovery'
import { isWindowsUsbEndpointKey, windowsUsbEndpointKey, type WindowsUsbEndpoint } from './windowsUsbEndpoint'
import { executeUsbFrontTest, readUsbFrontTestRequest, usbFrontTestLedgerPath, type UsbFrontTestRequest } from './windowsUsbFrontTest'
import { SharedPrintingCore, type ExecutionSafetyCheck, type SharedExecutionResult, type SharedPrintIdentity } from './sharedPrintingCore'
import type { V3ControlPlaneRuntime } from './controlPlaneRuntime'
import type { ExecutionBatchProjection } from './controlPlaneClient'
import { proveProcessDead } from './processLiveness'
import { LocalEndpointAuthority, type PrinterRole } from './localEndpointAuthority'
import type { LocalEndpoint } from './localEndpointAuthority'
import { V3PrintJobClient } from './v3PrintJobClient'
import { V3NetworkRenderer } from './v3NetworkRenderer'
import { NoPayloadEndpointReadiness, type RoleReadinessMask } from './endpointReadiness'
import { logger } from '../logger'
import type { PrintSettingsEndpoint, PrintSettingsReply, PrintSettingsRequest } from '../../shared/v3PrintSettings'

const PRINT_ROLES: readonly PrinterRole[] = ['FRONT', 'KITCHEN']
type RunUsbFrontTest = (request: UsbFrontTestRequest, endpointKey: string, validate: ExecutionSafetyCheck) => Promise<SharedExecutionResult>

const NO_ROLES_READY: RoleReadinessMask = Object.freeze({ FRONT: false, KITCHEN: false })

function rejectSettings(code: string): Extract<PrintSettingsReply, { ok: false }> {
  return { ok: false, code }
}

function usbQueueChoice(endpoint: WindowsUsbEndpoint) {
  return { queueName: endpoint.queueName, portName: endpoint.portName,
    key: createHash('sha256').update(windowsUsbEndpointKey(endpoint)).digest('hex') }
}

function settingsEndpoint(endpoint?: LocalEndpoint): PrintSettingsEndpoint | null {
  if (!endpoint) return null
  return 'kind' in endpoint
    ? { kind: 'USB', queueName: endpoint.queueName, portName: endpoint.portName }
    : { kind: 'TCP', ...endpoint }
}

const SAFE_SETTINGS_ERRORS = new Set([
  'ENDPOINT_CONFIG_CORRUPT', 'ENDPOINT_CONFIG_INVALID', 'ENDPOINT_CONFIG_REVISION_STALE',
  'ENDPOINT_CONFIG_UNAVAILABLE', 'ENDPOINT_IDENTITY_MISMATCH', 'ENDPOINT_SECURE_STORAGE_UNAVAILABLE',
  'PRINT_SETTINGS_AUTHORITY_REQUIRED', 'PRINT_SETTINGS_PENDING_REPORTS', 'LOCAL_EFFECT_AMBIGUITY',
])

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
  private usbTestPromise: Promise<PrintSettingsReply> | null = null
  private settingsReady = false
  private settingsPromise: Promise<PrintSettingsReply> | null = null
  private localExecutions = 0
  private queueDiscoveryPromise: Promise<WindowsUsbEndpoint[]> | null = null
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
    private releaseBlocked = false,
    private readonly endpointReadiness = new NoPayloadEndpointReadiness(),
    private readonly roleReadinessIntervalMs = 30_000,
    private readonly usbFrontTest?: RunUsbFrontTest,
    private readonly settingsStoreCode?: string,
    private readonly listUsbQueues = discoverWindowsUsbQueues,
  ) {}

  public static async open(options: {
    userDataPath: string
    controlPlane: V3ControlPlaneRuntime
    storeId: string
    deviceId: string
    storeCode?: string
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
    const testLedgerPath = usbFrontTestLedgerPath(options.userDataPath)
    const releaseBlocked = await hasDurableCrossingUnknown(options.userDataPath) ||
      await hasDurableCrossingUnknown(testLedgerPath) ||
      outbox.list().some(({ outcome }) => outcome === 'CROSSING_UNKNOWN')
    const tcp = new RawTcpEffectBoundary(options.tcpTimeoutMs ?? 10_000)
    const usb = new WindowsUsbPrintBoundary()
    const mutex = new EndpointMutex({ root: options.userDataPath, staleRecovery: recovery })
    const shared = new SharedPrintingCore<Uint8Array>(
      ledger,
      { cross: (input) => isWindowsUsbEndpointKey(input.endpointKey) ? usb.cross(input) : tcp.cross(input) },
      mutex,
    )
    const usbFrontTest: RunUsbFrontTest = async (request, endpointKey, validate) => {
      await fs.mkdir(testLedgerPath, { recursive: true, mode: 0o700 })
      const testLedger = createExecutionLedger({ userDataPath: testLedgerPath, staleLockRecovery: recovery })
      const opened = await testLedger.open()
      try {
        if (!opened.ok) return { status: 'REJECTED', error: opened.error }
        return await executeUsbFrontTest(new SharedPrintingCore(testLedger, usb, mutex), request, endpointKey, validate)
      } finally {
        const closed = await testLedger.close()
        if (!closed.ok) throw new Error(closed.error.code)
      }
    }
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
      options.cloud ?? null, options.cloudPollIntervalMs ?? 2_000, new V3NetworkRenderer(), releaseBlocked,
      new NoPayloadEndpointReadiness(undefined, undefined, (key) => usb.isReady(key)), undefined,
      usbFrontTest, options.storeCode)
    return runtime
  }

  public async start(argv: readonly string[] = process.argv): Promise<void> {
    if (this.started) return
    this.started = true
    this.running = true
    const generation = ++this.lifecycleGeneration
    try {
      await this.controlPlane.markExecutionLifecycleReady({
        releaseBlocked: this.releaseBlocked,
        expiredSelfRecoveryReadiness: () => this.checkExpiredSelfRecoveryReadiness(generation),
      })
      if (!this.running || generation !== this.lifecycleGeneration) return
      let testRequest: UsbFrontTestRequest | null = null
      try {
        testRequest = readUsbFrontTestRequest(argv)
      } catch (error) {
        logger.warn('v3-print-usb.test-rejected', { code: (error as Error).message })
      }
      if (testRequest) {
        this.usbTestPromise = this.runUsbTest(testRequest, generation)
        try { await this.usbTestPromise } finally { this.usbTestPromise = null }
      }
      if (!this.releaseBlocked) await this.refreshRoleReadiness(generation, true)
      if (this.running && generation === this.lifecycleGeneration) {
        this.settingsReady = true
        this.startCloudPump()
      }
    } catch (error) {
      this.running = false
      this.started = false
      throw error
    }
  }

  private async runUsbTest(request: UsbFrontTestRequest, generation: number): Promise<PrintSettingsReply> {
    const reject = (code: string) => {
      logger.warn('v3-print-usb.test-rejected', { requestId: request.printJobId, code })
      return rejectSettings(code)
    }
    if (!this.usbFrontTest) return reject('USB_TEST_UNAVAILABLE')
    if (this.releaseBlocked) return reject('LOCAL_EFFECT_AMBIGUITY')
    const endpoint = await this.endpoints.resolve('FRONT')
    if (!endpoint.ok || !isWindowsUsbEndpointKey(endpoint.endpointKey)) return reject('USB_FRONT_NOT_CONFIGURED')
    if (!this.running || generation !== this.lifecycleGeneration) return reject('RUNTIME_STOPPED')
    const batch = this.controlPlane.current().batch
    if (!batch) return reject('NO_OWNER_SCOPED_BATCH')
    const lifecycle = this.controlPlane.beginExecutionLifecycle(batch)
    if (!lifecycle.ok) return reject(lifecycle.error.code)

    let releaseSafe = false
    try {
      const result = await this.usbFrontTest(request, endpoint.endpointKey, () => {
        if (!this.running || generation !== this.lifecycleGeneration) {
          return { ok: false, error: { code: 'RUNTIME_STOPPED', message: 'Printing runtime stopped.' } }
        }
        return this.controlPlane.validateAdmittedExecution({
          batchId: batch.id, storeId: batch.storeId, deviceId: batch.ownerDeviceId,
          ownerEpoch: batch.ownerEpoch, leaseId: batch.leaseId, batchExpiresAt: batch.expiresAt,
        })
      })
      releaseSafe = releaseSafeExecutionResult(result)
      logger.info('v3-print-usb.test-result', {
        requestId: request.printJobId,
        status: result.status,
        code: result.status === 'REJECTED' ? result.error.code : undefined,
        reason: 'reason' in result ? result.reason : undefined,
      })
      if (!releaseSafe) return rejectSettings('LOCAL_EFFECT_AMBIGUITY')
      return result.status === 'CROSSED' ? { ok: true, code: 'USB_TEST_SPOOLED' } : rejectSettings(`USB_TEST_${result.status}`)
    } catch {
      return reject('USB_TEST_EXECUTION_UNVERIFIABLE')
    } finally {
      if (!releaseSafe) this.releaseBlocked = true
      await lifecycle.guard.complete({ releaseSafe })
    }
  }

  public async printSettings(request: PrintSettingsRequest): Promise<PrintSettingsReply> {
    if (!this.settingsReady || process.platform !== 'win32') return rejectSettings('PRINT_SETTINGS_UNAVAILABLE')
    if (!this.settingsStoreCode || request.storeCode !== this.settingsStoreCode) return rejectSettings('PRINT_SETTINGS_STORE_MISMATCH')
    const mode = this.controlPlane.current().controlPlane?.mode
    if (request.action === 'read') {
      if (mode !== 'V3_ACTIVE') return { ok: true, state: {
        mode: mode === 'V2_ACTIVE' ? 'LEGACY' : 'BLOCKED', revision: 0, front: null, kitchen: null,
        usbSupported: false, blockedCode: mode === 'V2_ACTIVE' ? null : 'PRINT_SETTINGS_AUTHORITY_REQUIRED',
      } }
      const config = await this.endpoints.readSettings()
      if (!config.ok) return config
      const kitchen = settingsEndpoint(config.endpoints.KITCHEN)
      return { ok: true, state: { mode: 'V3', revision: config.revision,
        front: settingsEndpoint(config.endpoints.FRONT), kitchen: kitchen?.kind === 'TCP' ? kitchen : null,
        usbSupported: !!this.usbFrontTest, blockedCode: this.settingsBlockedCode(),
      } }
    }
    if (mode !== 'V3_ACTIVE') return rejectSettings('PRINT_SETTINGS_AUTHORITY_REQUIRED')
    if (request.action === 'queues') {
      if (this.settingsPromise) return rejectSettings('PRINT_SETTINGS_BUSY')
      this.queueDiscoveryPromise ??= this.listUsbQueues().finally(() => { this.queueDiscoveryPromise = null })
      try { return { ok: true, queues: (await this.queueDiscoveryPromise).map(usbQueueChoice) } }
      catch { return rejectSettings('USB_QUEUE_DISCOVERY_FAILED') }
    }
    if (this.settingsPromise || this.usbTestPromise || this.queueDiscoveryPromise || this.localExecutions || this.pumpPromise) {
      return rejectSettings('PRINT_SETTINGS_BUSY')
    }
    const blocked = this.settingsBlockedCode()
    if (blocked) return rejectSettings(blocked)
    const generation = this.lifecycleGeneration
    this.settingsPromise = this.changePrintSettings(request, generation)
    try { return await this.settingsPromise } finally { this.settingsPromise = null }
  }

  private settingsBlockedCode(): string | null {
    if (this.releaseBlocked) return 'LOCAL_EFFECT_AMBIGUITY'
    const pending = this.outbox.list()
    if (pending.some(({ outcome }) => outcome === 'CROSSING_UNKNOWN')) return 'LOCAL_EFFECT_AMBIGUITY'
    if (!this.controlPlane.validateExecution().ok) return 'PRINT_SETTINGS_AUTHORITY_REQUIRED'
    return pending.length ? 'PRINT_SETTINGS_PENDING_REPORTS' : null
  }

  private async changePrintSettings(
    request: Extract<PrintSettingsRequest, { action: 'save' | 'test' }>, generation: number,
  ): Promise<PrintSettingsReply> {
    const validate = () => {
      if (!this.running || generation !== this.lifecycleGeneration) throw new Error('PRINT_SETTINGS_AUTHORITY_REQUIRED')
      const blocked = this.settingsBlockedCode()
      if (blocked) throw new Error(blocked)
    }
    try {
      const config = await this.endpoints.readSettings()
      if (!config.ok) return config
      if (config.revision !== request.revision) return rejectSettings('ENDPOINT_CONFIG_REVISION_STALE')
      if (request.action === 'test') {
        validate()
        const test = readUsbFrontTestRequest([`--v3-usb-front-test=${Date.now()}:${randomUUID()}`])
        return await this.runUsbTest(test!, generation)
      }
      let endpoint: LocalEndpoint
      if (request.target.kind === 'USB') {
        const target = request.target
        const queues = await this.listUsbQueues().catch(() => null)
        if (!queues) return rejectSettings('USB_QUEUE_DISCOVERY_FAILED')
        const selected = queues.find((queue) => queue.queueName === target.queueName && queue.portName === target.portName &&
          usbQueueChoice(queue).key === target.key)
        if (!selected) return rejectSettings('USB_QUEUE_NOT_READY')
        endpoint = selected
      } else {
        endpoint = { host: request.target.host, port: request.target.port }
      }
      validate()
      await this.endpoints.provision({
        revision: config.revision + 1, endpoints: { ...config.endpoints, [request.role]: endpoint },
      }, { expectedRevision: config.revision, beforeCommit: validate })
      this.roleReadiness = NO_ROLES_READY
      this.roleReadinessRefreshAt = 0
      return { ok: true, code: 'SETTINGS_SAVED' }
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      return rejectSettings(SAFE_SETTINGS_ERRORS.has(code) ? code : 'PRINT_SETTINGS_CHANGE_FAILED')
    }
  }

  public async execute(input: { source: PrintIntentSource; orderNo?: string; identity: SharedPrintIdentity; role: PrinterRole; payload: Uint8Array }) {
    if (this.settingsPromise && input.source === 'LOCAL_DESKTOP' &&
        this.controlPlane.current().controlPlane?.mode !== 'V2_ACTIVE') return this.holdLocal(input)
    this.localExecutions++
    try { return await this.executeWithCurrentEndpoints(input) } finally { this.localExecutions-- }
  }

  private async executeWithCurrentEndpoints(input: Parameters<V3PrintingRuntime['execute']>[0]) {
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
      if (input.source === 'LOCAL_DESKTOP' && lifecycle.error.durablyHoldLocal) return this.holdLocal(input, lifecycle.error.code)
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

  private async holdLocal(input: { source: PrintIntentSource; orderNo?: string; identity: SharedPrintIdentity; role: PrinterRole; payload: Uint8Array }, reason = 'ADMISSION_CLOSED') {
    if (input.source === 'LOCAL_DESKTOP') {
      // This is a durable admission, not an execution retry. The original
      // print identity remains the only identity the cloud may later deliver.
      logger.info('v3-print-local-held', { role: input.role, reason })
    }
    if (!this.cloud || !input.orderNo) return { status: 'REJECTED' as const, reason: 'V3_DURABLE_ADMISSION_UNAVAILABLE' }
    const status = await this.cloud.holdLocal({ orderNo: input.orderNo, printJobId: input.identity.printJobId, role: input.role,
      rendererVersion: input.identity.rendererVersion, expiresAt: input.identity.expiresAt, payload: input.payload })
    return status
      ? { status: 'HELD' as const, admission: 'DURABLY_ACCEPTED' as const, durability: status }
      : { status: 'REJECTED' as const, reason: 'V3_DURABLE_ADMISSION_REJECTED' }
  }

  public async readOperatorRecoveryProof(input: {
    orderNo: string
    originalJobId: string
    role: PrinterRole
  }): Promise<{ state: 'DEFINITELY_NOT_PRINTED'; recoveryProof: string } | { state: 'AMBIGUOUS' }> {
    if (!this.running || !this.cloud || this.pumpPromise) return { state: 'AMBIGUOUS' }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.orderNo)) return { state: 'AMBIGUOUS' }
    const canonicalKey = `cashier-network-v2:${input.orderNo}:${input.role}`
    const expectedJobId = `network:${createHash('sha256').update(canonicalKey).digest('hex')}`
    if (input.originalJobId !== expectedJobId) return { state: 'AMBIGUOUS' }

    // Ledger absence is checked while no cloud pump is active. Once a V3 job is
    // durably reserved the server will not redeliver it, so an absent ledger here
    // proves that this runtime never admitted the transport effect.
    const local = await this.ledger.get(input.originalJobId)
    if (!local.ok || local.value.found || this.pumpPromise) return { state: 'AMBIGUOUS' }
    const recoveryProof = await this.cloud.readOperatorRecoveryProof(input)
    return recoveryProof
      ? { state: 'DEFINITELY_NOT_PRINTED', recoveryProof }
      : { state: 'AMBIGUOUS' }
  }

  public provisionEndpoints(input: { revision: number; endpoints: Partial<Record<PrinterRole, LocalEndpoint>> }): Promise<void> {
    return this.endpoints.provision(input)
  }

  public async close(): Promise<void> {
    this.settingsReady = false
    this.running = false
    this.started = false
    this.lifecycleGeneration += 1
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.usbTestPromise
    await this.settingsPromise
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
    if (!this.running || !this.cloud || this.pumpPromise || this.settingsPromise) return
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

import type { PrinterRole, LocalEndpoint } from './localEndpointAuthority'
import { LanPrinterDiscovery, type PrinterCandidate } from './printerDiscovery'
import { RawTcpEffectBoundary } from './rawTcpEffectBoundary'
import type { EffectBoundaryResult } from './sharedPrintingCore'
import type { V3PrintingRuntime } from './v3PrintingRuntime'

export type PrinterSetupSnapshot = Readonly<{
  state: 'NEEDS_SETUP' | 'DISCOVERING' | 'CONFIGURING' | 'READY' | 'ERROR'
  version: string
  candidates: readonly PrinterCandidate[]
  assignments: Readonly<Record<PrinterRole, string | null>>
  tested: Readonly<Record<PrinterRole, boolean>>
  configured: Readonly<Partial<Record<PrinterRole, LocalEndpoint>>>
  readiness: Readonly<Record<PrinterRole, boolean>>
  errorCode: string | null
  busy: boolean
}>

type TestBoundary = {
  cross(input: {
    endpointKey: string
    payload: Uint8Array
    validateExecution: () => Promise<
      { ok: true; value: void } | { ok: false; error: { code: string; message: string } }
    >
  }): Promise<EffectBoundaryResult>
}

const ROLES: readonly PrinterRole[] = ['FRONT', 'KITCHEN']

function safeCode(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  const match = /[A-Z][A-Z0-9_]{2,}/.exec(value)
  return match?.[0] ?? 'PRINTER_SETUP_FAILED'
}

export function buildPrinterTestTicket(role: PrinterRole, version: string, now = new Date()): Uint8Array {
  const text = [
    'E-Shop Desktop',
    `${role} TEST PRINT`,
    `Version ${version}`,
    now.toISOString(),
    'Printer setup test completed.',
    '', '', '',
  ].join('\n')
  return Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(text, 'ascii'),
    Buffer.from([0x1d, 0x56, 0x00]),
  ])
}

export class PrinterSetupService {
  private candidates: PrinterCandidate[] = []
  private assignments: Record<PrinterRole, string | null> = { FRONT: null, KITCHEN: null }
  private tested: Record<PrinterRole, boolean> = { FRONT: false, KITCHEN: false }
  private configured: Partial<Record<PrinterRole, LocalEndpoint>> = {}
  private readiness: Record<PrinterRole, boolean> = { FRONT: false, KITCHEN: false }
  private state: PrinterSetupSnapshot['state'] = 'NEEDS_SETUP'
  private errorCode: string | null = null
  private busy = false

  constructor(
    private readonly runtime: V3PrintingRuntime,
    private readonly version: string,
    private readonly discovery = new LanPrinterDiscovery(),
    private readonly testBoundary: TestBoundary = new RawTcpEffectBoundary(10_000),
  ) {}

  async initialize(): Promise<PrinterSetupSnapshot> {
    const loaded = await this.runtime.endpointConfiguration()
    this.configured = loaded.ok ? { ...loaded.value.endpoints } : {}
    this.readiness = { ...(await this.runtime.refreshEndpointReadiness()) }
    const complete = ROLES.every((role) => Boolean(this.configured[role]))
    this.state = complete && ROLES.every((role) => this.readiness[role]) ? 'READY' : 'NEEDS_SETUP'
    this.errorCode = complete && this.state !== 'READY' ? 'PRINTER_ENDPOINT_NOT_READY' : null
    return this.snapshot()
  }

  snapshot(): PrinterSetupSnapshot {
    return Object.freeze({
      state: this.state,
      version: this.version,
      candidates: Object.freeze(this.candidates.map((candidate) => ({ ...candidate }))),
      assignments: Object.freeze({ ...this.assignments }),
      tested: Object.freeze({ ...this.tested }),
      configured: Object.freeze(Object.fromEntries(Object.entries(this.configured).map(([role, value]) => [role, { ...value }]))),
      readiness: Object.freeze({ ...this.readiness }),
      errorCode: this.errorCode,
      busy: this.busy,
    })
  }

  async discover(): Promise<PrinterSetupSnapshot> {
    return this.exclusive(async () => {
      this.state = 'DISCOVERING'
      this.errorCode = null
      const result = await this.discovery.discover()
      this.candidates = [...result.candidates]
      this.assignments = { FRONT: null, KITCHEN: null }
      this.tested = { FRONT: false, KITCHEN: false }
      this.state = 'CONFIGURING'
      if (result.status !== 'COMPLETE') this.errorCode = result.reason ?? 'PRINTER_DISCOVERY_MANUAL_REQUIRED'
      else if (result.candidates.length === 0) this.errorCode = 'PRINTER_DISCOVERY_NO_CANDIDATES'
      return this.snapshot()
    })
  }

  assign(role: PrinterRole, candidateId: string): PrinterSetupSnapshot {
    if (this.busy) throw new Error('PRINTER_SETUP_BUSY')
    if (!ROLES.includes(role)) throw new Error('PRINTER_ROLE_INVALID')
    if (!this.candidates.some((candidate) => candidate.id === candidateId)) throw new Error('PRINTER_CANDIDATE_INVALID')
    this.assignments[role] = candidateId
    this.tested[role] = false
    this.errorCode = null
    this.state = 'CONFIGURING'
    return this.snapshot()
  }

  async test(role: PrinterRole): Promise<PrinterSetupSnapshot> {
    return this.exclusive(async () => {
      const candidate = this.selected(role)
      this.tested[role] = false
      if (!(await this.discovery.validate(candidate))) throw new Error('PRINTER_IDENTITY_REVALIDATION_FAILED')
      const result = await this.testBoundary.cross({
        endpointKey: `${candidate.ip}:${candidate.port}`,
        payload: buildPrinterTestTicket(role, this.version),
        validateExecution: async () => (await this.discovery.validate(candidate))
          ? { ok: true as const, value: undefined }
          : { ok: false as const, error: { code: 'PRINTER_IDENTITY_CHANGED', message: 'Printer identity changed before test write.' } },
      })
      if (result.outcome !== 'CROSSED') {
        throw new Error(result.outcome === 'UNKNOWN' ? 'PRINTER_TEST_CROSSING_UNKNOWN' : result.errorCode ?? 'PRINTER_TEST_NOT_CROSSED')
      }
      this.tested[role] = true
      this.state = 'CONFIGURING'
      this.errorCode = null
      return this.snapshot()
    })
  }

  async save(): Promise<PrinterSetupSnapshot> {
    return this.exclusive(async () => {
      if (!ROLES.every((role) => this.assignments[role] && this.tested[role])) throw new Error('PRINTER_TEST_REQUIRED')
      const selected = Object.fromEntries(ROLES.map((role) => [role, this.selected(role)])) as Record<PrinterRole, PrinterCandidate>
      for (const candidate of new Map(Object.values(selected).map((value) => [value.id, value])).values()) {
        if (!(await this.discovery.validate(candidate))) throw new Error('PRINTER_IDENTITY_REVALIDATION_FAILED')
      }
      const previous = await this.runtime.endpointConfiguration()
      const endpoints: Record<PrinterRole, LocalEndpoint> = {
        FRONT: {
          host: selected.FRONT.ip,
          port: selected.FRONT.port,
          hardwareAddress: selected.FRONT.hardwareAddress,
        },
        KITCHEN: {
          host: selected.KITCHEN.ip,
          port: selected.KITCHEN.port,
          hardwareAddress: selected.KITCHEN.hardwareAddress,
        },
      }
      await this.runtime.provisionEndpoints({ revision: previous.ok ? previous.value.revision + 1 : 1, endpoints })
      this.configured = endpoints
      this.readiness = { ...(await this.runtime.refreshEndpointReadiness()) }
      if (!ROLES.every((role) => this.readiness[role])) throw new Error('PRINTER_ENDPOINT_NOT_READY')
      this.state = 'READY'
      this.errorCode = null
      return this.snapshot()
    })
  }

  private selected(role: PrinterRole): PrinterCandidate {
    if (!ROLES.includes(role)) throw new Error('PRINTER_ROLE_INVALID')
    const id = this.assignments[role]
    const candidate = id ? this.candidates.find((value) => value.id === id) : null
    if (!candidate) throw new Error(`PRINTER_${role}_NOT_ASSIGNED`)
    return candidate
  }

  private async exclusive(action: () => Promise<PrinterSetupSnapshot>): Promise<PrinterSetupSnapshot> {
    if (this.busy) throw new Error('PRINTER_SETUP_BUSY')
    this.busy = true
    try {
      await action()
    } catch (error) {
      this.state = 'ERROR'
      this.errorCode = safeCode(error)
    } finally {
      this.busy = false
    }
    return this.snapshot()
  }
}

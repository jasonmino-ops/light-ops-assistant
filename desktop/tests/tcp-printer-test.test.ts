import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createExecutionLedger } from '../src/main/printing/executionLedger'
import { EndpointMutex } from '../src/main/printing/endpointMutex'
import { proveTcpDiagnosticTarget, type TcpDiagnosticTarget } from '../src/main/printing/tcpDiagnosticTarget'
import { createTcpDiagnosticBoundary, executeTcpPrinterTest, makeTcpTestIdentity } from '../src/main/printing/tcpPrinterTest'
import { SharedPrintingCore } from '../src/main/printing/sharedPrintingCore'
import { hasDurableCrossingUnknown, V3PrintingRuntime } from '../src/main/printing/v3PrintingRuntime'
import { usbFrontTestLedgerPath } from '../src/main/printing/windowsUsbFrontTest'

vi.mock('electron', () => ({ safeStorage: {} }))

const endpoint = { host: '192.168.1.22', port: 9100 }
const target: TcpDiagnosticTarget = {
  ...endpoint, localAddress: '192.168.1.10',
  network: '4|{34684b0d-36cb-44c5-9d59-f5bca6d18ede}|192.168.1.0/24', mac: '02-aa-12-34-56-78',
}

type WireMode = 'success' | 'connect-error' | 'write-error' | 'bad-fin'
function wire(mode: WireMode = 'success') {
  const socket = Object.assign(new EventEmitter(), {
    localAddress: target.localAddress, remoteAddress: target.host, remotePort: target.port,
    setTimeout: vi.fn(),
    destroy: vi.fn(),
    write: vi.fn((_payload: Uint8Array, done: (error?: Error) => void) => {
      done(mode === 'write-error' ? new Error('simulated reset') : undefined)
    }),
    end: vi.fn(() => socket.emit('close', mode === 'bad-fin')),
  })
  type Dial = NonNullable<Parameters<typeof createTcpDiagnosticBoundary>[3]>
  const dial = vi.fn((_options: Parameters<Dial>[0]): ReturnType<Dial> => {
    queueMicrotask(() => {
      if (mode === 'connect-error') socket.emit('error', new Error('simulated refusal'))
      else socket.emit('connect')
    })
    return socket as unknown as ReturnType<Dial>
  })
  return { socket, dial }
}

const permit = () => ({ ok: true as const, value: undefined })
const fenced = () => ({ ok: false as const, error: { code: 'FENCED', message: 'Fence expired.' } })

async function withLedger(run: (root: string, directory: string, ledger: ReturnType<typeof createExecutionLedger>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'eshop-tcp-diagnostic-'))
  const directory = usbFrontTestLedgerPath(root)
  await mkdir(directory, { recursive: true })
  const ledger = createExecutionLedger({ userDataPath: directory })
  try {
    expect((await ledger.open()).ok).toBe(true)
    await run(root, directory, ledger)
  } finally {
    await ledger.close()
    await rm(root, { recursive: true, force: true })
  }
}

describe('Windows direct-LAN proof', () => {
  it('uses a fixed numeric-target probe and fails closed for bad metadata or unsupported input', async () => {
    const run = vi.fn(async (_command: string, _timeout: number) => JSON.stringify({
      localAddress: target.localAddress, network: target.network, mac: target.mac.toUpperCase(),
    }))
    expect(await proveTcpDiagnosticTarget(endpoint, 3250, 'win32', run)).toEqual(target)
    const [script, timeout] = run.mock.calls[0]!
    expect(timeout).toBe(3250)
    expect(script).toContain("$target = '192.168.1.22'")
    for (const fragment of ['Find-NetRoute', 'Get-NetAdapter -Physical', 'Get-NetRoute -AddressFamily IPv4', '::SendARP', '$after = DirectPath']) {
      expect(script).toContain(fragment)
    }
    expect(script).not.toContain('9100')
    expect(await proveTcpDiagnosticTarget({ ...endpoint, host: "192.168.1.22'; exit" }, 3250, 'win32', run)).toBeNull()
    expect(await proveTcpDiagnosticTarget({ ...endpoint, host: '8.8.8.8' }, 3250, 'win32', run)).toBeNull()
    expect(await proveTcpDiagnosticTarget(endpoint, 3250, 'linux', run)).toBeNull()
    expect(run).toHaveBeenCalledTimes(1)
    run.mockRejectedValueOnce(new Error('AMBIGUOUS_ROUTE')).mockResolvedValueOnce(JSON.stringify({ ...target, mac: 'ff-ff-ff-ff-ff-ff' }))
    expect(await proveTcpDiagnosticTarget(endpoint, 3250, 'win32', run)).toBeNull()
    expect(await proveTcpDiagnosticTarget(endpoint, 3250, 'win32', run)).toBeNull()
  })
})

describe('V3 TCP diagnostic crossing', () => {
  it.each(['FRONT', 'KITCHEN'] as const)('writes a fixed %s receipt once after durable crossing and final validation', async (role) => {
    await withLedger(async (root, directory, ledger) => {
      const { dial, socket } = wire()
      const request = makeTcpTestIdentity(role)
      const prove = vi.fn(async () => {
        expect(await hasDurableCrossingUnknown(directory)).toBe(true)
        expect(socket.write).not.toHaveBeenCalled()
        return target
      })
      const validate = vi.fn(permit)
      const core = new SharedPrintingCore(ledger, createTcpDiagnosticBoundary(target, prove, 1000, dial), new EndpointMutex({ root }))
      expect(await executeTcpPrinterTest(core, role, target, 4, request, validate))
        .toMatchObject({ status: 'CROSSED', record: { physicalCompletionKnown: false } })
      expect(dial).toHaveBeenCalledWith({ ...endpoint, family: 4, localAddress: target.localAddress })
      expect(prove).toHaveBeenCalledOnce()
      expect(validate).toHaveBeenCalledTimes(3)
      expect(socket.write.mock.calls[0]![0]).toEqual(Buffer.from(`\x1b@E-Shop TCP ${role} TEST - NO SALE\n${request.printJobId}\n\n\n`, 'ascii'))
      expect(await executeTcpPrinterTest(core, role, target, 4, request, validate)).toMatchObject({ status: 'NOT_EXECUTED' })
      expect(await executeTcpPrinterTest(core, role, target, 5, request, validate)).toMatchObject({ status: 'REJECTED' })
      expect(socket.write).toHaveBeenCalledOnce()
      expect(await hasDurableCrossingUnknown(directory)).toBe(false)
    })
  })

  it.each(['route', 'neighbor', 'peer', 'fence', 'connect'] as const)('proves zero bytes on %s failure', async (failure) => {
    await withLedger(async (root, directory, ledger) => {
      const { dial, socket } = wire(failure === 'connect' ? 'connect-error' : 'success')
      if (failure === 'peer') socket.remotePort++
      const prove = vi.fn(async () => failure === 'neighbor' ? { ...target, mac: '02-00-00-00-00-01' } :
        failure === 'route' ? { ...target, network: 'different route' } : target)
      let checks = 0
      const validate = () => ++checks === 3 && failure === 'fence' ? fenced() : permit()
      const core = new SharedPrintingCore(ledger, createTcpDiagnosticBoundary(target, prove, 1000, dial), new EndpointMutex({ root }))
      expect(await executeTcpPrinterTest(core, 'FRONT', target, 1, makeTcpTestIdentity('FRONT'), validate))
        .toMatchObject({ status: 'FAILED_NOT_CROSSED' })
      expect(socket.write).not.toHaveBeenCalled()
      expect(await hasDurableCrossingUnknown(directory)).toBe(false)
    })
  })

  it.each(['write-error', 'bad-fin'] as const)('keeps %s UNKNOWN across restart without another send', async (mode) => {
    await withLedger(async (root, directory, ledger) => {
      const { dial, socket } = wire(mode)
      const request = makeTcpTestIdentity('KITCHEN')
      const boundary = createTcpDiagnosticBoundary(target, async () => target, 1000, dial)
      const mutex = new EndpointMutex({ root })
      expect(await executeTcpPrinterTest(new SharedPrintingCore(ledger, boundary, mutex), 'KITCHEN', target, 4, request, permit))
        .toMatchObject({ status: 'CROSSING_UNKNOWN' })
      await ledger.close()
      expect(await hasDurableCrossingUnknown(directory)).toBe(true)
      const reopened = createExecutionLedger({ userDataPath: directory })
      try {
        expect((await reopened.open()).ok).toBe(true)
        expect(await executeTcpPrinterTest(new SharedPrintingCore(reopened, boundary, mutex), 'KITCHEN', target, 4, request, permit))
          .toMatchObject({ status: 'NOT_EXECUTED', record: { state: 'CROSSING_UNKNOWN' } })
      } finally {
        await reopened.close()
      }
      expect(socket.write).toHaveBeenCalledOnce()
      const markExecutionLifecycleReady = vi.fn()
      const runtime = await V3PrintingRuntime.open({
        userDataPath: root, storeId: 'store', deviceId: 'device', storeCode: 'STORE',
        controlPlane: { markExecutionLifecycleReady, current: () => ({ controlPlane: { mode: 'V3_ACTIVE' } }) } as never,
      })
      const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
      try {
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
        await runtime.start([])
        expect(markExecutionLifecycleReady).toHaveBeenCalledWith(expect.objectContaining({ releaseBlocked: true }))
        expect(await runtime.printSettings({ action: 'test', storeCode: 'STORE', revision: 4 }))
          .toEqual({ ok: false, code: 'LOCAL_EFFECT_AMBIGUITY' })
      } finally {
        Object.defineProperty(process, 'platform', platform)
        await runtime.close()
      }
    })
  })

  it('does not send after the socket timeout wins the pending proof', async () => {
    await withLedger(async (root, directory, ledger) => {
      const { dial, socket } = wire()
      let finishProof!: (proof: TcpDiagnosticTarget) => void
      let notifyProof!: () => void
      const waiting = new Promise<void>((resolve) => { notifyProof = resolve })
      const prove = () => new Promise<TcpDiagnosticTarget>((resolve) => { finishProof = resolve; notifyProof() })
      const core = new SharedPrintingCore(ledger, createTcpDiagnosticBoundary(target, prove, 1000, dial), new EndpointMutex({ root }))
      const attempt = executeTcpPrinterTest(core, 'FRONT', target, 4, makeTcpTestIdentity('FRONT'), permit)
      await waiting
      socket.emit('timeout')
      expect(await attempt).toMatchObject({ status: 'CROSSING_UNKNOWN', reason: 'TIMEOUT' })
      finishProof(target)
      await new Promise((resolve) => setImmediate(resolve))
      expect(socket.write).not.toHaveBeenCalled()
      expect(await hasDurableCrossingUnknown(directory)).toBe(true)
    })
  })

  it('does not reach the socket when the durable barrier fails', async () => {
    await withLedger(async (root, _directory, ledger) => {
      const { dial } = wire()
      vi.spyOn(ledger, 'beginCrossing').mockResolvedValueOnce({ ok: false, error: { code: 'LEDGER_IO', message: 'disk' } } as never)
      const core = new SharedPrintingCore(ledger, createTcpDiagnosticBoundary(target, async () => target, 1000, dial), new EndpointMutex({ root }))
      expect(await executeTcpPrinterTest(core, 'FRONT', target, 4, makeTcpTestIdentity('FRONT'), permit))
        .toMatchObject({ status: 'REJECTED', error: { code: 'LEDGER_IO' } })
      expect(dial).not.toHaveBeenCalled()
    })
  })
})

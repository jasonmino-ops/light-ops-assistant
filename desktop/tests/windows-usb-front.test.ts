import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoPayloadEndpointReadiness } from '../src/main/printing/endpointReadiness'
import { createExecutionLedger } from '../src/main/printing/executionLedger'
import { ExecutionOutbox } from '../src/main/printing/executionOutbox'
import { LocalEndpointAuthority } from '../src/main/printing/localEndpointAuthority'
import { LocalFirstPrintCoordinator } from '../src/main/printing/localFirstPrintCoordinator'
import { SharedPrintingCore, type PrintingEffectBoundary } from '../src/main/printing/sharedPrintingCore'
import { parseWindowsUsbEndpoint, windowsUsbEndpointKey, type WindowsUsbEndpoint } from '../src/main/printing/windowsUsbEndpoint'
import { WindowsUsbPrintBoundary } from '../src/main/printing/windowsUsbPrintBoundary'
import { readUsbFrontTestRequest, usbFrontTestLedgerPath } from '../src/main/printing/windowsUsbFrontTest'
import { V3PrintingRuntime } from '../src/main/printing/v3PrintingRuntime'
import type { V3ControlPlaneRuntime } from '../src/main/printing/controlPlaneRuntime'
import { RawTcpEffectBoundary } from '../src/main/printing/rawTcpEffectBoundary'
import type { V3PrintJobClient } from '../src/main/printing/v3PrintJobClient'

vi.mock('node:child_process', { spy: true })

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}))

const identity = { storeId: 'cmvulpn8r000106jvpo58kye4', deviceId: 'cmvyx1jes000208l14t5vf9ur' }
const usb: WindowsUsbEndpoint = {
  kind: 'windows-usb', queueName: 'E-Shop Diamond FRONT USB',
  portName: 'USB002', deviceInstanceId: 'USB\\VID_0FE6&PID_811E\\SYNTHETIC-DEVICE',
}
const key = windowsUsbEndpointKey(usb)
const otherIdentity = { storeId: 'store-other', deviceId: 'desktop-other' }
const otherUsb: WindowsUsbEndpoint = {
  kind: 'windows-usb', queueName: '收银台 USB (58 mm)', portName: 'USB004',
  deviceInstanceId: 'USB\\VID_0525&PID_A4A8&MI_00\\NP330',
}
const otherKey = windowsUsbEndpointKey(otherUsb)
const tcp = { host: '192.168.0.59', port: 9100 }
const job = { printJobId: 'front-job', requestHash: 'synthetic-hash', rendererVersion: 'test', expiresAt: '2099-01-01T00:00:00.000Z' }
const roots: string[] = []

async function tempRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eshop-diamond-usb-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const storage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
}

function worker(result: number | null = 23) {
  return { ready: vi.fn(async () => true), submit: vi.fn(async () => result), close: vi.fn() }
}

function boundaryInput(): Parameters<PrintingEffectBoundary<Uint8Array>['cross']>[0] {
  return {
    identity: job, endpointKey: key, payload: Uint8Array.of(1),
    executionPermit: { printJobId: job.printJobId, executionId: 'synthetic-execution', stateVersion: 2 },
    validateExecution: async () => ({ ok: true, value: undefined }),
  }
}

async function runtime(boundary: WindowsUsbPrintBoundary, isOwner = () => true) {
  const root = await tempRoot()
  const ledger = createExecutionLedger({ userDataPath: root, platform: 'win32' })
  expect(await ledger.open()).toMatchObject({ ok: true })
  const outbox = new ExecutionOutbox(root)
  await outbox.open()
  const core = new SharedPrintingCore(ledger, boundary, {
    runExclusive: async (_endpoint, operation) => operation(),
  })
  const coordinator = new LocalFirstPrintCoordinator({
    canAdmit: () => isOwner() ? { allowed: true, mode: 'CONNECTED' } : {
      allowed: false, mode: 'FENCED', reason: 'STALE_OWNER',
    },
  }, core, outbox, { current: () => 'V3_ACTIVE' })
  const execute = () => coordinator.execute({
    mode: 'V3_ACTIVE', source: 'CLOUD_H5', role: 'FRONT', identity: job,
    endpointKey: key, payload: Uint8Array.of(1), authority: {
      batchId: 'batch', storeId: identity.storeId, deviceId: identity.deviceId, ownerEpoch: 2,
      leaseId: 'lease', batchExpiresAt: job.expiresAt,
    },
  })
  return { execute, ledger, outbox, root }
}

describe('Windows USB FRONT', () => {
  it.each([
    { replyAtMs: 3154, ready: true, endpoint: usb },
    { replyAtMs: 5001, ready: false, endpoint: usb },
    { replyAtMs: 3100, ready: true, endpoint: otherUsb },
  ])('admits only READY within the USB probe budget ($replyAtMs ms)', async ({ replyAtMs, ready, endpoint }) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      kill: vi.fn(),
    })
    const messages: string[] = []
    child.stdin.on('data', (data) => messages.push(data.toString()))
    vi.useFakeTimers()
    vi.stubGlobal('process', Object.create(process, { platform: { value: 'win32' } }))
    vi.stubEnv('SystemRoot', 'C:\\Windows')
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>)
    try {
      const probe = new WindowsUsbPrintBoundary().isReady(windowsUsbEndpointKey(endpoint))
      setTimeout(() => child.stdout.write('READY\n'), replyAtMs)
      await vi.advanceTimersByTimeAsync(replyAtMs)
      expect(await probe).toBe(ready)
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatch(/^[\x00-\x7f]+$/)
      expect(JSON.parse(messages[0]!)).toEqual({ endpoint, mode: 'probe' })
      expect(child.kill).toHaveBeenCalledTimes(1)
    } finally {
      child.stdout.destroy()
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it('preserves the existing Diamond endpoint key, device binding and TCP settings', async () => {
    const root = await tempRoot()
    const authority = new LocalEndpointAuthority(root, identity, storage)
    await authority.provision({ revision: 1, endpoints: { FRONT: tcp, KITCHEN: tcp } })
    await authority.provision({ revision: 2, endpoints: { FRONT: usb, KITCHEN: tcp } })
    expect(await authority.configuredForRecovery()).toEqual({
      ok: true, endpoints: [{ role: 'FRONT', endpointKey: key }, { role: 'KITCHEN', endpointKey: '192.168.0.59:9100' }],
    })
    await expect(authority.provision({ revision: 3, endpoints: { KITCHEN: usb } })).rejects.toThrow('ENDPOINT_CONFIG_INVALID')
    for (const foreign of [{ ...identity, deviceId: 'other-device' }, { ...identity, storeId: 'other-store' }]) {
      expect(await new LocalEndpointAuthority(root, foreign, storage).resolve('FRONT'))
        .toEqual({ ok: false, code: 'ENDPOINT_IDENTITY_MISMATCH' })
    }
    await authority.provision({ revision: 3, endpoints: { FRONT: tcp, KITCHEN: tcp } })
    expect(await authority.resolve('FRONT')).toEqual({ ok: true, endpointKey: '192.168.0.59:9100' })
  })

  it('provisions another merchant with opt-in USB FRONT and unchanged TCP KITCHEN', async () => {
    const root = await tempRoot()
    const authority = new LocalEndpointAuthority(root, otherIdentity, storage)
    await authority.provision({ revision: 1, endpoints: { FRONT: tcp, KITCHEN: tcp } })
    expect(await authority.resolve('FRONT')).toEqual({ ok: true, endpointKey: '192.168.0.59:9100' })
    await authority.provision({ revision: 2, endpoints: { FRONT: otherUsb, KITCHEN: tcp } })
    const reopened = new LocalEndpointAuthority(root, otherIdentity, storage)
    expect(await reopened.configuredForRecovery()).toEqual({
      ok: true, endpoints: [{ role: 'FRONT', endpointKey: otherKey }, { role: 'KITCHEN', endpointKey: '192.168.0.59:9100' }],
    })
    await expect(reopened.provision({ revision: 2, endpoints: { FRONT: tcp } })).rejects.toThrow('ENDPOINT_CONFIG_REVISION_STALE')
    await expect(reopened.provision({ revision: 3, endpoints: { KITCHEN: otherUsb } })).rejects.toThrow('ENDPOINT_CONFIG_INVALID')
  })

  it.each([
    { queueName: '\\remote\\receipt' }, { queueName: 'USB*' }, { queueName: 'Receipt, XcvPort' },
    { queueName: 'Receipt[1]' }, { queueName: 'Receipt ' }, { queueName: 'Receipt\n' },
    { portName: 'USB001,USB002' }, { portName: 'WSD001' }, { portName: 'USB004\n' },
    { deviceInstanceId: 'USB\\VID_0525&PID_XXXX\\NP330' },
  ])('rejects unsafe endpoint syntax %j', (change) => {
    expect(parseWindowsUsbEndpoint({ ...otherUsb, ...change })).toBeNull()
  })

  it('does not mark USB ready for a disconnected queue or invoke USB for KITCHEN', async () => {
    const device = worker()
    device.ready.mockResolvedValue(false)
    const open = vi.fn(() => device)
    const usbBoundary = new WindowsUsbPrintBoundary(open)
    const readiness = new NoPayloadEndpointReadiness(undefined, vi.fn(), (endpoint) => usbBoundary.isReady(endpoint))
    expect(await readiness.check([{ role: 'FRONT', endpointKey: key }])).toEqual({
      ok: true, roles: { FRONT: false, KITCHEN: false },
    })
    expect(await readiness.check([{ role: 'KITCHEN', endpointKey: key }])).toEqual({
      ok: true, roles: { FRONT: false, KITCHEN: false },
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(device.submit).not.toHaveBeenCalled()
  })

  it('does not submit after an unplug between the receive probe and the effect', async () => {
    const device = worker()
    device.ready.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const usbBoundary = new WindowsUsbPrintBoundary(() => device)
    expect(await usbBoundary.isReady(key)).toBe(true)
    const instance = await runtime(usbBoundary)
    expect(await instance.execute()).toMatchObject({ status: 'FAILED_NOT_CROSSED' })
    expect(instance.outbox.listReportable()).toMatchObject([{ outcome: 'FAILED_NOT_CROSSED' }])
    expect(device.submit).not.toHaveBeenCalled()
    await instance.ledger.close()
  })

  it('checks the current owner after the worker is ready and before submitting', async () => {
    let current = true
    const device = worker()
    device.ready.mockImplementation(async () => {
      current = false
      return true
    })
    const instance = await runtime(new WindowsUsbPrintBoundary(() => device), () => current)
    expect(await instance.execute()).toMatchObject({ status: 'FAILED_NOT_CROSSED' })
    expect(device.submit).not.toHaveBeenCalled()
    expect(device.close).toHaveBeenCalledTimes(1)
    await instance.ledger.close()
  })

  it('passes a spooler result to the ledger only after the durable barrier and never submits a duplicate', async () => {
    const device = worker()
    const instance = await runtime(new WindowsUsbPrintBoundary(() => device))
    device.submit.mockImplementation(async () => {
      expect(await instance.ledger.get(job.printJobId)).toMatchObject({ value: { record: { state: 'CROSSING_UNKNOWN' } } })
      expect(instance.outbox.list()).toMatchObject([{ outcome: 'CROSSING_UNKNOWN', reportable: false }])
      return 23
    })
    const result = await Promise.all([instance.execute(), instance.execute()])
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'CROSSED', record: expect.objectContaining({ physicalCompletionKnown: false }) }),
      expect.objectContaining({ status: 'NOT_EXECUTED' }),
    ]))
    expect(device.submit).toHaveBeenCalledTimes(1)
    expect(instance.outbox.listReportable()).toMatchObject([{ outcome: 'CROSSED', ownerEpoch: 2, role: 'FRONT' }])
    await instance.ledger.close()
  })

  it.each(['lost reply', 'worker error'])('keeps %s after submit UNKNOWN and does not replay', async (reason) => {
    const device = worker(null)
    if (reason === 'worker error') device.submit.mockRejectedValue(new Error('worker disconnected'))
    const instance = await runtime(new WindowsUsbPrintBoundary(() => device))
    expect(await instance.execute()).toMatchObject({
      status: 'EXECUTION_RECORDED_REPORT_PENDING', execution: { status: 'CROSSING_UNKNOWN' },
    })
    expect(await instance.execute()).toMatchObject({
      status: 'EXECUTION_RECORDED_REPORT_PENDING',
      execution: { status: 'NOT_EXECUTED', record: { state: 'CROSSING_UNKNOWN' } },
    })
    expect(instance.outbox.listReportable()).toEqual([])
    expect(instance.outbox.list()).toMatchObject([{ outcome: 'CROSSING_UNKNOWN', reportable: false }])
    expect(device.submit).toHaveBeenCalledTimes(1)
    await instance.ledger.close()
    const reopened = new ExecutionOutbox(instance.root)
    await reopened.open()
    expect(reopened.listReportable()).toMatchObject([{ outcome: 'CROSSING_UNKNOWN', reportable: true }])
  })

  function ownerControl(binding: typeof identity) {
    const batch = {
      id: 'usb-batch', controlPlaneId: 'plane', tenantId: 'tenant', storeId: binding.storeId,
      ownerDeviceId: binding.deviceId, ownerEpoch: 2, stateVersion: 7, leaseId: 'lease',
      mode: 'V3_ACTIVE', expiresAt: job.expiresAt, revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    }
    const complete = vi.fn(async () => {})
    const mock = {
      current: () => ({ status: 'V3_OWNER', controlPlane: { mode: 'V3_ACTIVE' }, batch }),
      markExecutionLifecycleReady: vi.fn(async () => {}),
      validateExecution: () => ({ ok: true, value: undefined }),
      validateAdmittedExecution: () => ({ ok: true, value: undefined }),
      beginExecutionLifecycle: () => ({ ok: true, guard: { complete } }),
    }
    return { batch, complete, mock, control: mock as unknown as V3ControlPlaneRuntime }
  }

  it.each([
    { binding: identity, endpoint: usb, endpointKey: key },
    { binding: otherIdentity, endpoint: otherUsb, endpointKey: otherKey },
  ])('routes a real-order job through USB FRONT for $binding.storeId', async ({ binding, endpoint, endpointKey }) => {
    const root = await tempRoot()
    const { batch, control } = ownerControl(binding)
    const receive = vi.fn(async () => ({ ok: true, job: {
      printJobId: job.printJobId, source: 'CLOUD_H5', role: 'FRONT', rendererVersion: job.rendererVersion,
      expiresAt: job.expiresAt, payloadKind: 'RAW_BYTES', payload: Uint8Array.of(1),
    } }))
    const report = vi.fn(async () => true)
    const ready = vi.spyOn(WindowsUsbPrintBoundary.prototype, 'isReady').mockResolvedValue(true)
    const cross = vi.spyOn(WindowsUsbPrintBoundary.prototype, 'cross').mockResolvedValue({
      outcome: 'CROSSED', spoolerJobId: 42, rawDocumentCommitted: true,
    })
    const instance = await V3PrintingRuntime.open({ ...binding, userDataPath: root, controlPlane: control,
      cloud: { receive, report } as unknown as V3PrintJobClient, cloudPollIntervalMs: 60_000 })
    try {
      await instance.provisionEndpoints({ revision: 1, endpoints: { FRONT: endpoint } })
      await instance.start()
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
      expect(ready).toHaveBeenCalledWith(endpointKey)
      expect(receive).toHaveBeenCalledTimes(1)
      expect(receive).toHaveBeenCalledWith(batch, 'FRONT')
      expect(cross).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'CROSSED', role: 'FRONT', ownerEpoch: 2 }))
    } finally {
      await instance.close()
    }
  })

  const testFlag = () => `--v3-usb-front-test=${Date.now()}:ad12afe8-960b-42b5-863a-7d7c1d5ed7aa`

  it('requires one fresh explicit test request', () => {
    const flag = testFlag()
    expect(readUsbFrontTestRequest([])).toBeNull()
    expect(readUsbFrontTestRequest([flag])?.printJobId).toMatch(/^usb-front-test:/)
    expect(() => readUsbFrontTestRequest([flag, flag])).toThrow('USB_TEST_REQUEST_INVALID')
    expect(() => readUsbFrontTestRequest([flag], Date.now() + 360_000)).toThrow('USB_TEST_REQUEST_EXPIRED')
  })

  it.each(['CROSSED', 'FAILED_NOT_CROSSED', 'CROSSING_UNKNOWN'] as const)(
    'persists the isolated USB test outcome %s and never replays its request after restart',
    async (outcome) => {
      const root = await tempRoot()
      const { control, complete, mock } = ownerControl(otherIdentity)
      const report = vi.fn(async () => true)
      const holdLocal = vi.fn()
      const receive = vi.fn(async () => ({ ok: true, job: null }))
      vi.spyOn(WindowsUsbPrintBoundary.prototype, 'isReady').mockResolvedValue(true)
      const flag = testFlag()
      const request = readUsbFrontTestRequest([flag])!
      const cross = vi.spyOn(WindowsUsbPrintBoundary.prototype, 'cross').mockImplementation(async ({ payload, endpointKey, validateExecution }) => {
        expect(endpointKey).toBe(otherKey)
        expect(Buffer.from(payload).toString()).toContain(`TEST - NO SALE\n${request.printJobId}`)
        expect(await validateExecution()).toMatchObject({ ok: true })
        const ledgerPath = path.join(usbFrontTestLedgerPath(root), '.execution-ledger.json')
        expect(JSON.parse(await readFile(ledgerPath, 'utf8')).records[request.printJobId].state).toBe('CROSSING_UNKNOWN')
        if (outcome === 'CROSSED') return { outcome, spoolerJobId: 42, rawDocumentCommitted: true }
        if (outcome === 'FAILED_NOT_CROSSED') return { outcome: 'NOT_CROSSED', zeroBytesSent: true, errorCode: 'USB_QUEUE_NOT_READY' }
        return { outcome: 'UNKNOWN', reason: 'USB_SPOOLER_RESULT_UNKNOWN' }
      })
      const open = () => V3PrintingRuntime.open({
        ...otherIdentity, userDataPath: root, controlPlane: control,
        cloud: { receive, report, holdLocal } as unknown as V3PrintJobClient,
      })
      const instance = await open()
      try {
        await instance.provisionEndpoints({ revision: 1, endpoints: { FRONT: otherUsb } })
        await instance.start([flag])
        const ledgerPath = path.join(usbFrontTestLedgerPath(root), '.execution-ledger.json')
        expect(JSON.parse(await readFile(ledgerPath, 'utf8')).records[request.printJobId].state).toBe(outcome)
        expect(complete).toHaveBeenCalledWith({ releaseSafe: outcome !== 'CROSSING_UNKNOWN' })
      } finally {
        await instance.close()
      }
      const reopened = await open()
      try {
        await reopened.start([outcome === 'CROSSING_UNKNOWN' ? testFlag().replace(/7aa$/, '7ab') : flag])
        expect(mock.markExecutionLifecycleReady).toHaveBeenLastCalledWith(expect.objectContaining({
          releaseBlocked: outcome === 'CROSSING_UNKNOWN',
        }))
        expect(cross).toHaveBeenCalledTimes(1)
        expect(report).not.toHaveBeenCalled()
        expect(holdLocal).not.toHaveBeenCalled()
      } finally {
        await reopened.close()
      }
    },
  )

  it.each([
    { FRONT: tcp, KITCHEN: tcp, expected: ['FRONT', 'KITCHEN'] },
    { FRONT: otherUsb, KITCHEN: tcp, expected: ['KITCHEN'] },
  ])('keeps TCP roles routed to TCP with opt-in configuration %j', async ({ FRONT, KITCHEN, expected }) => {
    const root = await tempRoot()
    const { control } = ownerControl(otherIdentity)
    vi.spyOn(NoPayloadEndpointReadiness.prototype, 'check').mockResolvedValue({
      ok: true, roles: { FRONT: true, KITCHEN: true },
    })
    const usbCross = vi.spyOn(WindowsUsbPrintBoundary.prototype, 'cross').mockResolvedValue({
      outcome: 'CROSSED', spoolerJobId: 42, rawDocumentCommitted: true,
    })
    const tcpCross = vi.spyOn(RawTcpEffectBoundary.prototype, 'cross').mockResolvedValue({
      outcome: 'CROSSED', allBytesWritten: true, flushAndFinConfirmed: true,
    })
    const instance = await V3PrintingRuntime.open({ ...otherIdentity, userDataPath: root, controlPlane: control })
    try {
      await instance.provisionEndpoints({ revision: 1, endpoints: { FRONT, KITCHEN } })
      await instance.start('kind' in FRONT ? [] : [testFlag()])
      expect(usbCross).not.toHaveBeenCalled()
      for (const role of ['FRONT', 'KITCHEN'] as const) {
        expect(await instance.execute({ source: 'LOCAL_DESKTOP', role, payload: Uint8Array.of(1),
          identity: { ...job, printJobId: role } })).toMatchObject({ status: 'CROSSED' })
      }
      expect(tcpCross).toHaveBeenCalledTimes(expected.length)
      expect(usbCross).toHaveBeenCalledTimes(2 - expected.length)
    } finally {
      await instance.close()
    }
  })

  it('fails closed when the job expires during preparation', async () => {
    const device = worker()
    const input = boundaryInput()
    input.identity = { ...input.identity, expiresAt: '2000-01-01T00:00:00Z' }
    const boundary = new WindowsUsbPrintBoundary(() => device)
    expect(await boundary.cross(input)).toMatchObject({ outcome: 'NOT_CROSSED', errorCode: 'USB_JOB_EXPIRED' })
    expect(device.submit).not.toHaveBeenCalled()
  })
})

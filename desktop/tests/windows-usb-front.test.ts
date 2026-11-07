import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
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
import { windowsUsbEndpointKey, type WindowsUsbEndpoint } from '../src/main/printing/windowsUsbEndpoint'
import { WindowsUsbPrintBoundary } from '../src/main/printing/windowsUsbPrintBoundary'
import { V3PrintingRuntime } from '../src/main/printing/v3PrintingRuntime'
import type { V3ControlPlaneRuntime } from '../src/main/printing/controlPlaneRuntime'
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

describe('Diamond USB FRONT', () => {
  it.each([
    { replyAtMs: 3154, ready: true },
    { replyAtMs: 5001, ready: false },
  ])('admits only READY within the USB probe budget ($replyAtMs ms)', async ({ replyAtMs, ready }) => {
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
      const probe = new WindowsUsbPrintBoundary().isReady(key)
      setTimeout(() => child.stdout.write('READY\n'), replyAtMs)
      await vi.advanceTimersByTimeAsync(replyAtMs)
      expect(await probe).toBe(ready)
      expect(messages).toEqual([JSON.stringify({ endpoint: usb, mode: 'probe' }) + '\n'])
      expect(child.kill).toHaveBeenCalledTimes(1)
    } finally {
      child.stdout.destroy()
      vi.useRealTimers()
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
    }
  })

  it('restricts the encrypted endpoint to Diamond FRONT and preserves TCP KITCHEN', async () => {
    const root = await tempRoot()
    const authority = new LocalEndpointAuthority(root, identity, storage)
    await authority.provision({ revision: 1, endpoints: { FRONT: tcp, KITCHEN: tcp } })
    await authority.provision({ revision: 2, endpoints: { FRONT: usb, KITCHEN: tcp } })
    expect(await authority.configuredForRecovery()).toEqual({
      ok: true, endpoints: [{ role: 'FRONT', endpointKey: key }, { role: 'KITCHEN', endpointKey: '192.168.0.59:9100' }],
    })
    await expect(authority.provision({ revision: 3, endpoints: { KITCHEN: usb } })).rejects.toThrow('ENDPOINT_CONFIG_INVALID')
    await expect(authority.provision({ revision: 3, endpoints: {
      FRONT: { ...usb, deviceInstanceId: 'USB\\VID_0525&PID_A4A8\\NP330' },
    } })).rejects.toThrow('ENDPOINT_CONFIG_INVALID')
    for (const foreign of [{ ...identity, deviceId: 'other-device' }, { ...identity, storeId: 'other-store' }]) {
      const other = new LocalEndpointAuthority(await tempRoot(), foreign, storage)
      await expect(other.provision({ revision: 1, endpoints: { FRONT: usb } })).rejects.toThrow('ENDPOINT_CONFIG_INVALID')
      expect(await new LocalEndpointAuthority(root, foreign, storage).resolve('FRONT')).toMatchObject({ ok: false })
    }
    await authority.provision({ revision: 3, endpoints: { FRONT: tcp, KITCHEN: tcp } })
    expect(await authority.resolve('FRONT')).toEqual({ ok: true, endpointKey: '192.168.0.59:9100' })
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

  it('receives only a ready USB FRONT job through the normal runtime and reports its terminal fact', async () => {
    const root = await tempRoot()
    const batch = {
      id: 'usb-batch', controlPlaneId: 'plane', tenantId: 'tenant', storeId: identity.storeId,
      ownerDeviceId: identity.deviceId, ownerEpoch: 2, stateVersion: 7, leaseId: 'lease',
      mode: 'V3_ACTIVE', expiresAt: job.expiresAt, revokedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
    }
    const control = {
      current: () => ({ status: 'V3_OWNER', controlPlane: { mode: 'V3_ACTIVE' }, batch }),
      markExecutionLifecycleReady: vi.fn(async () => {}),
      validateExecution: () => ({ ok: true, value: undefined }),
      validateAdmittedExecution: () => ({ ok: true, value: undefined }),
      beginExecutionLifecycle: () => ({ ok: true, guard: { complete: async () => {} } }),
    } as unknown as V3ControlPlaneRuntime
    const receive = vi.fn(async () => ({ ok: true, job: {
      printJobId: job.printJobId, source: 'CLOUD_H5', role: 'FRONT', rendererVersion: job.rendererVersion,
      expiresAt: job.expiresAt, payloadKind: 'RAW_BYTES', payload: Uint8Array.of(1),
    } }))
    const report = vi.fn(async () => true)
    const ready = vi.spyOn(WindowsUsbPrintBoundary.prototype, 'isReady').mockResolvedValue(true)
    const cross = vi.spyOn(WindowsUsbPrintBoundary.prototype, 'cross').mockResolvedValue({
      outcome: 'CROSSED', spoolerJobId: 42, rawDocumentCommitted: true,
    })
    const instance = await V3PrintingRuntime.open({ ...identity, userDataPath: root, controlPlane: control,
      cloud: { receive, report } as unknown as V3PrintJobClient, cloudPollIntervalMs: 60_000 })
    try {
      await instance.provisionEndpoints({ revision: 1, endpoints: { FRONT: usb } })
      await instance.start()
      await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1))
      expect(ready).toHaveBeenCalledWith(key)
      expect(receive).toHaveBeenCalledTimes(1)
      expect(receive).toHaveBeenCalledWith(batch, 'FRONT')
      expect(cross).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'CROSSED', role: 'FRONT', ownerEpoch: 2 }))
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

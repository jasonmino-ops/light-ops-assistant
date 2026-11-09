import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import type { WindowManager } from '../src/main/windowManager'
import type { PrintSettingsRequest } from '../src/shared/v3PrintSettings'
import { IPC_CHANNELS } from '../src/shared/ipcChannels'
import { registerIpcHandlers, setV3PrintingRuntimeProvider } from '../src/main/ipcRouter'
import { V3PrintingRuntime } from '../src/main/printing/v3PrintingRuntime'
import { LocalEndpointAuthority } from '../src/main/printing/localEndpointAuthority'
import { windowsUsbEndpointKey } from '../src/main/printing/windowsUsbEndpoint'

const ipc = vi.hoisted(() => ({ on: vi.fn(), handle: vi.fn(), showMessageBox: vi.fn() }))
vi.mock('electron', () => ({ ipcMain: ipc, app: { getPath: () => '/test' }, safeStorage: {}, dialog: { showMessageBox: ipc.showMessageBox } }))
vi.mock('../src/main/config', () => ({
  getConfig: () => ({ baseUrl: 'https://test.invalid', lang: 'en' }),
  isAllowedNavigation: (url: string) => url.startsWith('https://test.invalid/'),
}))

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform)
  setV3PrintingRuntimeProvider(() => null)
  ipc.handle.mockClear()
  ipc.showMessageBox.mockReset()
})

const storeCode = 'STORE-A'
const usb = { kind: 'windows-usb' as const, queueName: 'Front USB', portName: 'USB002', deviceInstanceId: 'USB\\VID_1234&PID_5678\\EXAMPLE' }
const kitchen = { host: '192.168.1.22', port: 9100 }
const batch = { id: 'batch-a', deviceId: 'device-a', storeId: 'store-a', ownerEpoch: 2, leaseId: 'lease-a' }
const read = { action: 'read', storeCode } as const
const queues = { action: 'queues', storeCode } as const
const test = { action: 'test', storeCode, revision: 4 } as const

function harness() {
  Object.defineProperty(process, 'platform', { ...originalPlatform, value: 'win32' })
  const complete = vi.fn(async () => undefined)
  const validateExecution = vi.fn(() => ({ ok: true }))
  const controlPlane = {
    current: vi.fn(() => ({ controlPlane: { mode: 'V3_ACTIVE' }, batch })),
    validateExecution,
    validateAdmittedExecution: vi.fn(() => ({ ok: true })),
    beginExecutionLifecycle: vi.fn(() => ({ ok: true, guard: { complete } })),
  }
  const endpoints = {
    readSettings: vi.fn(async () => ({ ok: true, revision: 4, endpoints: { FRONT: usb, KITCHEN: kitchen } })),
    resolve: vi.fn(async () => ({ ok: true, endpointKey: windowsUsbEndpointKey(usb) })),
    provision: vi.fn(async (_input, options) => options.beforeCommit()),
  }
  const outbox = { list: vi.fn((): { outcome: string }[] => []), listReportable: vi.fn(() => []) }
  const cloud = { receive: vi.fn(), report: vi.fn(), holdLocal: vi.fn() }
  const runTest = vi.fn(async (_request, _endpoint, validate) => {
    if (!validate().ok) throw new Error('test authorization')
    return { status: 'CROSSED' }
  })
  const discover = vi.fn(async () => [usb])
  const runtime = new (V3PrintingRuntime as any)({}, {}, controlPlane, endpoints, outbox, cloud, 60_000,
    {}, false, undefined, undefined, runTest, storeCode, discover) as V3PrintingRuntime
  Object.assign(runtime, { running: true, settingsReady: true, lifecycleGeneration: 1 })
  return { runtime, controlPlane, endpoints, outbox, cloud, discover, runTest, complete, validateExecution }
}

describe('native device printing settings', () => {
  it('reads the current roles without provisioning, discovery, claims or execution', async () => {
    const h = harness()
    expect(await h.runtime.printSettings(read)).toMatchObject({
      ok: true, state: { mode: 'V3', revision: 4, front: { kind: 'USB', queueName: 'Front USB' }, kitchen },
    })
    expect(h.controlPlane.beginExecutionLifecycle).not.toHaveBeenCalled()
    expect(h.discover).not.toHaveBeenCalled()
    expect(h.endpoints.provision).not.toHaveBeenCalled()
    expect(h.cloud.receive).not.toHaveBeenCalled()
    expect(h.runTest).not.toHaveBeenCalled()
    expect(await h.runtime.printSettings({ ...read, storeCode: 'OTHER' })).toEqual({
      ok: false, code: 'PRINT_SETTINGS_STORE_MISMATCH',
    })
    expect(h.endpoints.readSettings).toHaveBeenCalledTimes(1)
  })

  it('rechecks discovered device identity and preserves the other role at the next revision', async () => {
    const h = harness()
    const result = await h.runtime.printSettings(queues)
    if (!result.ok || !('queues' in result)) throw new Error('expected USB queue')
    expect(result.queues).toEqual([{ queueName: 'Front USB', portName: 'USB002', key: expect.stringMatching(/^[a-f0-9]{64}$/) }])
    const save: PrintSettingsRequest = {
      action: 'save', storeCode, revision: 4, role: 'FRONT', target: { kind: 'USB', ...result.queues[0]! },
    }
    expect(await h.runtime.printSettings({ ...save, revision: 3 })).toEqual({ ok: false, code: 'ENDPOINT_CONFIG_REVISION_STALE' })
    h.discover.mockResolvedValueOnce([{ ...usb, deviceInstanceId: usb.deviceInstanceId + '2' }])
    expect(await h.runtime.printSettings(save)).toEqual({ ok: false, code: 'USB_QUEUE_NOT_READY' })
    expect(h.endpoints.provision).not.toHaveBeenCalled()
    expect(await h.runtime.printSettings(save)).toEqual({ ok: true, code: 'SETTINGS_SAVED' })
    expect(h.endpoints.provision).toHaveBeenCalledWith({ revision: 5, endpoints: { FRONT: usb, KITCHEN: kitchen } },
      { expectedRevision: 4, beforeCommit: expect.any(Function) })
  })

  it('blocks concurrent changes, a fence drift at commit, and unreported executions', async () => {
    const h = harness()
    const save = { action: 'save', storeCode, revision: 4, role: 'KITCHEN',
      target: { kind: 'TCP', host: '192.168.1.23', port: 9100 } } as const
    h.endpoints.provision.mockImplementationOnce(async (_input, options) => {
      expect(await h.runtime.printSettings(test)).toEqual({ ok: false, code: 'PRINT_SETTINGS_BUSY' })
      await (h.runtime as any).pump()
      h.validateExecution.mockReturnValueOnce({ ok: false })
      options.beforeCommit()
    })
    expect(await h.runtime.printSettings(save)).toEqual({ ok: false, code: 'PRINT_SETTINGS_AUTHORITY_REQUIRED' })
    expect(h.cloud.receive).not.toHaveBeenCalled()
    h.outbox.list.mockReturnValue([{ outcome: 'CROSSED' }])
    expect(await h.runtime.printSettings(save)).toEqual({ ok: false, code: 'PRINT_SETTINGS_PENDING_REPORTS' })
  })

  it('reuses the fenced diagnostic path and refuses to repeat UNKNOWN', async () => {
    const h = harness()
    h.runTest.mockResolvedValueOnce({ status: 'CROSSING_UNKNOWN' })
    expect(await h.runtime.printSettings(test)).toEqual({ ok: false, code: 'LOCAL_EFFECT_AMBIGUITY' })
    expect(h.controlPlane.beginExecutionLifecycle).toHaveBeenCalledWith(batch)
    expect(h.complete).toHaveBeenCalledWith({ releaseSafe: false })
    expect(await h.runtime.printSettings(test)).toEqual({ ok: false, code: 'LOCAL_EFFECT_AMBIGUITY' })
    expect(h.runTest).toHaveBeenCalledTimes(1)
    expect(h.cloud.receive).not.toHaveBeenCalled()
    expect(h.cloud.report).not.toHaveBeenCalled()
  })

  it('keeps V2 explicitly on the legacy source', async () => {
    const h = harness()
    h.controlPlane.current.mockReturnValue({ controlPlane: { mode: 'V2_ACTIVE' }, batch })
    expect(await h.runtime.printSettings(read)).toMatchObject({ ok: true, state: { mode: 'LEGACY', usbSupported: false } })
    expect(await h.runtime.printSettings(test)).toEqual({ ok: false, code: 'PRINT_SETTINGS_AUTHORITY_REQUIRED' })
    expect(h.endpoints.readSettings).not.toHaveBeenCalled()
  })
})

describe('settings IPC', () => {
  it('accepts only the employee management main frame and exact payload', async () => {
    const h = harness()
    setV3PrintingRuntimeProvider(() => h.runtime)
    const getRole = vi.fn(() => 'employee')
    registerIpcHandlers({ getRole, getEmployeeWindow: () => ({
      isDestroyed: () => false, webContents: { id: 1 },
    }) } as unknown as WindowManager)
    const handler = ipc.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.V3_PRINT_SETTINGS)![1]
    const invoke = (url: string, payload: unknown, subframe = false) => {
      const mainFrame = { url }
      return handler({ sender: { id: 1, mainFrame }, senderFrame: subframe ? { url } : mainFrame } as IpcMainInvokeEvent, payload)
    }
    const management = 'https://test.invalid/management'
    for (const url of ['https://other.invalid/management', 'https://test.invalid/cashier']) {
      expect(await invoke(url, read)).toEqual({ ok: false, code: 'PRINT_SETTINGS_ACCESS_DENIED' })
    }
    expect(await invoke(management, read, true)).toEqual({ ok: false, code: 'PRINT_SETTINGS_ACCESS_DENIED' })
    getRole.mockReturnValueOnce('customer')
    expect(await invoke(management, read)).toEqual({ ok: false, code: 'PRINT_SETTINGS_ACCESS_DENIED' })
    expect(await invoke(management, { ...test, payload: 'raw bytes' })).toEqual({ ok: false, code: 'PRINT_SETTINGS_INPUT_INVALID' })
    expect(await invoke(management, { action: 'save', storeCode, revision: 4, role: 'FRONT',
      target: { kind: 'TCP', host: '8.8.8.8', port: 9100 } })).toEqual({ ok: false, code: 'PRINT_SETTINGS_INPUT_INVALID' })
    expect(h.endpoints.readSettings).not.toHaveBeenCalled()
    expect(await invoke(management, read)).toMatchObject({ ok: true, state: { mode: 'V3' } })
    expect(ipc.showMessageBox).not.toHaveBeenCalled()
    expect(await invoke(management, { ...test, storeCode: 'OTHER' })).toEqual({ ok: false, code: 'PRINT_SETTINGS_STORE_MISMATCH' })
    expect(ipc.showMessageBox).not.toHaveBeenCalled()
    ipc.showMessageBox.mockResolvedValueOnce({ response: 0 })
    expect(await invoke(management, test)).toEqual({ ok: false, code: 'PRINT_SETTINGS_CANCELLED' })
    expect(h.runTest).not.toHaveBeenCalled()
    ipc.showMessageBox.mockResolvedValueOnce({ response: 1 })
    expect(await invoke(management, test)).toEqual({ ok: true, code: 'USB_TEST_SPOOLED' })
    expect(ipc.showMessageBox).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ defaultId: 0, cancelId: 0 }))
    expect(h.runTest).toHaveBeenCalledTimes(1)
  })
})

it('leaves the encrypted revision untouched on stale, wrong-binding, and fenced commits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eshop-v3-settings-test-'))
  const protector = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  }
  const bound = new LocalEndpointAuthority(root, { deviceId: 'A', storeId: 'store-A' }, protector)
  const wrong = new LocalEndpointAuthority(root, { deviceId: 'B', storeId: 'store-A' }, protector)
  const change = { revision: 3, endpoints: { FRONT: usb, KITCHEN: kitchen } }
  try {
    expect(await bound.readSettings()).toEqual({ ok: true, revision: 0, endpoints: {} })
    await bound.provision({ revision: 2, endpoints: { KITCHEN: kitchen } })
    const file = join(root, 'v3-printing', 'endpoints.json')
    const original = await readFile(file)
    await expect(wrong.provision(change, { expectedRevision: 0, beforeCommit() {} })).rejects.toThrow('ENDPOINT_IDENTITY_MISMATCH')
    await expect(bound.provision(change, { expectedRevision: 1, beforeCommit() {} })).rejects.toThrow('ENDPOINT_CONFIG_REVISION_STALE')
    await expect(bound.provision(change, { expectedRevision: 2, beforeCommit() { throw new Error('FENCED') } })).rejects.toThrow('FENCED')
    expect(await readFile(file)).toEqual(original)
    await bound.provision(change, { expectedRevision: 2, beforeCommit() {} })
    expect(await bound.readSettings()).toEqual({ ok: true, ...change })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

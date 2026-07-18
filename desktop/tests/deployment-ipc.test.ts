import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '../src/shared/ipcChannels'
import { registerIpcHandlers } from '../src/main/ipcRouter'

const mockState = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockState.handles.set(channel, handler)
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockState.listeners.set(channel, handler)
    }),
  },
}))

function event(senderId: number, options: { iframe?: boolean } = {}): IpcMainInvokeEvent {
  const mainFrame = {}
  return {
    sender: { id: senderId, mainFrame },
    senderFrame: options.iframe ? {} : mainFrame,
  } as IpcMainInvokeEvent
}

function makeWindowManager(activeRenderer: boolean) {
  return {
    getRole: vi.fn((id: number) => (id === 11 || id === 12 || id === 13 || id === 14 ? 'employee' : 'customer')),
    isEmployeeDeploymentRendererActive: vi.fn(() => activeRenderer),
    retryEmployeeBusinessLoad: vi.fn(() => ({ ok: true })),
    recheckDisplays: vi.fn(() => true),
    getEmployeeWindow: vi.fn(),
  }
}

describe('deployment IPC', () => {
  beforeEach(() => {
    mockState.handles.clear()
    mockState.listeners.clear()
  })

  it('denies deployment calls outside the local employee deployment renderer', async () => {
    const windowManager = makeWindowManager(false)
    const getSystemInfo = vi.fn()
    registerIpcHandlers(windowManager as never, {
      getSystemInfo,
      openLogs: vi.fn(),
      exportDiagnostics: vi.fn(),
      onQuit: vi.fn(),
      returnToActivation: vi.fn(),
      recheckProvider: vi.fn(),
    })

    const handler = mockState.handles.get(IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO)
    await expect(handler?.(event(11))).resolves.toEqual({ ok: false, error: 'UNAUTHORIZED' })
    expect(getSystemInfo).not.toHaveBeenCalled()
  })

  it('denies iframe senders even in deployment renderer mode', async () => {
    const windowManager = makeWindowManager(true)
    registerIpcHandlers(windowManager as never, {
      getSystemInfo: vi.fn(),
      openLogs: vi.fn(),
      exportDiagnostics: vi.fn(),
      onQuit: vi.fn(),
      returnToActivation: vi.fn(),
      recheckProvider: vi.fn(),
    })

    const handler = mockState.handles.get(IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO)
    await expect(handler?.(event(12, { iframe: true }))).resolves.toEqual({ ok: false, error: 'UNAUTHORIZED' })
  })

  it('returns structured system information for the active local renderer', async () => {
    const windowManager = makeWindowManager(true)
    const systemInfo = {
      version: '0.2.0',
      distributionClass: 'UNSIGNED_INTERNAL',
      shortInstallationId: 'abcd-1234',
      maskedStoreCode: 'ST***-A',
    }
    registerIpcHandlers(windowManager as never, {
      getSystemInfo: vi.fn(() => systemInfo as never),
      openLogs: vi.fn(),
      exportDiagnostics: vi.fn(),
      onQuit: vi.fn(),
      returnToActivation: vi.fn(),
      recheckProvider: vi.fn(),
    })

    const handler = mockState.handles.get(IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO)
    await expect(handler?.(event(13))).resolves.toEqual({ ok: true, data: systemInfo })
  })

  it('rejects renderer supplied payloads for deployment commands', async () => {
    const windowManager = makeWindowManager(true)
    registerIpcHandlers(windowManager as never, {
      getSystemInfo: vi.fn(),
      openLogs: vi.fn(),
      exportDiagnostics: vi.fn(),
      onQuit: vi.fn(),
      returnToActivation: vi.fn(),
      recheckProvider: vi.fn(),
    })

    const handler = mockState.handles.get(IPC_CHANNELS.DEPLOYMENT_OPEN_LOGS)
    await expect(handler?.(event(14), { path: '/tmp/anything' })).resolves.toEqual({ ok: false, error: 'INVALID_PAYLOAD' })
  })

  it('maps diagnostics export results without accepting a renderer path', async () => {
    const windowManager = makeWindowManager(true)
    const exportDiagnostics = vi.fn(async () => ({
      ok: true,
      filePath: '/chosen/by/native/dialog.zip',
      manifest: { schemaVersion: 1 },
    }))
    registerIpcHandlers(windowManager as never, {
      getSystemInfo: vi.fn(),
      openLogs: vi.fn(),
      exportDiagnostics: exportDiagnostics as never,
      onQuit: vi.fn(),
      returnToActivation: vi.fn(),
      recheckProvider: vi.fn(),
    })

    const handler = mockState.handles.get(IPC_CHANNELS.DEPLOYMENT_EXPORT_DIAGNOSTICS)
    await expect(handler?.(event(12))).resolves.toEqual({
      ok: true,
      data: {
        filePath: '/chosen/by/native/dialog.zip',
        manifest: { schemaVersion: 1 },
      },
    })
    expect(exportDiagnostics).toHaveBeenCalledWith()
  })
})

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import {
  ACTIVATION_IPC_CHANNELS,
  registerActivationIpcHandlers,
  validateActivationInput,
  validateRendererCheckpoint,
} from '../src/main/activation/activationIpc'
import { logger } from '../src/main/logger'

const mockState = vi.hoisted(() => ({
  handles: new Map<string, (...args: unknown[]) => unknown>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockState.handles.set(channel, handler)
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

describe('activation IPC', () => {
  beforeEach(() => {
    mockState.handles.clear()
  })

  it('validates storeCode and six digit PIN locally', () => {
    expect(validateActivationInput({ storeCode: ' store-a ', pin: '123456' })).toEqual({
      storeCode: 'STORE-A',
      pin: '123456',
    })
    expect(validateActivationInput({ storeCode: 'STORE-A', pin: '12345' })).toBeNull()
    expect(validateActivationInput({ storeCode: '../STORE-A', pin: '123456' })).toBeNull()
  })

  it('accepts only activation window main-frame sender', async () => {
    const runtime = {
      getPublicState: vi.fn(() => ({ kind: 'UNACTIVATED' })),
      activate: vi.fn(async () => ({ kind: 'VERIFYING' })),
      retryVerification: vi.fn(),
      resetLocalActivation: vi.fn(),
      markQuitting: vi.fn(),
    }
    const windowController = {
      isActivationSender: vi.fn((e: IpcMainInvokeEvent) => e.sender.id === 11 && e.senderFrame === e.sender.mainFrame),
    }
    registerActivationIpcHandlers({
      runtime: runtime as never,
      windowController: windowController as never,
      onQuit: vi.fn(),
    })

    const activate = mockState.handles.get(ACTIVATION_IPC_CHANNELS.ACTIVATE)
    expect(activate).toBeTypeOf('function')
    await expect(activate?.(event(11), { storeCode: 'STORE-A', pin: '123456' })).resolves.toEqual({
      ok: true,
      state: { kind: 'VERIFYING' },
    })
    await expect(activate?.(event(12), { storeCode: 'STORE-A', pin: '123456' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    })
    await expect(activate?.(event(11, { iframe: true }), { storeCode: 'STORE-A', pin: '123456' })).resolves.toEqual({
      ok: false,
      error: 'UNAUTHORIZED',
    })
    expect(runtime.activate).toHaveBeenCalledTimes(1)
  })

  it('does not expose token-shaped public DTOs through handlers', async () => {
    const runtime = {
      getPublicState: vi.fn(() => ({
        kind: 'UNACTIVATED',
        isBusy: false,
        canActivate: true,
        canRetryVerify: false,
        canResetLocal: false,
        canQuit: true,
      })),
      activate: vi.fn(),
      retryVerification: vi.fn(),
      resetLocalActivation: vi.fn(),
      markQuitting: vi.fn(),
    }
    registerActivationIpcHandlers({
      runtime: runtime as never,
      windowController: { isActivationSender: () => true } as never,
      onQuit: vi.fn(),
    })
    const getState = mockState.handles.get(ACTIVATION_IPC_CHANNELS.GET_STATE)
    const result = await getState?.(event(11))
    expect(JSON.stringify(result)).not.toMatch(/deviceToken|authorization|bearer|ciphertext/i)
  })

  it('allowlists renderer startup checkpoints and rejects arbitrary payloads', () => {
    expect(validateRendererCheckpoint({ stage: 'rendered', stateKind: 'UNACTIVATED' })).toEqual({
      stage: 'rendered',
      stateKind: 'UNACTIVATED',
    })
    expect(validateRendererCheckpoint({ stage: 'rendered', stateKind: 'MADE_UP' })).toBeNull()
    expect(validateRendererCheckpoint({ stage: 'eval-this', reasonCode: 'x' })).toBeNull()
    expect(validateRendererCheckpoint({ stage: 'startup-error', reasonCode: 'token=abc&pin=123456&storeCode=STORE-A' })).toEqual({
      stage: 'startup-error',
      reasonCode: 'ACTIVATION_RENDERER_ERROR',
    })
  })

  it('logs get-state invocation/completion and forwards renderer checkpoints', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined)
    const runtime = {
      getPublicState: vi.fn(() => ({
        kind: 'UNACTIVATED',
        isBusy: false,
        canActivate: true,
        canRetryVerify: false,
        canResetLocal: false,
        canQuit: true,
      })),
      activate: vi.fn(),
      retryVerification: vi.fn(),
      resetLocalActivation: vi.fn(),
      markQuitting: vi.fn(),
    }
    const onRendererCheckpoint = vi.fn()
    registerActivationIpcHandlers({
      runtime: runtime as never,
      windowController: { isActivationSender: () => true } as never,
      onQuit: vi.fn(),
      onRendererCheckpoint,
    })
    await mockState.handles.get(ACTIVATION_IPC_CHANNELS.GET_STATE)?.(event(11))
    await mockState.handles.get(ACTIVATION_IPC_CHANNELS.RENDERER_CHECKPOINT)?.(event(11), {
      stage: 'rendered',
      stateKind: 'UNACTIVATED',
    })
    expect(info).toHaveBeenCalledWith('activation-ipc.get-state.invoked', expect.any(Object))
    expect(info).toHaveBeenCalledWith('activation-ipc.get-state.completed', { state: 'UNACTIVATED' })
    expect(onRendererCheckpoint).toHaveBeenCalledWith({ stage: 'rendered', stateKind: 'UNACTIVATED' })
    info.mockRestore()
  })
})

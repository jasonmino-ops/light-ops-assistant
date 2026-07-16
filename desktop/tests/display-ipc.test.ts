import { describe, expect, it, vi, beforeEach } from 'vitest'
import { IPC_CHANNELS, type WindowRole } from '../src/shared/ipcChannels'
import type { IpcMainInvokeEvent } from 'electron'
import type { WindowManager } from '../src/main/windowManager'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, Function>() }))

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn((channel: string, handler: Function) => {
      handlers.set(channel, handler)
    }),
  },
}))

import { registerIpcHandlers } from '../src/main/ipcRouter'

function event(senderId: number, iframe = false): IpcMainInvokeEvent {
  const mainFrame = {}
  return {
    sender: { id: senderId, mainFrame },
    senderFrame: iframe ? {} : mainFrame,
  } as IpcMainInvokeEvent
}

function windowManager(role: WindowRole | undefined, canSwap = true) {
  const state = {
    configuredMode: 'dual',
    effectiveMode: canSwap ? 'dual' : 'single',
    displayCount: canSwap ? 2 : 1,
    primaryDisplayId: 1,
    employeeDisplayId: 1,
    customerDisplayId: canSwap ? 2 : null,
    customerVisible: canSwap,
    canSwap,
    degraded: !canSwap,
    reason: canSwap ? 'default-assignment' : 'dual-degraded-single-display',
  }
  return {
    getRole: () => role,
    getDisplayState: vi.fn(() => state),
    setDisplayMode: vi.fn((mode: string) => ({ ok: true, state: { ...state, configuredMode: mode } })),
    swapDisplays: vi.fn(() => canSwap ? { ok: true, state } : { ok: false, state, errorCode: 'SWAP_UNAVAILABLE' }),
  } as unknown as WindowManager
}

beforeEach(() => {
  handlers.clear()
})

describe('display IPC authorization', () => {
  it('allows employee to read display state', async () => {
    const wm = windowManager('employee')
    registerIpcHandlers(wm)
    const result = await handlers.get(IPC_CHANNELS.DISPLAY_GET_STATE)!(event(1))
    expect(result.ok).toBe(true)
    expect(result.state.effectiveMode).toBe('dual')
  })

  it('allows employee to set mode and swap', async () => {
    const wm = windowManager('employee')
    registerIpcHandlers(wm)
    expect(await handlers.get(IPC_CHANNELS.DISPLAY_SET_MODE)!(event(1), 'single')).toMatchObject({ ok: true })
    expect(await handlers.get(IPC_CHANNELS.DISPLAY_SWAP)!(event(1))).toMatchObject({ ok: true })
    expect(wm.setDisplayMode).toHaveBeenCalledWith('single')
    expect(wm.swapDisplays).toHaveBeenCalled()
  })

  it('rejects customer, iframe, and unknown senders', async () => {
    for (const [role, iframe] of [['customer', false], ['employee', true], [undefined, false]] as const) {
      const wm = windowManager(role, true)
      registerIpcHandlers(wm)
      const result = await handlers.get(IPC_CHANNELS.DISPLAY_SWAP)!(event(1, iframe))
      expect(result).toMatchObject({ ok: false, errorCode: 'UNAUTHORIZED' })
      expect(wm.swapDisplays).not.toHaveBeenCalled()
      handlers.clear()
    }
  })

  it('rejects invalid mode and does not accept bounds or window ids', async () => {
    const wm = windowManager('employee')
    registerIpcHandlers(wm)
    const result = await handlers.get(IPC_CHANNELS.DISPLAY_SET_MODE)!(event(1), { x: 1, y: 2, windowId: 7 })
    expect(result).toMatchObject({ ok: false, errorCode: 'INVALID_DISPLAY_MODE' })
    expect(wm.setDisplayMode).not.toHaveBeenCalled()
  })

  it('returns explicit unavailable result for swap on one display', async () => {
    const wm = windowManager('employee', false)
    registerIpcHandlers(wm)
    const result = await handlers.get(IPC_CHANNELS.DISPLAY_SWAP)!(event(1))
    expect(result).toMatchObject({ ok: false, errorCode: 'SWAP_UNAVAILABLE' })
  })
})

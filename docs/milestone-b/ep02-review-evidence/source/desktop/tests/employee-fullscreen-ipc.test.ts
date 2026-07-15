import { describe, it, expect, vi } from 'vitest'
import { IPC_CHANNELS, type WindowRole } from '../src/shared/ipcChannels'
import { setEmployeeFullscreen } from '../src/main/ipcRouter'
import type { IpcMainInvokeEvent } from 'electron'
import type { WindowManager } from '../src/main/windowManager'

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
}))

function makeEvent(senderId: number, options: { iframe?: boolean } = {}): IpcMainInvokeEvent {
  const mainFrame = {}
  return {
    sender: { id: senderId, mainFrame },
    senderFrame: options.iframe ? {} : mainFrame,
  } as IpcMainInvokeEvent
}

function makeWindowManager(role: WindowRole | undefined, employeeWebContentsId = 1) {
  let fullscreen = false
  const setFullScreen = vi.fn((next: boolean) => {
    fullscreen = next
  })
  const win = {
    isDestroyed: () => false,
    webContents: { id: employeeWebContentsId },
    setFullScreen,
    isFullScreen: () => fullscreen,
  }
  const windowManager = {
    getRole: () => role,
    getEmployeeWindow: () => win,
  } as unknown as WindowManager
  return { windowManager, setFullScreen }
}

describe('employee fullscreen IPC', () => {
  it('employee sender can enter native fullscreen', () => {
    const { windowManager, setFullScreen } = makeWindowManager('employee', 7)
    const result = setEmployeeFullscreen(
      windowManager,
      makeEvent(7),
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER,
      true,
    )
    expect(result).toBe(true)
    expect(setFullScreen).toHaveBeenCalledWith(true)
  })

  it('employee sender can exit native fullscreen', () => {
    const { windowManager, setFullScreen } = makeWindowManager('employee', 7)
    const result = setEmployeeFullscreen(
      windowManager,
      makeEvent(7),
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT,
      false,
    )
    expect(result).toBe(false)
    expect(setFullScreen).toHaveBeenCalledWith(false)
  })

  it('customer sender cannot control employee fullscreen', () => {
    const { windowManager, setFullScreen } = makeWindowManager('customer', 7)
    const result = setEmployeeFullscreen(
      windowManager,
      makeEvent(7),
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER,
      true,
    )
    expect(result).toBe(false)
    expect(setFullScreen).not.toHaveBeenCalled()
  })

  it('iframe sender is rejected even in employee window', () => {
    const { windowManager, setFullScreen } = makeWindowManager('employee', 7)
    const result = setEmployeeFullscreen(
      windowManager,
      makeEvent(7, { iframe: true }),
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER,
      true,
    )
    expect(result).toBe(false)
    expect(setFullScreen).not.toHaveBeenCalled()
  })

  it('employee role with mismatched webContents id is rejected', () => {
    const { windowManager, setFullScreen } = makeWindowManager('employee', 7)
    const result = setEmployeeFullscreen(
      windowManager,
      makeEvent(8),
      IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER,
      true,
    )
    expect(result).toBe(false)
    expect(setFullScreen).not.toHaveBeenCalled()
  })
})

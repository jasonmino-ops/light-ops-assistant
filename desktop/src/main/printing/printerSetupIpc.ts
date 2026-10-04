import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { logger } from '../logger'
import type { PrinterRole } from './localEndpointAuthority'
import type { PrinterSetupService, PrinterSetupSnapshot } from './printerSetupService'
import type { PrinterSetupWindowController } from './printerSetupWindowController'

export const PRINTER_SETUP_IPC = {
  GET_STATE: 'eshop:printer-setup:get-state',
  DISCOVER: 'eshop:printer-setup:discover',
  ASSIGN: 'eshop:printer-setup:assign',
  TEST: 'eshop:printer-setup:test',
  SAVE: 'eshop:printer-setup:save',
  CLOSE: 'eshop:printer-setup:close',
  STATE_CHANGED: 'eshop:printer-setup:state-changed',
} as const

type Result = { ok: true; state: PrinterSetupSnapshot } | { ok: false; error: string; state?: PrinterSetupSnapshot }

function role(value: unknown): PrinterRole | null {
  return value === 'FRONT' || value === 'KITCHEN' ? value : null
}

function candidateId(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 7 && value.length <= 128 && /^[0-9a-f.:-]+@?[0-9a-f-]*$/i.test(value)
    ? value
    : null
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(message) ? message : 'PRINTER_SETUP_IPC_ERROR'
}

export function registerPrinterSetupIpcHandlers(options: {
  service: PrinterSetupService
  windowController: PrinterSetupWindowController
  onStateChanged?: (state: PrinterSetupSnapshot) => void
}): void {
  const authorize = (event: IpcMainInvokeEvent, channel: string): boolean => {
    const allowed = options.windowController.isSender(event)
    if (!allowed) logger.warn('printer-setup-ipc.unauthorized', { channel, webContentsId: event.sender.id })
    return allowed
  }
  const action = async (event: IpcMainInvokeEvent, channel: string, execute: () => Promise<PrinterSetupSnapshot> | PrinterSetupSnapshot): Promise<Result> => {
    if (!authorize(event, channel)) return { ok: false, error: 'UNAUTHORIZED' }
    try {
      const state = await execute()
      options.windowController.sendState(state)
      options.onStateChanged?.(state)
      return { ok: true, state }
    } catch (error) {
      return { ok: false, error: errorCode(error), state: options.service.snapshot() }
    }
  }

  ipcMain.handle(PRINTER_SETUP_IPC.GET_STATE, (event) => action(event, PRINTER_SETUP_IPC.GET_STATE, () => options.service.snapshot()))
  ipcMain.handle(PRINTER_SETUP_IPC.DISCOVER, (event) => action(event, PRINTER_SETUP_IPC.DISCOVER, () => options.service.discover()))
  ipcMain.handle(PRINTER_SETUP_IPC.ASSIGN, (event, payload: unknown) => action(event, PRINTER_SETUP_IPC.ASSIGN, () => {
    const row = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null
    const selectedRole = role(row?.role)
    const selectedCandidate = candidateId(row?.candidateId)
    if (!selectedRole || !selectedCandidate) throw new Error('INVALID_PAYLOAD')
    return options.service.assign(selectedRole, selectedCandidate)
  }))
  ipcMain.handle(PRINTER_SETUP_IPC.TEST, (event, payload: unknown) => action(event, PRINTER_SETUP_IPC.TEST, () => {
    const selectedRole = role(payload)
    if (!selectedRole) throw new Error('INVALID_PAYLOAD')
    return options.service.test(selectedRole)
  }))
  ipcMain.handle(PRINTER_SETUP_IPC.SAVE, (event) => action(event, PRINTER_SETUP_IPC.SAVE, () => options.service.save()))
  ipcMain.handle(PRINTER_SETUP_IPC.CLOSE, (event) => action(event, PRINTER_SETUP_IPC.CLOSE, () => {
    options.windowController.close()
    return options.service.snapshot()
  }))
}

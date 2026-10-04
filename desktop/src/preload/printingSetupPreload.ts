import { contextBridge, ipcRenderer } from 'electron'

const channels = {
  getState: 'eshop:printer-setup:get-state',
  discover: 'eshop:printer-setup:discover',
  assign: 'eshop:printer-setup:assign',
  test: 'eshop:printer-setup:test',
  save: 'eshop:printer-setup:save',
  close: 'eshop:printer-setup:close',
  stateChanged: 'eshop:printer-setup:state-changed',
} as const

type Role = 'FRONT' | 'KITCHEN'

contextBridge.exposeInMainWorld('eshopPrinterSetup', Object.freeze({
  getState: () => ipcRenderer.invoke(channels.getState),
  discover: () => ipcRenderer.invoke(channels.discover),
  assign: (role: Role, candidateId: string) => ipcRenderer.invoke(channels.assign, {
    role: role === 'KITCHEN' ? 'KITCHEN' : 'FRONT',
    candidateId: String(candidateId ?? '').slice(0, 128),
  }),
  test: (role: Role) => ipcRenderer.invoke(channels.test, role === 'KITCHEN' ? 'KITCHEN' : 'FRONT'),
  save: () => ipcRenderer.invoke(channels.save),
  close: () => ipcRenderer.invoke(channels.close),
  onStateChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state)
    ipcRenderer.on(channels.stateChanged, listener)
    return () => ipcRenderer.removeListener(channels.stateChanged, listener)
  },
}))

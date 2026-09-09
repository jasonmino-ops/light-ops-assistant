import { contextBridge, ipcRenderer } from 'electron'

// No Node, fs, shell, network, credentials or generic IPC exposed to the UI.
const actions = new Set(['status', 'retryBinding', 'pause', 'discover', 'cancelDiscovery', 'test', 'confirmTest', 'enable', 'autostart', 'cashier'])
contextBridge.exposeInMainWorld('networkAddon', Object.freeze({
  invoke(action: string, value: unknown = {}) {
    if (!actions.has(action)) return Promise.resolve({ ok: false, code: 'ADDON_ACTION_REJECTED' })
    return ipcRenderer.invoke('network-addon:action', action, value)
  },
}))

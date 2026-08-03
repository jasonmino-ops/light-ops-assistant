import { contextBridge, ipcRenderer } from 'electron'

// 只暴露固定的几个通道，渲染层拿不到任何 fs / child_process 能力。
contextBridge.exposeInMainWorld('certManager', {
  status: () => ipcRenderer.invoke('cm:status'),
  log: () => ipcRenderer.invoke('cm:log'),
  install: () => ipcRenderer.invoke('cm:install'),
  update: () => ipcRenderer.invoke('cm:update'),
  repair: () => ipcRenderer.invoke('cm:repair'),
  uninstall: () => ipcRenderer.invoke('cm:uninstall'),
  openLogFolder: () => ipcRenderer.invoke('cm:openLogFolder'),
})

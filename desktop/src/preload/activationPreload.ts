import { contextBridge, ipcRenderer } from 'electron'

const GET_STATE_CHANNEL = 'eshop:activation:get-state'
const ACTIVATE_CHANNEL = 'eshop:activation:activate'
const RETRY_VERIFY_CHANNEL = 'eshop:activation:retry-verify'
const RESET_LOCAL_CHANNEL = 'eshop:activation:reset-local'
const QUIT_CHANNEL = 'eshop:activation:quit'
const STATE_CHANGED_CHANNEL = 'eshop:activation:state-changed'

type ActivationInput = {
  storeCode: string
  pin: string
}

type ActivationResult = {
  ok: boolean
  error?: string
  state?: unknown
}

function cleanActivationInput(input: ActivationInput): ActivationInput {
  return {
    storeCode: String(input.storeCode ?? '').trim().toUpperCase(),
    pin: String(input.pin ?? '').trim(),
  }
}

contextBridge.exposeInMainWorld('eshopDesktopActivation', Object.freeze({
  getState: (): Promise<ActivationResult> => ipcRenderer.invoke(GET_STATE_CHANNEL),
  activate: (input: ActivationInput): Promise<ActivationResult> => ipcRenderer.invoke(
    ACTIVATE_CHANNEL,
    cleanActivationInput(input),
  ),
  retryVerification: (): Promise<ActivationResult> => ipcRenderer.invoke(RETRY_VERIFY_CHANNEL),
  resetLocalActivation: (): Promise<ActivationResult> => ipcRenderer.invoke(RESET_LOCAL_CHANNEL),
  quit: (): Promise<ActivationResult> => ipcRenderer.invoke(QUIT_CHANNEL),
  onStateChanged: (callback: (state: unknown) => void): (() => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state)
    ipcRenderer.on(STATE_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(STATE_CHANGED_CHANNEL, listener)
  },
}))

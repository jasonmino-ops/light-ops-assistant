type ActivationState = {
  kind: string
  storeCodeHint?: string
  errorCode?: string
  retryAfterSeconds?: number
  isBusy: boolean
  canActivate: boolean
  canRetryVerify: boolean
  canResetLocal: boolean
  canQuit: boolean
}

type ActivationApi = {
  getState(): Promise<{ ok: boolean; error?: string; state?: ActivationState }>
  activate(input: { storeCode: string; pin: string }): Promise<{ ok: boolean; error?: string; state?: ActivationState }>
  retryVerification(): Promise<{ ok: boolean; error?: string; state?: ActivationState }>
  resetLocalActivation(): Promise<{ ok: boolean; error?: string; state?: ActivationState }>
  quit(): Promise<{ ok: boolean; error?: string; state?: ActivationState }>
  onStateChanged(callback: (state: ActivationState) => void): () => void
  reportStartupCheckpoint(input: { stage: StartupCheckpointStage; stateKind?: string; reasonCode?: string }): Promise<{ ok: boolean; error?: string }>
}

type StartupCheckpointStage =
  | 'script-started'
  | 'bridge-detected'
  | 'subscribed'
  | 'get-state-started'
  | 'get-state-succeeded'
  | 'get-state-failed'
  | 'rendered'
  | 'startup-error'

declare global {
  interface Window {
    eshopDesktopActivation: ActivationApi
  }
}

const titleByState: Record<string, string> = {
  BOOTING: '正在启动',
  UNACTIVATED: '激活此收银台',
  ACTIVATING: '正在激活',
  VERIFYING: '正在验证设备',
  AUTHORIZED_STARTING: '正在打开收银台',
  AUTHORIZED_RUNNING: '已激活',
  STARTUP_ERROR: '启动失败',
  NETWORK_ERROR: '网络暂时不可用',
  INVALID_PIN: 'PIN 不正确',
  PIN_LOCKED: 'PIN 已锁定',
  PIN_EXPIRED: 'PIN 已过期',
  PIN_ALREADY_USED: 'PIN 已使用',
  STORE_NOT_FOUND: '未找到门店',
  TENANT_INACTIVE: '商户不可用',
  STORE_INACTIVE: '门店不可用',
  SUBSCRIPTION_BLOCKED: '订阅状态不可用',
  INSTALLATION_BOUND_TO_OTHER_STORE: '此电脑已绑定其他门店',
  SAFE_STORAGE_UNAVAILABLE: '本机安全存储不可用',
  CREDENTIAL_CORRUPTED: '本机激活凭据异常',
  DEVICE_REVOKED: '设备已被撤销',
  TOKEN_EXPIRED: '设备凭据已过期',
  REACTIVATION_REQUIRED: '需要重新激活',
  SERVER_ERROR: '服务暂时不可用',
  QUITTING: '正在退出',
}

const detailByState: Record<string, string> = {
  UNACTIVATED: '请输入门店码和老板提供的 6 位 PIN。',
  NETWORK_ERROR: '请检查网络后重试验证。此状态不会离线放行收银台。',
  INVALID_PIN: '请重新输入 6 位 PIN。',
  PIN_LOCKED: 'PIN 连续错误次数过多，请稍后或联系 OWNER。',
  PIN_EXPIRED: '请在管理端重新生成 PIN。',
  PIN_ALREADY_USED: '请在管理端重新生成 PIN。',
  STORE_NOT_FOUND: '请检查门店码是否正确。',
  TENANT_INACTIVE: '请联系 OWNER 处理商户状态。',
  STORE_INACTIVE: '请联系 OWNER 处理门店状态。',
  SUBSCRIPTION_BLOCKED: '请联系 OWNER 处理订阅状态；重新激活不能解决订阅阻塞。',
  INSTALLATION_BOUND_TO_OTHER_STORE: '请联系 OWNER；本机不会自动覆盖或解绑其他门店。',
  SAFE_STORAGE_UNAVAILABLE: '此电脑无法使用系统安全存储，不能保存设备凭据。',
  CREDENTIAL_CORRUPTED: '本机激活文件无法读取，可清除本机激活后重新输入 PIN。',
  DEVICE_REVOKED: '此设备已被 OWNER 撤销，请重新输入新的 PIN 激活。',
  TOKEN_EXPIRED: '此设备凭据已过期，请重新输入新的 PIN 激活。',
  REACTIVATION_REQUIRED: '请重新输入门店码和新的 6 位 PIN。',
  SERVER_ERROR: '请稍后重试；如果持续失败，请联系 OWNER。',
  STARTUP_ERROR: '激活界面未能正确加载。请重新启动应用；如问题持续，请联系技术支持。',
}

const form = document.querySelector<HTMLFormElement>('#activation-form')
const storeCodeInput = document.querySelector<HTMLInputElement>('#store-code')
const pinInput = document.querySelector<HTMLInputElement>('#pin')
const title = document.querySelector<HTMLElement>('#state-title')
const detail = document.querySelector<HTMLElement>('#state-detail')
const statusCode = document.querySelector<HTMLElement>('#status-code')
const activateButton = document.querySelector<HTMLButtonElement>('#activate-button')
const retryButton = document.querySelector<HTMLButtonElement>('#retry-button')
const resetButton = document.querySelector<HTMLButtonElement>('#reset-button')
const quitButton = document.querySelector<HTMLButtonElement>('#quit-button')
const busy = document.querySelector<HTMLElement>('#busy')

let currentState: ActivationState | null = null
let firstRenderCompleted = false
let startupWatchdog: ReturnType<typeof setTimeout> | null = null

function safeReasonCode(value: string): string {
  if (/token|authorization|bearer|pin|cipher[-_\s]?text|\b\d{6}\b|\bSTORE[-_][A-Z0-9_-]+\b/i.test(value)) return 'ACTIVATION_RENDERER_STARTUP_ERROR'
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized.slice(0, 72) || 'ACTIVATION_RENDERER_STARTUP_ERROR'
}

function must<T>(value: T | null): T {
  if (!value) throw new Error('activation renderer missing element')
  return value
}

function optional<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

function isActivationState(value: unknown): value is ActivationState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.kind === 'string' &&
    typeof record.isBusy === 'boolean' &&
    typeof record.canActivate === 'boolean' &&
    typeof record.canRetryVerify === 'boolean' &&
    typeof record.canResetLocal === 'boolean' &&
    typeof record.canQuit === 'boolean'
  )
}

function getActivationBridge(): ActivationApi | null {
  try {
    const bridge = window.eshopDesktopActivation
    if (!bridge || typeof bridge.getState !== 'function' || typeof bridge.onStateChanged !== 'function') return null
    if (typeof bridge.reportStartupCheckpoint !== 'function') return null
    return bridge
  } catch {
    return null
  }
}

function report(api: ActivationApi | null, stage: StartupCheckpointStage, extra: { stateKind?: string; reasonCode?: string } = {}) {
  if (!api) return
  void api.reportStartupCheckpoint({ stage, ...extra }).catch(() => undefined)
}

function showStartupFailure(reasonCode: string, options: { bridgeMissing?: boolean } = {}) {
  clearStartupWatchdog()
  const safeCode = safeReasonCode(reasonCode)
  currentState = {
    kind: 'STARTUP_ERROR',
    isBusy: false,
    canActivate: false,
    canRetryVerify: false,
    canResetLocal: false,
    canQuit: false,
    errorCode: safeCode,
  }
  const titleText = options.bridgeMissing ? '启动组件加载失败' : titleByState.STARTUP_ERROR
  const detailText = options.bridgeMissing
    ? '请重新启动应用；若问题持续，请联系技术支持并提供日志。'
    : detailByState.STARTUP_ERROR
  const titleNode = optional<HTMLElement>('#state-title')
  const detailNode = optional<HTMLElement>('#state-detail')
  const statusNode = optional<HTMLElement>('#status-code')
  const busyNode = optional<HTMLElement>('#busy')
  const formNode = optional<HTMLFormElement>('#activation-form')
  const retryNode = optional<HTMLButtonElement>('#retry-button')
  const resetNode = optional<HTMLButtonElement>('#reset-button')
  const quitNode = optional<HTMLButtonElement>('#quit-button')
  if (titleNode) titleNode.textContent = titleText
  if (detailNode) detailNode.textContent = detailText
  if (statusNode) statusNode.textContent = `状态: ${safeCode}`
  if (busyNode) busyNode.hidden = true
  if (formNode) formNode.hidden = true
  if (resetNode) resetNode.hidden = true
  if (quitNode) quitNode.hidden = true
  if (retryNode) {
    retryNode.hidden = false
    retryNode.textContent = '重新加载'
    retryNode.onclick = () => window.location.reload()
  }
}

function clearStartupWatchdog() {
  if (startupWatchdog) clearTimeout(startupWatchdog)
  startupWatchdog = null
}

function startStartupWatchdog(api: ActivationApi) {
  clearStartupWatchdog()
  startupWatchdog = setTimeout(() => {
    if (firstRenderCompleted) return
    showStartupFailure('ACTIVATION_RENDERER_WATCHDOG_TIMEOUT')
    report(api, 'startup-error', { reasonCode: 'ACTIVATION_RENDERER_WATCHDOG_TIMEOUT' })
  }, 8_000)
}

function applyState(state: ActivationState) {
  if (!isActivationState(state)) throw new Error('invalid activation state payload')
  currentState = state
  const stateTitle = titleByState[state.kind] ?? titleByState.SERVER_ERROR
  must(title).textContent = stateTitle
  const retryAfter = state.retryAfterSeconds ? ` 请约 ${state.retryAfterSeconds} 秒后重试。` : ''
  must(detail).textContent = `${detailByState[state.kind] ?? ''}${retryAfter}`
  must(statusCode).textContent = state.errorCode ? `状态: ${state.errorCode}` : ''
  must(busy).hidden = !state.isBusy

  const showForm = state.canActivate || state.kind === 'UNACTIVATED'
  must(form).hidden = !showForm
  must(storeCodeInput).disabled = state.isBusy || !showForm
  must(pinInput).disabled = state.isBusy || !showForm
  must(activateButton).disabled = state.isBusy || !showForm
  must(retryButton).hidden = !state.canRetryVerify
  must(resetButton).hidden = !state.canResetLocal
  must(quitButton).hidden = !state.canQuit

  if (state.storeCodeHint && !must(storeCodeInput).value) {
    must(storeCodeInput).value = state.storeCodeHint
  }
  if (state.kind !== 'BOOTING') {
    firstRenderCompleted = true
    clearStartupWatchdog()
  }
}

async function invokeAndApply(action: () => Promise<{ ok: boolean; error?: string; state?: ActivationState }>) {
  const result = await action()
  if (result.state) applyState(result.state)
  if (!result.ok && result.error) {
    must(statusCode).textContent = `状态: ${result.error}`
  }
}

async function loadInitialState(api: ActivationApi) {
  report(api, 'get-state-started')
  try {
    const result = await api.getState()
    report(api, 'get-state-succeeded', { stateKind: result.state?.kind })
    if (!result.ok) {
      showStartupFailure('ACTIVATION_GET_STATE_FAILED')
      report(api, 'get-state-failed', { reasonCode: 'ACTIVATION_GET_STATE_FAILED' })
      report(api, 'startup-error', { reasonCode: 'ACTIVATION_GET_STATE_FAILED' })
      return
    }
    if (result.state) {
      applyState(result.state)
      report(api, 'rendered', { stateKind: result.state.kind })
    }
  } catch {
    showStartupFailure('ACTIVATION_GET_STATE_FAILED')
    report(api, 'get-state-failed', { reasonCode: 'ACTIVATION_GET_STATE_FAILED' })
    report(api, 'startup-error', { reasonCode: 'ACTIVATION_GET_STATE_FAILED' })
  }
}

function initializeActivationRenderer() {
  const api = getActivationBridge()
  if (!api) {
    console.error('activation renderer bridge missing')
    showStartupFailure('ACTIVATION_BRIDGE_MISSING', { bridgeMissing: true })
    return
  }
  report(api, 'script-started')
  report(api, 'bridge-detected')
  startStartupWatchdog(api)

  try {
    must(form).addEventListener('submit', (event) => {
      event.preventDefault()
      const storeCode = must(storeCodeInput).value
      const pin = must(pinInput).value
      void invokeAndApply(() => api.activate({ storeCode, pin }))
    })

    must(retryButton).addEventListener('click', () => {
      void invokeAndApply(() => api.retryVerification())
    })

    must(resetButton).addEventListener('click', () => {
      const confirmed = window.confirm('清除本机激活后需要重新输入新的 PIN。确认清除？')
      if (confirmed) void invokeAndApply(() => api.resetLocalActivation())
    })

    must(quitButton).addEventListener('click', () => {
      void api.quit()
    })

    api.onStateChanged((state) => {
      try {
        applyState(state)
        report(api, 'rendered', { stateKind: state.kind })
      } catch {
        showStartupFailure('ACTIVATION_RENDER_FAILED')
        report(api, 'startup-error', { reasonCode: 'ACTIVATION_RENDER_FAILED' })
      }
    })
    report(api, 'subscribed')
  } catch {
    showStartupFailure('ACTIVATION_RENDERER_INIT_FAILED')
    report(api, 'startup-error', { reasonCode: 'ACTIVATION_RENDERER_INIT_FAILED' })
    return
  }

  void loadInitialState(api)

  window.addEventListener('DOMContentLoaded', () => {
    try {
      if (currentState?.storeCodeHint) must(pinInput).focus()
      else must(storeCodeInput).focus()
    } catch {
      // Focus is cosmetic; startup state has already been rendered or will fail visibly.
    }
  })
}

window.addEventListener('error', () => {
  if (firstRenderCompleted) return
  const api = getActivationBridge()
  showStartupFailure('ACTIVATION_RENDERER_UNCAUGHT_ERROR')
  report(api, 'startup-error', { reasonCode: 'ACTIVATION_RENDERER_UNCAUGHT_ERROR' })
})

window.addEventListener('unhandledrejection', () => {
  if (firstRenderCompleted) return
  const api = getActivationBridge()
  showStartupFailure('ACTIVATION_RENDERER_UNHANDLED_REJECTION')
  report(api, 'startup-error', { reasonCode: 'ACTIVATION_RENDERER_UNHANDLED_REJECTION' })
})

try {
  initializeActivationRenderer()
} catch {
  const api = getActivationBridge()
  showStartupFailure('ACTIVATION_RENDERER_TOP_LEVEL_ERROR')
  report(api, 'startup-error', { reasonCode: 'ACTIVATION_RENDERER_TOP_LEVEL_ERROR' })
}

export {}

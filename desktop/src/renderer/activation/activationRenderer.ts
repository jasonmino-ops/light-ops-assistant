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
}

declare global {
  interface Window {
    eshopDesktopActivation: ActivationApi
  }
}

const titleByState: Record<string, string> = {
  BOOTING: '正在启动',
  UNACTIVATED: '激活此门店运行环境',
  ACTIVATING: '正在激活',
  VERIFYING: '正在验证设备',
  AUTHORIZED_STARTING: '正在启动门店运行环境',
  AUTHORIZED_RUNNING: '已激活',
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
  NETWORK_ERROR: '请检查网络后重试验证。此状态不会离线放行门店运行环境。',
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

function must<T>(value: T | null): T {
  if (!value) throw new Error('activation renderer missing element')
  return value
}

function applyState(state: ActivationState) {
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
}

async function invokeAndApply(action: () => Promise<{ ok: boolean; error?: string; state?: ActivationState }>) {
  const result = await action()
  if (result.state) applyState(result.state)
  if (!result.ok && result.error) {
    must(statusCode).textContent = `状态: ${result.error}`
  }
}

must(form).addEventListener('submit', (event) => {
  event.preventDefault()
  const storeCode = must(storeCodeInput).value
  const pin = must(pinInput).value
  void invokeAndApply(() => window.eshopDesktopActivation.activate({ storeCode, pin }))
})

must(retryButton).addEventListener('click', () => {
  void invokeAndApply(() => window.eshopDesktopActivation.retryVerification())
})

must(resetButton).addEventListener('click', () => {
  const confirmed = window.confirm('清除本机激活后需要重新输入新的 PIN。确认清除？')
  if (confirmed) void invokeAndApply(() => window.eshopDesktopActivation.resetLocalActivation())
})

must(quitButton).addEventListener('click', () => {
  void window.eshopDesktopActivation.quit()
})

window.eshopDesktopActivation.onStateChanged((state) => applyState(state))
void invokeAndApply(() => window.eshopDesktopActivation.getState())

window.addEventListener('DOMContentLoaded', () => {
  if (currentState?.storeCodeHint) must(pinInput).focus()
  else must(storeCodeInput).focus()
})

export {}

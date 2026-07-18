type DeploymentApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

type DeploymentHealth = {
  level: string
  activation: { state: string; level: string; message?: string }
  cloud: { state: string; level: string; message?: string }
  provider: { state: string; level: string; message?: string }
  displays: { state: string; level: string; message?: string }
  logs: { state: string; level: string; message?: string }
  retry: {
    state: string
    attempt: number
    maxAttempts: number
    cooldownUntil: string | null
    lastFailureCode: string | null
  }
  printerRuntime: string
  printerNativeAvailability: string
  scannerRuntime: string
  scannerNativeAvailability: string
  lastFailure: {
    code: string
    title: string
    explanation: string
    recommendedAction: string
    occurredAt: string
  } | null
  lastSuccessfulCloudLoadAt: string | null
}

type DeploymentSystemInfo = {
  version: string
  distributionClass: string
  shortInstallationId: string
  maskedStoreCode: string
  activationState: string
  cloudState: string
  providerState: string
  displayState: string
  logsState: string
  lastError: {
    code: string
    component: string
    occurredAt: string
    safeMessage: string
  } | null
  lastFailureCode: string | null
  lastSuccessfulCloudLoadAt: string | null
  windowsVersion: string
  arch: string
  locale: string
  uptimeSeconds: number
  runtimeHealth: DeploymentHealth
}

type DeploymentApi = {
  getHealth(): Promise<DeploymentApiResult<DeploymentHealth>>
  getSystemInfo(): Promise<DeploymentApiResult<DeploymentSystemInfo>>
  retryCloud(): Promise<DeploymentApiResult<unknown>>
  reloadBusiness(): Promise<DeploymentApiResult<unknown>>
  recheckProvider(): Promise<DeploymentApiResult<unknown>>
  recheckDisplays(): Promise<DeploymentApiResult<unknown>>
  openLogs(): Promise<DeploymentApiResult<unknown>>
  exportDiagnostics(): Promise<DeploymentApiResult<{ fileName: string }>>
  quit(): Promise<DeploymentApiResult<unknown>>
  returnToActivation(): Promise<DeploymentApiResult<unknown>>
}

declare global {
  interface Window {
    eshopDesktopDeployment: DeploymentApi
  }
}

const $ = <T extends HTMLElement>(selector: string): T => {
  const node = document.querySelector<T>(selector)
  if (!node) throw new Error(`missing element: ${selector}`)
  return node
}

const fields = {
  title: $('#failure-title'),
  detail: $('#failure-detail'),
  version: $('#version'),
  distribution: $('#distribution'),
  storeCode: $('#store-code'),
  installationId: $('#installation-id'),
  activationState: $('#activation-state'),
  cloudState: $('#cloud-state'),
  providerState: $('#provider-state'),
  displayState: $('#display-state'),
  printerState: $('#printer-state'),
  scannerState: $('#scanner-state'),
  retryState: $('#retry-state'),
  lastFailure: $('#last-failure'),
  statusLine: $('#status-line'),
  systemPanel: $('#system-panel'),
  systemSummary: $('#system-summary'),
}

let latestSystemInfo: DeploymentSystemInfo | null = null

function setStatus(value: string) {
  fields.statusLine.textContent = value
}

function formatRetry(health: DeploymentHealth) {
  const retry = health.retry
  const cooldown = retry.cooldownUntil ? `, cooldown ${new Date(retry.cooldownUntil).toLocaleTimeString()}` : ''
  return `${retry.state}, attempt ${retry.attempt}/${retry.maxAttempts}${cooldown}`
}

function summary(info: DeploymentSystemInfo): string {
  return [
    `Version: ${info.version}`,
    `Distribution: ${info.distributionClass}`,
    `Store: ${info.maskedStoreCode}`,
    `Installation: ${info.shortInstallationId}`,
    `Activation: ${info.activationState}`,
    `Cloud: ${info.cloudState}`,
    `Provider: ${info.providerState}`,
    `Displays: ${info.displayState}`,
    `Logs: ${info.logsState}`,
    `Last Failure: ${info.lastFailureCode ?? 'none'}`,
    `Last Cloud Success: ${info.lastSuccessfulCloudLoadAt ?? 'none'}`,
    `Windows: ${info.windowsVersion}`,
    `Arch: ${info.arch}`,
    `Locale: ${info.locale}`,
    `Uptime Seconds: ${info.uptimeSeconds}`,
    `Printer Runtime: BROWSER_PRINT / NATIVE_NOT_AVAILABLE`,
    `Scanner Runtime: KEYBOARD_MODE / NATIVE_NOT_AVAILABLE`,
  ].join('\n')
}

function applyHealth(health: DeploymentHealth) {
  const failure = health.lastFailure
  fields.title.textContent = failure?.title ?? '收银台页面暂时打不开'
  fields.detail.textContent = failure
    ? `${failure.explanation} ${failure.recommendedAction}`
    : '请重试打开云端收银页；如果持续失败，请导出诊断包。'
  fields.activationState.textContent = `${health.activation.level}: ${health.activation.state}`
  fields.cloudState.textContent = `${health.cloud.level}: ${health.cloud.state}`
  fields.providerState.textContent = `${health.provider.level}: ${health.provider.state}`
  fields.displayState.textContent = `${health.displays.level}: ${health.displays.state}`
  fields.printerState.textContent = `${health.printerRuntime} / ${health.printerNativeAvailability}`
  fields.scannerState.textContent = `${health.scannerRuntime} / ${health.scannerNativeAvailability}`
  fields.retryState.textContent = formatRetry(health)
  fields.lastFailure.textContent = failure ? `${failure.code} at ${new Date(failure.occurredAt).toLocaleString()}` : 'none'
}

function applySystemInfo(info: DeploymentSystemInfo) {
  latestSystemInfo = info
  fields.version.textContent = info.version
  fields.distribution.textContent = info.distributionClass
  fields.storeCode.textContent = info.maskedStoreCode
  fields.installationId.textContent = info.shortInstallationId
  fields.systemSummary.textContent = summary(info)
  applyHealth(info.runtimeHealth)
}

async function refresh() {
  const [healthResult, systemResult] = await Promise.all([
    window.eshopDesktopDeployment.getHealth(),
    window.eshopDesktopDeployment.getSystemInfo(),
  ])
  if (healthResult.ok) applyHealth(healthResult.data)
  if (systemResult.ok) applySystemInfo(systemResult.data)
  if (!healthResult.ok || !systemResult.ok) setStatus('本地诊断信息读取失败。')
}

async function runAction(label: string, action: () => Promise<DeploymentApiResult<unknown>>) {
  setStatus(`${label}...`)
  const result = await action()
  if (result.ok) {
    setStatus(`${label}已提交。`)
    await refresh()
  } else {
    setStatus(`${label}失败: ${result.error}`)
  }
}

$('#retry-button').addEventListener('click', () => {
  void runAction('重试', () => window.eshopDesktopDeployment.retryCloud())
})

$('#reload-button').addEventListener('click', () => {
  void runAction('重新加载', () => window.eshopDesktopDeployment.reloadBusiness())
})

$('#system-info-button').addEventListener('click', () => {
  fields.systemPanel.hidden = !fields.systemPanel.hidden
})

$('#logs-button').addEventListener('click', () => {
  void runAction('打开日志', () => window.eshopDesktopDeployment.openLogs())
})

$('#diagnostics-button').addEventListener('click', async () => {
  setStatus('正在导出诊断包...')
  const result = await window.eshopDesktopDeployment.exportDiagnostics()
  if (result.ok) setStatus(`诊断包已导出: ${result.data.fileName}`)
  else setStatus(`诊断包导出失败: ${result.error}`)
  await refresh()
})

$('#activation-button').addEventListener('click', () => {
  void runAction('返回激活', () => window.eshopDesktopDeployment.returnToActivation())
})

$('#quit-button').addEventListener('click', () => {
  void window.eshopDesktopDeployment.quit()
})

$('#copy-summary-button').addEventListener('click', async () => {
  if (!latestSystemInfo) return
  await navigator.clipboard.writeText(summary(latestSystemInfo))
  setStatus('系统信息摘要已复制。')
})

window.addEventListener('focus', () => {
  void refresh()
})

void refresh()

export {}

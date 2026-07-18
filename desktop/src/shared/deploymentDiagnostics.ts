export type DeploymentFailureComponent =
  | 'ACTIVATION'
  | 'BUSINESS_CLOUD'
  | 'PROVIDER'
  | 'DISPLAY'
  | 'DIAGNOSTICS'
  | 'SYSTEM'

export type DeploymentFailureSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'

export type DeploymentHealthLevel = 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN'

export type DeploymentHealthImpact = 'NONE' | 'DEGRADED' | 'FAILED'

export type DeploymentFailureCode =
  | 'ACTIVATION_NETWORK_ERROR'
  | 'ACTIVATION_INVALID_PIN'
  | 'ACTIVATION_PIN_LOCKED'
  | 'ACTIVATION_PIN_EXPIRED'
  | 'ACTIVATION_DEVICE_REVOKED'
  | 'ACTIVATION_TOKEN_EXPIRED'
  | 'ACTIVATION_SAFE_STORAGE_UNAVAILABLE'
  | 'ACTIVATION_CREDENTIAL_CORRUPTED'
  | 'ACTIVATION_SUBSCRIPTION_BLOCKED'
  | 'ACTIVATION_SERVER_ERROR'
  | 'BUSINESS_CLOUD_DNS_FAILURE'
  | 'BUSINESS_CLOUD_TLS_FAILURE'
  | 'BUSINESS_CLOUD_HTTP_ERROR'
  | 'BUSINESS_CLOUD_TIMEOUT'
  | 'BUSINESS_CLOUD_UNAUTHORIZED'
  | 'BUSINESS_CLOUD_RENDERER_CRASHED'
  | 'BUSINESS_CLOUD_UNKNOWN'
  | 'PROVIDER_ENTRY_MISSING'
  | 'PROVIDER_CONNECT_FAILED'
  | 'PROVIDER_INCOMPATIBLE'
  | 'PROVIDER_PIPE_CLOSED'
  | 'PROVIDER_EXITED'
  | 'DISPLAY_EMPLOYEE_UNAVAILABLE'
  | 'DISPLAY_CUSTOMER_UNAVAILABLE'
  | 'DISPLAY_CUSTOMER_LOAD_FAILED'
  | 'DISPLAY_TOPOLOGY_CHANGED'
  | 'DIAGNOSTICS_EXPORT_REDACTION_FAILED'
  | 'DIAGNOSTICS_EXPORT_WRITE_FAILED'
  | 'DIAGNOSTICS_EXPORT_TIMEOUT'
  | 'DIAGNOSTICS_EXPORT_SIZE_LIMIT'
  | 'SYSTEM_SAFE_STORAGE_UNAVAILABLE'
  | 'UNKNOWN_FAILURE'

export type DeploymentFailureDescriptor = {
  code: DeploymentFailureCode
  component: DeploymentFailureComponent
  severity: DeploymentFailureSeverity
  title: string
  explanation: string
  recommendedAction: string
  retryable: boolean
  supportRequired: boolean
  healthImpact: DeploymentHealthImpact
  logEvent: string
  metadataAllowlist: readonly string[]
}

export type DeploymentFailure = {
  code: DeploymentFailureCode
  component: DeploymentFailureComponent
  severity: DeploymentFailureSeverity
  title: string
  explanation: string
  recommendedAction: string
  retryable: boolean
  supportRequired: boolean
  healthImpact: DeploymentHealthImpact
  logEvent: string
  occurredAt: string
  correlationId: string
  metadata: Record<string, DeploymentMetadataValue>
}

export type DeploymentMetadataValue = string | number | boolean | null

export type RetryAction = 'NONE' | 'WAIT' | 'RETRY' | 'BLOCK'

export type RetryStateName =
  | 'IDLE'
  | 'FAILED'
  | 'WAITING_COOLDOWN'
  | 'RETRYING'
  | 'RECOVERED'
  | 'PERMANENT_BLOCKED'

export type RetryState = {
  state: RetryStateName
  attempt: number
  maxAttempts: number
  cooldownUntil: string | null
  lastAction: RetryAction
  lastFailureCode: DeploymentFailureCode | null
  inFlightCorrelationId: string | null
  updatedAt: string
}

export type DeploymentHealthComponent = {
  level: DeploymentHealthLevel
  state: string
  message?: string
  lastFailureCode?: DeploymentFailureCode
  updatedAt: string
}

export type DeploymentHealthSnapshot = {
  level: DeploymentHealthLevel
  application: DeploymentHealthComponent
  activation: DeploymentHealthComponent
  cloud: DeploymentHealthComponent
  provider: DeploymentHealthComponent
  displays: DeploymentHealthComponent
  logs: DeploymentHealthComponent
  system: DeploymentHealthComponent
  retry: RetryState
  printerRuntime: 'BROWSER_PRINT'
  printerNativeAvailability: 'NATIVE_NOT_AVAILABLE'
  scannerRuntime: 'KEYBOARD_MODE'
  scannerNativeAvailability: 'NATIVE_NOT_AVAILABLE'
  lastFailure: DeploymentFailure | null
  lastSuccessfulCloudLoadAt: string | null
  updatedAt: string
}

export type DeploymentSystemInfo = {
  version: string
  distributionClass: 'UNSIGNED_INTERNAL' | 'SIGNED_PILOT' | 'UNKNOWN'
  shortInstallationId: string
  maskedStoreCode: string
  activationState: string
  cloudState: string
  providerState: string
  displayState: string
  logsState: string
  lastError: DeploymentSafeLastError | null
  lastFailureCode: DeploymentFailureCode | null
  lastSuccessfulCloudLoadAt: string | null
  windowsVersion: string
  arch: string
  locale: string
  uptimeSeconds: number
  runtimeHealth: DeploymentHealthSnapshot
}

export type DeploymentSafeLastError = {
  code: string
  component: string
  occurredAt: string
  safeMessage: string
}

export type DiagnosticsManifest = {
  schemaVersion: 1
  createdAt: string
  bundleName: string
  shortInstallationId: string
  maskedStoreCode: string
  appVersion: string
  distributionClass: DeploymentSystemInfo['distributionClass']
  files: { name: string; bytes: number; sha256: string }[]
  redaction: {
    policy: 'ALLOWLIST_THEN_SECRET_SCAN'
    finalSecretScan: 'PASS'
  }
}

export type DiagnosticsExportResult =
  | { ok: true; fileName: string; manifest: DiagnosticsManifest }
  | { ok: false; error: DeploymentFailureCode; message: string }

export type DeploymentFailureInput = {
  component: DeploymentFailureComponent
  electronErrorCode?: number
  description?: string
  statusCode?: number
  activationKind?: string
  providerError?: string
  diagnosticsError?: string
  displayReason?: string
  metadata?: Record<string, unknown>
  occurredAt?: string
  correlationId?: string
}

const DESCRIPTORS: Record<DeploymentFailureCode, DeploymentFailureDescriptor> = {
  ACTIVATION_NETWORK_ERROR: {
    code: 'ACTIVATION_NETWORK_ERROR',
    component: 'ACTIVATION',
    severity: 'ERROR',
    title: '激活验证暂时无法连接',
    explanation: '这台收银台还没有通过云端验证，正式收银入口不会被放行。',
    recommendedAction: '检查网络后在激活窗口重试验证。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.network-error',
    metadataAllowlist: ['activationState', 'retryAfterSeconds'],
  },
  ACTIVATION_INVALID_PIN: {
    code: 'ACTIVATION_INVALID_PIN',
    component: 'ACTIVATION',
    severity: 'WARNING',
    title: '激活 PIN 不正确',
    explanation: '当前 PIN 无法激活这台收银台。',
    recommendedAction: '请重新输入老板提供的 6 位 PIN。',
    retryable: false,
    supportRequired: false,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.invalid-pin',
    metadataAllowlist: ['activationState'],
  },
  ACTIVATION_PIN_LOCKED: {
    code: 'ACTIVATION_PIN_LOCKED',
    component: 'ACTIVATION',
    severity: 'WARNING',
    title: '激活 PIN 已锁定',
    explanation: 'PIN 连续错误次数过多，暂时不能继续尝试。',
    recommendedAction: '稍后重试或请 OWNER 重新生成 PIN。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.pin-locked',
    metadataAllowlist: ['activationState', 'retryAfterSeconds'],
  },
  ACTIVATION_PIN_EXPIRED: {
    code: 'ACTIVATION_PIN_EXPIRED',
    component: 'ACTIVATION',
    severity: 'WARNING',
    title: '激活 PIN 已过期',
    explanation: '此 PIN 已超过可用时间。',
    recommendedAction: '请在管理端重新生成 PIN 后再激活。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.pin-expired',
    metadataAllowlist: ['activationState'],
  },
  ACTIVATION_DEVICE_REVOKED: {
    code: 'ACTIVATION_DEVICE_REVOKED',
    component: 'ACTIVATION',
    severity: 'CRITICAL',
    title: '此设备已被撤销',
    explanation: '云端不再允许这台设备继续作为收银台使用。',
    recommendedAction: '请联系 OWNER 重新授权设备。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.device-revoked',
    metadataAllowlist: ['activationState'],
  },
  ACTIVATION_TOKEN_EXPIRED: {
    code: 'ACTIVATION_TOKEN_EXPIRED',
    component: 'ACTIVATION',
    severity: 'ERROR',
    title: '设备凭据已过期',
    explanation: '本机保存的设备凭据已失效。',
    recommendedAction: '请重新激活此收银台。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.token-expired',
    metadataAllowlist: ['activationState'],
  },
  ACTIVATION_SAFE_STORAGE_UNAVAILABLE: {
    code: 'ACTIVATION_SAFE_STORAGE_UNAVAILABLE',
    component: 'ACTIVATION',
    severity: 'CRITICAL',
    title: '系统安全存储不可用',
    explanation: '本机无法安全保存设备凭据，不能进入正式收银。',
    recommendedAction: '请检查 Windows 用户环境或联系技术支持。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.safe-storage-unavailable',
    metadataAllowlist: ['activationState', 'platform'],
  },
  ACTIVATION_CREDENTIAL_CORRUPTED: {
    code: 'ACTIVATION_CREDENTIAL_CORRUPTED',
    component: 'ACTIVATION',
    severity: 'ERROR',
    title: '本机激活凭据异常',
    explanation: '本机保存的激活文件无法被安全读取。',
    recommendedAction: '请在激活窗口按提示处理本机激活。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.credential-corrupted',
    metadataAllowlist: ['activationState', 'reason'],
  },
  ACTIVATION_SUBSCRIPTION_BLOCKED: {
    code: 'ACTIVATION_SUBSCRIPTION_BLOCKED',
    component: 'ACTIVATION',
    severity: 'ERROR',
    title: '订阅状态不可用',
    explanation: '云端订阅或门店状态阻止此收银台运行。',
    recommendedAction: '请联系 OWNER 处理订阅或门店状态。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.subscription-blocked',
    metadataAllowlist: ['activationState', 'subscriptionState'],
  },
  ACTIVATION_SERVER_ERROR: {
    code: 'ACTIVATION_SERVER_ERROR',
    component: 'ACTIVATION',
    severity: 'ERROR',
    title: '激活服务暂时不可用',
    explanation: '激活服务返回异常，正式收银入口不会被放行。',
    recommendedAction: '稍后重试验证；如果持续失败，请联系技术支持。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'FAILED',
    logEvent: 'deployment.activation.server-error',
    metadataAllowlist: ['activationState', 'statusCode'],
  },
  BUSINESS_CLOUD_DNS_FAILURE: {
    code: 'BUSINESS_CLOUD_DNS_FAILURE',
    component: 'BUSINESS_CLOUD',
    severity: 'ERROR',
    title: '收银台页面无法解析服务器',
    explanation: '电脑无法解析云端收银页面地址。',
    recommendedAction: '检查网络、DNS 或门店路由器后重试。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.cloud.dns-failure',
    metadataAllowlist: ['electronErrorCode', 'phase', 'attempt'],
  },
  BUSINESS_CLOUD_TLS_FAILURE: {
    code: 'BUSINESS_CLOUD_TLS_FAILURE',
    component: 'BUSINESS_CLOUD',
    severity: 'ERROR',
    title: '收银台页面安全连接失败',
    explanation: '云端页面的安全连接没有成功建立。',
    recommendedAction: '检查系统时间、网络代理或证书环境后重试。',
    retryable: true,
    supportRequired: true,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.cloud.tls-failure',
    metadataAllowlist: ['electronErrorCode', 'phase', 'attempt'],
  },
  BUSINESS_CLOUD_HTTP_ERROR: {
    code: 'BUSINESS_CLOUD_HTTP_ERROR',
    component: 'BUSINESS_CLOUD',
    severity: 'ERROR',
    title: '收银台服务返回异常',
    explanation: '云端收银页面返回了不可用状态。',
    recommendedAction: '稍后重试；如果持续失败，请导出诊断包。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.cloud.http-error',
    metadataAllowlist: ['statusCode', 'phase', 'attempt'],
  },
  BUSINESS_CLOUD_TIMEOUT: {
    code: 'BUSINESS_CLOUD_TIMEOUT',
    component: 'BUSINESS_CLOUD',
    severity: 'ERROR',
    title: '收银台页面加载超时',
    explanation: '云端页面在限定时间内没有完成加载。',
    recommendedAction: '检查网络后重试；如果持续失败，请导出诊断包。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.cloud.timeout',
    metadataAllowlist: ['electronErrorCode', 'phase', 'attempt'],
  },
  BUSINESS_CLOUD_UNAUTHORIZED: {
    code: 'BUSINESS_CLOUD_UNAUTHORIZED',
    component: 'BUSINESS_CLOUD',
    severity: 'CRITICAL',
    title: '收银台授权被拒绝',
    explanation: '云端拒绝了当前收银台访问。',
    recommendedAction: '请联系 OWNER 或技术支持检查设备授权。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.cloud.unauthorized',
    metadataAllowlist: ['statusCode', 'phase'],
  },
  BUSINESS_CLOUD_RENDERER_CRASHED: {
    code: 'BUSINESS_CLOUD_RENDERER_CRASHED',
    component: 'BUSINESS_CLOUD',
    severity: 'ERROR',
    title: '收银台页面进程异常退出',
    explanation: '员工收银页面渲染进程异常退出。',
    recommendedAction: '重试打开收银台；如果持续发生，请导出诊断包。',
    retryable: true,
    supportRequired: true,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.cloud.renderer-crashed',
    metadataAllowlist: ['reason', 'phase', 'attempt'],
  },
  BUSINESS_CLOUD_UNKNOWN: {
    code: 'BUSINESS_CLOUD_UNKNOWN',
    component: 'BUSINESS_CLOUD',
    severity: 'ERROR',
    title: '收银台页面暂时打不开',
    explanation: '员工收银页面没有成功加载，但没有暴露可安全展示的具体原因。',
    recommendedAction: '请重试；如果持续失败，请导出诊断包。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.cloud.unknown',
    metadataAllowlist: ['electronErrorCode', 'phase', 'attempt'],
  },
  PROVIDER_ENTRY_MISSING: {
    code: 'PROVIDER_ENTRY_MISSING',
    component: 'PROVIDER',
    severity: 'WARNING',
    title: '本机硬件服务未找到',
    explanation: '浏览器打印和键盘扫码仍可使用，原生硬件服务当前不可用。',
    recommendedAction: '确认安装包内硬件服务资源完整。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.provider.entry-missing',
    metadataAllowlist: ['providerState', 'pid'],
  },
  PROVIDER_CONNECT_FAILED: {
    code: 'PROVIDER_CONNECT_FAILED',
    component: 'PROVIDER',
    severity: 'WARNING',
    title: '本机硬件服务连接失败',
    explanation: '原生硬件服务管道暂时不可用。',
    recommendedAction: '可继续使用浏览器打印和键盘扫码；如需排障请导出诊断包。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.provider.connect-failed',
    metadataAllowlist: ['providerState', 'pid'],
  },
  PROVIDER_INCOMPATIBLE: {
    code: 'PROVIDER_INCOMPATIBLE',
    component: 'PROVIDER',
    severity: 'WARNING',
    title: '本机硬件服务版本不兼容',
    explanation: '硬件服务已启动，但协议版本不符合当前桌面端要求。',
    recommendedAction: '使用匹配版本的安装包重新安装。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.provider.incompatible',
    metadataAllowlist: ['providerState', 'providerId'],
  },
  PROVIDER_PIPE_CLOSED: {
    code: 'PROVIDER_PIPE_CLOSED',
    component: 'PROVIDER',
    severity: 'WARNING',
    title: '本机硬件服务连接已关闭',
    explanation: '原生硬件服务连接断开，桌面端不会在 B1 自动重启 Provider。',
    recommendedAction: '可继续使用浏览器打印和键盘扫码；必要时重启桌面端。',
    retryable: false,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.provider.pipe-closed',
    metadataAllowlist: ['providerState', 'pid'],
  },
  PROVIDER_EXITED: {
    code: 'PROVIDER_EXITED',
    component: 'PROVIDER',
    severity: 'WARNING',
    title: '本机硬件服务已退出',
    explanation: '原生硬件服务进程已退出，B1 不执行自动拉起或守护。',
    recommendedAction: '可继续使用浏览器打印和键盘扫码；必要时重启桌面端。',
    retryable: false,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.provider.exited',
    metadataAllowlist: ['providerState', 'pid', 'restartAttempts'],
  },
  DISPLAY_EMPLOYEE_UNAVAILABLE: {
    code: 'DISPLAY_EMPLOYEE_UNAVAILABLE',
    component: 'DISPLAY',
    severity: 'ERROR',
    title: '员工窗口不可用',
    explanation: '员工收银窗口没有处于可用状态。',
    recommendedAction: '请从托盘重新打开收银台或重启桌面端。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'FAILED',
    logEvent: 'deployment.display.employee-unavailable',
    metadataAllowlist: ['displayCount', 'primaryDisplayId'],
  },
  DISPLAY_CUSTOMER_UNAVAILABLE: {
    code: 'DISPLAY_CUSTOMER_UNAVAILABLE',
    component: 'DISPLAY',
    severity: 'WARNING',
    title: '顾客屏暂时不可用',
    explanation: '顾客显示不会影响员工收银，但需要检查副屏连接。',
    recommendedAction: '检查副屏连接后点击重新检查显示器。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.display.customer-unavailable',
    metadataAllowlist: ['displayCount', 'externalDisplayCount'],
  },
  DISPLAY_CUSTOMER_LOAD_FAILED: {
    code: 'DISPLAY_CUSTOMER_LOAD_FAILED',
    component: 'DISPLAY',
    severity: 'WARNING',
    title: '顾客屏页面加载失败',
    explanation: '顾客屏已切换到本地临时画面，员工收银不受影响。',
    recommendedAction: '等待自动恢复或检查网络后重试。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.display.customer-load-failed',
    metadataAllowlist: ['electronErrorCode', 'displayCount'],
  },
  DISPLAY_TOPOLOGY_CHANGED: {
    code: 'DISPLAY_TOPOLOGY_CHANGED',
    component: 'DISPLAY',
    severity: 'INFO',
    title: '显示器连接已变化',
    explanation: '系统检测到显示器插拔或分辨率变化。',
    recommendedAction: '确认员工屏和顾客屏位置正确。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.display.topology-changed',
    metadataAllowlist: ['displayCount', 'externalDisplayCount', 'primaryDisplayId'],
  },
  DIAGNOSTICS_EXPORT_REDACTION_FAILED: {
    code: 'DIAGNOSTICS_EXPORT_REDACTION_FAILED',
    component: 'DIAGNOSTICS',
    severity: 'CRITICAL',
    title: '诊断包安全检查未通过',
    explanation: '诊断数据包含未允许或疑似敏感内容，已停止导出。',
    recommendedAction: '请联系技术支持处理，不要手工发送日志原文。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.diagnostics.redaction-failed',
    metadataAllowlist: ['stage', 'fileName'],
  },
  DIAGNOSTICS_EXPORT_WRITE_FAILED: {
    code: 'DIAGNOSTICS_EXPORT_WRITE_FAILED',
    component: 'DIAGNOSTICS',
    severity: 'ERROR',
    title: '诊断包写入失败',
    explanation: '系统无法把诊断包保存到所选位置。',
    recommendedAction: '请选择可写入的位置后重试。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.diagnostics.write-failed',
    metadataAllowlist: ['stage'],
  },
  DIAGNOSTICS_EXPORT_TIMEOUT: {
    code: 'DIAGNOSTICS_EXPORT_TIMEOUT',
    component: 'DIAGNOSTICS',
    severity: 'ERROR',
    title: '诊断包导出超时',
    explanation: '诊断包未能在限定时间内完成。',
    recommendedAction: '稍后重试；如果持续失败，请联系技术支持。',
    retryable: true,
    supportRequired: false,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.diagnostics.timeout',
    metadataAllowlist: ['stage'],
  },
  DIAGNOSTICS_EXPORT_SIZE_LIMIT: {
    code: 'DIAGNOSTICS_EXPORT_SIZE_LIMIT',
    component: 'DIAGNOSTICS',
    severity: 'ERROR',
    title: '诊断包超过大小限制',
    explanation: '诊断包超过 20MB 限制，已停止导出。',
    recommendedAction: '请联系技术支持处理日志收集范围。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.diagnostics.size-limit',
    metadataAllowlist: ['stage', 'bytes'],
  },
  SYSTEM_SAFE_STORAGE_UNAVAILABLE: {
    code: 'SYSTEM_SAFE_STORAGE_UNAVAILABLE',
    component: 'SYSTEM',
    severity: 'CRITICAL',
    title: '系统安全存储不可用',
    explanation: 'Windows 安全存储不可用，设备凭据无法安全保存。',
    recommendedAction: '请检查 Windows 用户配置后重新启动。',
    retryable: false,
    supportRequired: true,
    healthImpact: 'FAILED',
    logEvent: 'deployment.system.safe-storage-unavailable',
    metadataAllowlist: ['platform'],
  },
  UNKNOWN_FAILURE: {
    code: 'UNKNOWN_FAILURE',
    component: 'SYSTEM',
    severity: 'ERROR',
    title: '桌面端发生未知异常',
    explanation: '桌面端捕获到一个没有安全分类的异常。',
    recommendedAction: '请导出诊断包并联系技术支持。',
    retryable: true,
    supportRequired: true,
    healthImpact: 'DEGRADED',
    logEvent: 'deployment.unknown',
    metadataAllowlist: ['component', 'phase'],
  },
}

const ACTIVATION_CODE_BY_STATE: Record<string, DeploymentFailureCode> = {
  NETWORK_ERROR: 'ACTIVATION_NETWORK_ERROR',
  INVALID_PIN: 'ACTIVATION_INVALID_PIN',
  PIN_LOCKED: 'ACTIVATION_PIN_LOCKED',
  PIN_EXPIRED: 'ACTIVATION_PIN_EXPIRED',
  PIN_ALREADY_USED: 'ACTIVATION_PIN_EXPIRED',
  DEVICE_REVOKED: 'ACTIVATION_DEVICE_REVOKED',
  TOKEN_EXPIRED: 'ACTIVATION_TOKEN_EXPIRED',
  REACTIVATION_REQUIRED: 'ACTIVATION_TOKEN_EXPIRED',
  SAFE_STORAGE_UNAVAILABLE: 'ACTIVATION_SAFE_STORAGE_UNAVAILABLE',
  CREDENTIAL_CORRUPTED: 'ACTIVATION_CREDENTIAL_CORRUPTED',
  SUBSCRIPTION_BLOCKED: 'ACTIVATION_SUBSCRIPTION_BLOCKED',
  TENANT_INACTIVE: 'ACTIVATION_SUBSCRIPTION_BLOCKED',
  STORE_INACTIVE: 'ACTIVATION_SUBSCRIPTION_BLOCKED',
  SERVER_ERROR: 'ACTIVATION_SERVER_ERROR',
}

const SECRET_PATTERN =
  /deviceToken|authorization|bearer|cookie|\bsession\b|activationPin|pinCode|"pin"\s*:|\bPIN[:=]\s*\d{4,8}\b|ciphertext|khqr|payment|receipt|phone|address|DATABASE_URL|DIRECT_URL|GITHUB_TOKEN|CSC_|APPLE_|TOKEN=|SECRET=|PASSWORD=/i

const RAW_URL_PATTERN = /https?:\/\/[^\s"'<>\\]+/gi
const QUERY_STRING_PATTERN = /[?&][A-Za-z0-9_.~-]+=[^"'<>\\\s]+/
const STACK_TRACE_PATTERN = /(^|\n|\r)\s*at\s+|(?:Error|TypeError|ReferenceError|SyntaxError):|[A-Za-z0-9_.-]+\.(?:js|ts):\d+:\d+/
const HOME_PATH_PATTERN = /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)/i
const WINDOWS_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:\\(?:Program Files|Users|Windows|Temp|[^\\\s"']+)\\/i
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
const PHONE_CONTEXT_PATTERN = /(?:phone|tel|telegram|customer).{0,40}\+?\d[\d\s().-]{7,}/i
const BUSINESS_DATA_MARKER_PATTERN = /address|order|payment|receipt|khqr/i
const ENV_DUMP_PATTERN = /process\.env|\b(?:DATABASE_URL|DIRECT_URL|PATH|HOME|USERPROFILE|APPDATA|TEMP)=/i
const GENERIC_STORE_CODE_PATTERN = /\bSTORE-[A-Z0-9_-]+\b/

export function getDeploymentFailureDescriptor(code: DeploymentFailureCode): DeploymentFailureDescriptor {
  return DESCRIPTORS[code]
}

export function listDeploymentFailureDescriptors(): DeploymentFailureDescriptor[] {
  return Object.values(DESCRIPTORS).map((descriptor) => ({
    ...descriptor,
    metadataAllowlist: [...descriptor.metadataAllowlist],
  }))
}

export function containsSecretPattern(value: unknown): boolean {
  return SECRET_PATTERN.test(JSON.stringify(value))
}

export type DiagnosticsContentScanContext = {
  fullStoreCode?: string | null
  fullInstallationId?: string | null
}

export function diagnosticsContentUnsafeReason(
  text: string,
  context: DiagnosticsContentScanContext = {},
): string | null {
  if (SECRET_PATTERN.test(text)) return 'SECRET_PATTERN'
  RAW_URL_PATTERN.lastIndex = 0
  if (RAW_URL_PATTERN.test(text)) {
    RAW_URL_PATTERN.lastIndex = 0
    return 'RAW_URL'
  }
  RAW_URL_PATTERN.lastIndex = 0
  if (QUERY_STRING_PATTERN.test(text)) return 'QUERY_STRING'
  if (STACK_TRACE_PATTERN.test(text)) return 'STACK_TRACE'
  if (HOME_PATH_PATTERN.test(text)) return 'HOME_PATH'
  if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(text)) return 'WINDOWS_PATH'
  if (EMAIL_PATTERN.test(text)) return 'EMAIL'
  if (PHONE_CONTEXT_PATTERN.test(text)) return 'PHONE_CONTEXT'
  if (BUSINESS_DATA_MARKER_PATTERN.test(text)) return 'BUSINESS_DATA_MARKER'
  if (ENV_DUMP_PATTERN.test(text)) return 'ENV_DUMP'
  if (GENERIC_STORE_CODE_PATTERN.test(text)) return 'STORE_CODE_PATTERN'
  if (context.fullStoreCode && text.includes(context.fullStoreCode)) return 'FULL_STORE_CODE'
  if (context.fullInstallationId && text.includes(context.fullInstallationId)) return 'FULL_INSTALLATION_ID'
  return null
}

export function hashDiagnosticIdentifier(value: string, prefix = 'id'): string {
  return `${prefix}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`
}

export function maskStoreCode(value?: string | null): string {
  if (!value) return '未设置'
  const trimmed = value.trim()
  if (trimmed.length <= 2) return '*'.repeat(trimmed.length)
  if (trimmed.length <= 6) return `${trimmed[0]}${'*'.repeat(trimmed.length - 2)}${trimmed[trimmed.length - 1]}`
  return `${trimmed.slice(0, 2)}${'*'.repeat(Math.max(2, trimmed.length - 4))}${trimmed.slice(-2)}`
}

export function shortenInstallationId(value?: string | null): string {
  if (!value) return 'unknown'
  return hashDiagnosticIdentifier(value, 'inst')
}

export type DiagnosticsUrlCategory = 'BUSINESS_PAGE' | 'CUSTOMER_PAGE' | 'ACTIVATION_API' | 'UNKNOWN'

export function categorizeDiagnosticsUrl(value?: string | null): DiagnosticsUrlCategory {
  if (!value) return 'UNKNOWN'
  try {
    const parsed = new URL(value)
    const path = parsed.pathname.toLowerCase()
    if (path.includes('/api/desktop') || path.includes('/activate') || path.includes('/activation')) return 'ACTIVATION_API'
    if (path.includes('/desktop/display')) return 'CUSTOMER_PAGE'
    if (path.includes('/desktop')) return 'BUSINESS_PAGE'
    return 'UNKNOWN'
  } catch {
    return 'UNKNOWN'
  }
}

export function originHostHash(value?: string | null): string | null {
  if (!value) return null
  try {
    return hashDiagnosticIdentifier(new URL(value).host.toLowerCase(), 'host')
  } catch {
    return null
  }
}

export function sanitizeDiagnosticMessage(
  value: unknown,
  context: DiagnosticsContentScanContext = {},
): string {
  if (value == null) return 'none'
  let text = value instanceof Error ? value.message : String(value)
  text = text.replace(RAW_URL_PATTERN, (url) => {
    const hostHash = originHostHash(url)
    return `[url:${categorizeDiagnosticsUrl(url)}${hostHash ? `:${hostHash}` : ''}]`
  })
  RAW_URL_PATTERN.lastIndex = 0
  text = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s+/.test(line) && !STACK_TRACE_PATTERN.test(line))
    .join(' ')
    .replace(HOME_PATH_PATTERN, '[path-redacted]')
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, '[path-redacted]')
  if (context.fullStoreCode) text = text.replaceAll(context.fullStoreCode, maskStoreCode(context.fullStoreCode))
  if (context.fullInstallationId) {
    text = text.replaceAll(context.fullInstallationId, shortenInstallationId(context.fullInstallationId))
  }
  text = text.replace(/\s+/g, ' ').trim()
  if (!text) return 'diagnostic message redacted'
  const reason = diagnosticsContentUnsafeReason(text, context)
  if (reason) return `diagnostic message redacted (${reason})`
  return text.length > 160 ? `${text.slice(0, 160)}...[truncated]` : text
}

function toSafeMetadataValue(value: unknown): DeploymentMetadataValue | undefined {
  if (value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string') {
    if (containsSecretPattern(value)) return undefined
    return value.length > 120 ? `${value.slice(0, 120)}...[truncated]` : value
  }
  return undefined
}

export function sanitizeDeploymentMetadata(
  code: DeploymentFailureCode,
  metadata: Record<string, unknown> = {},
): Record<string, DeploymentMetadataValue> {
  const descriptor = getDeploymentFailureDescriptor(code)
  const allowed = new Set(descriptor.metadataAllowlist)
  const out: Record<string, DeploymentMetadataValue> = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!allowed.has(key)) continue
    const safe = toSafeMetadataValue(value)
    if (safe !== undefined) out[key] = safe
  }
  return out
}

export function classifyDeploymentFailure(input: DeploymentFailureInput): DeploymentFailure {
  const code = resolveFailureCode(input)
  const descriptor = getDeploymentFailureDescriptor(code)
  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const correlationId = input.correlationId ?? `dep-${Date.now().toString(36)}`
  return {
    code,
    component: descriptor.component,
    severity: descriptor.severity,
    title: descriptor.title,
    explanation: descriptor.explanation,
    recommendedAction: descriptor.recommendedAction,
    retryable: descriptor.retryable,
    supportRequired: descriptor.supportRequired,
    healthImpact: descriptor.healthImpact,
    logEvent: descriptor.logEvent,
    occurredAt,
    correlationId,
    metadata: sanitizeDeploymentMetadata(code, {
      ...input.metadata,
      electronErrorCode: input.electronErrorCode,
      statusCode: input.statusCode,
      activationState: input.activationKind,
      providerState: input.providerError,
      displayReason: input.displayReason,
    }),
  }
}

function resolveFailureCode(input: DeploymentFailureInput): DeploymentFailureCode {
  if (input.component === 'ACTIVATION') {
    return (input.activationKind && ACTIVATION_CODE_BY_STATE[input.activationKind]) || 'ACTIVATION_SERVER_ERROR'
  }
  if (input.component === 'PROVIDER') {
    const value = `${input.providerError ?? ''}`.toUpperCase()
    if (value.includes('ENTRY_MISSING')) return 'PROVIDER_ENTRY_MISSING'
    if (value.includes('CONNECT_FAILED')) return 'PROVIDER_CONNECT_FAILED'
    if (value.includes('INCOMPATIBLE')) return 'PROVIDER_INCOMPATIBLE'
    if (value.includes('PIPE_CLOSED')) return 'PROVIDER_PIPE_CLOSED'
    if (value.includes('EXIT')) return 'PROVIDER_EXITED'
    return 'PROVIDER_CONNECT_FAILED'
  }
  if (input.component === 'DISPLAY') {
    const reason = `${input.displayReason ?? input.description ?? ''}`.toUpperCase()
    if (reason.includes('EMPLOYEE')) return 'DISPLAY_EMPLOYEE_UNAVAILABLE'
    if (reason.includes('LOAD')) return 'DISPLAY_CUSTOMER_LOAD_FAILED'
    if (reason.includes('TOPOLOGY') || reason.includes('DISPLAY')) return 'DISPLAY_TOPOLOGY_CHANGED'
    return 'DISPLAY_CUSTOMER_UNAVAILABLE'
  }
  if (input.component === 'DIAGNOSTICS') {
    const reason = `${input.diagnosticsError ?? input.description ?? ''}`.toUpperCase()
    if (reason.includes('REDACTION') || reason.includes('SECRET')) return 'DIAGNOSTICS_EXPORT_REDACTION_FAILED'
    if (reason.includes('TIMEOUT')) return 'DIAGNOSTICS_EXPORT_TIMEOUT'
    if (reason.includes('SIZE')) return 'DIAGNOSTICS_EXPORT_SIZE_LIMIT'
    return 'DIAGNOSTICS_EXPORT_WRITE_FAILED'
  }
  if (input.component === 'BUSINESS_CLOUD') {
    if (input.statusCode === 401 || input.statusCode === 403) return 'BUSINESS_CLOUD_UNAUTHORIZED'
    if (typeof input.statusCode === 'number' && input.statusCode >= 400) return 'BUSINESS_CLOUD_HTTP_ERROR'
    const description = `${input.description ?? ''}`.toUpperCase()
    if (description.includes('DNS') || description.includes('NAME_NOT_RESOLVED')) return 'BUSINESS_CLOUD_DNS_FAILURE'
    if (description.includes('CERT') || description.includes('SSL') || description.includes('TLS')) return 'BUSINESS_CLOUD_TLS_FAILURE'
    if (description.includes('TIMED_OUT') || description.includes('TIMEOUT')) return 'BUSINESS_CLOUD_TIMEOUT'
    if (input.electronErrorCode === -105 || input.electronErrorCode === -106) return 'BUSINESS_CLOUD_DNS_FAILURE'
    if (input.electronErrorCode === -2 || input.electronErrorCode === -7 || input.electronErrorCode === -118) return 'BUSINESS_CLOUD_TIMEOUT'
    if (input.electronErrorCode && input.electronErrorCode <= -200 && input.electronErrorCode >= -299) return 'BUSINESS_CLOUD_TLS_FAILURE'
    return 'BUSINESS_CLOUD_UNKNOWN'
  }
  return 'UNKNOWN_FAILURE'
}
import { createHash } from 'node:crypto'

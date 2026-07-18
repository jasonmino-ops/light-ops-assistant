/**
 * E-Shop Desktop — IPC 通道白名单（唯一事实来源）
 *
 * 任何 IPC 通道必须在此声明。Preload 是 sandboxed 自包含文件，
 * 无法 import 本模块；tests/static-security.test.ts 会静态校验
 * preload 源码中的通道字符串与本文件保持一致。
 */

export const IPC_CHANNELS = {
  /** Renderer(员工窗口) → Main：转发从 BroadcastChannel 捕获的购物车快照 */
  CART_PUBLISH: 'eshop:cart:publish',
  /** Renderer(顾客窗口) → Main：顾客显示页加载完成（触发最新快照重推） */
  DISPLAY_READY: 'eshop:display:ready',
  /** Renderer(员工窗口) → Main (invoke)：只读 Runtime Health 快照 */
  HEALTH_GET: 'eshop:runtime:health',
  /** Renderer(员工窗口) → Main (invoke)：进入员工窗口原生全屏 */
  EMPLOYEE_FULLSCREEN_ENTER: 'eshop:employee-fullscreen:enter',
  /** Renderer(员工窗口) → Main (invoke)：退出员工窗口原生全屏 */
  EMPLOYEE_FULLSCREEN_EXIT: 'eshop:employee-fullscreen:exit',
  /** Renderer(员工窗口) → Main (invoke)：读取员工窗口原生全屏状态 */
  EMPLOYEE_FULLSCREEN_STATE: 'eshop:employee-fullscreen:state',
  /** Renderer(员工本地部署故障页) → Main (invoke)：读取部署健康快照 */
  DEPLOYMENT_GET_HEALTH: 'eshop:deployment:get-health',
  /** Renderer(员工本地部署故障页) → Main (invoke)：读取支持可读系统信息 */
  DEPLOYMENT_GET_SYSTEM_INFO: 'eshop:deployment:get-system-info',
  /** Renderer(员工本地部署故障页) → Main (invoke)：重试云端收银页 */
  DEPLOYMENT_RETRY_CLOUD: 'eshop:deployment:retry-cloud',
  /** Renderer(员工本地部署故障页) → Main (invoke)：重新加载云端业务页 */
  DEPLOYMENT_RELOAD_BUSINESS: 'eshop:deployment:reload-business',
  /** Renderer(员工本地部署故障页) → Main (invoke)：重新读取 Provider 状态，不启动 Provider */
  DEPLOYMENT_RECHECK_PROVIDER: 'eshop:deployment:recheck-provider',
  /** Renderer(员工本地部署故障页) → Main (invoke)：重新读取显示器状态 */
  DEPLOYMENT_RECHECK_DISPLAYS: 'eshop:deployment:recheck-displays',
  /** Renderer(员工本地部署故障页) → Main (invoke)：打开日志目录 */
  DEPLOYMENT_OPEN_LOGS: 'eshop:deployment:open-logs',
  /** Renderer(员工本地部署故障页) → Main (invoke)：导出经过脱敏检查的诊断包 */
  DEPLOYMENT_EXPORT_DIAGNOSTICS: 'eshop:deployment:export-diagnostics',
  /** Renderer(员工本地部署故障页) → Main (invoke)：退出桌面端 */
  DEPLOYMENT_QUIT: 'eshop:deployment:quit',
  /** Renderer(员工本地部署故障页) → Main (invoke)：请求回到激活窗口，由 Main 决策 */
  DEPLOYMENT_RETURN_TO_ACTIVATION: 'eshop:deployment:return-to-activation',
  /** Main → Renderer(顾客窗口)：下发最新购物车快照 */
  CART_APPLY: 'eshop:cart:apply',
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export type WindowRole = 'employee' | 'customer'

/** 各窗口角色允许发送（send）的通道 */
export const SENDABLE_BY_ROLE: Record<WindowRole, readonly string[]> = {
  employee: [IPC_CHANNELS.CART_PUBLISH],
  customer: [IPC_CHANNELS.DISPLAY_READY],
}

/** 各窗口角色允许调用（invoke）的通道 */
export const INVOKABLE_BY_ROLE: Record<WindowRole, readonly string[]> = {
  employee: [
    IPC_CHANNELS.HEALTH_GET,
    IPC_CHANNELS.EMPLOYEE_FULLSCREEN_ENTER,
    IPC_CHANNELS.EMPLOYEE_FULLSCREEN_EXIT,
    IPC_CHANNELS.EMPLOYEE_FULLSCREEN_STATE,
    IPC_CHANNELS.DEPLOYMENT_GET_HEALTH,
    IPC_CHANNELS.DEPLOYMENT_GET_SYSTEM_INFO,
    IPC_CHANNELS.DEPLOYMENT_RETRY_CLOUD,
    IPC_CHANNELS.DEPLOYMENT_RELOAD_BUSINESS,
    IPC_CHANNELS.DEPLOYMENT_RECHECK_PROVIDER,
    IPC_CHANNELS.DEPLOYMENT_RECHECK_DISPLAYS,
    IPC_CHANNELS.DEPLOYMENT_OPEN_LOGS,
    IPC_CHANNELS.DEPLOYMENT_EXPORT_DIAGNOSTICS,
    IPC_CHANNELS.DEPLOYMENT_QUIT,
    IPC_CHANNELS.DEPLOYMENT_RETURN_TO_ACTIVATION,
  ],
  customer: [],
}

/** 各窗口角色允许接收（Main → Renderer）的通道 */
export const RECEIVABLE_BY_ROLE: Record<WindowRole, readonly string[]> = {
  employee: [],
  customer: [IPC_CHANNELS.CART_APPLY],
}

/**
 * 与现有 Web 层（lib/customer-display-realtime-channel.ts）约定的
 * BroadcastChannel 名称。Desktop 不修改 Web 层，仅旁路读取/回放。
 */
export const WEB_REALTIME_BROADCAST_CHANNEL = 'light-ops:customer-display:realtime:v1'

/**
 * Desktop 回放到顾客窗口 BroadcastChannel 的消息标记，
 * 员工窗口 preload 据此忽略回放消息，防止消息回环。
 */
export const DESKTOP_RELAY_FLAG = 'relayedByDesktop'

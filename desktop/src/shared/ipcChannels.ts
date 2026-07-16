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
  /** Renderer(员工窗口) → Main (invoke)：提交收银小票到本地打印 Runtime */
  PRINTER_PRINT_RECEIPT: 'desktop:printer:print-receipt',
  /** Renderer(员工窗口) → Main (invoke)：读取本地双屏分配状态 */
  DISPLAY_GET_STATE: 'desktop:display:get-state',
  /** Renderer(员工窗口) → Main (invoke)：设置 single / dual 显示模式 */
  DISPLAY_SET_MODE: 'desktop:display:set-mode',
  /** Renderer(员工窗口) → Main (invoke)：交换员工屏与顾客屏 */
  DISPLAY_SWAP: 'desktop:display:swap',
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
    IPC_CHANNELS.PRINTER_PRINT_RECEIPT,
    IPC_CHANNELS.DISPLAY_GET_STATE,
    IPC_CHANNELS.DISPLAY_SET_MODE,
    IPC_CHANNELS.DISPLAY_SWAP,
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

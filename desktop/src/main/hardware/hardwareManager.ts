/**
 * E-Shop Desktop — Hardware Runtime 基础框架（Milestone A：仅接口与注册结构）
 *
 * 架构基线：任何硬件不得散落在 POS 页面中直接调用；
 * 后续 Milestone B 的原生驱动（Xprinter / HID 扫码枪 / USB 客显 / 钱箱 / 电子秤）
 * 都必须实现 DeviceManager 接口并注册到 HardwareManager，不再改变整体架构。
 *
 * Milestone A 中所有设备均为占位实现，状态固定 UNAVAILABLE；
 * 现有浏览器路径（Xprinter 浏览器打印、扫码枪键盘输入、Web Serial 客显）不受影响。
 */

export type DeviceStatus =
  | 'UNAVAILABLE'   // 本 Milestone 未实现原生接入
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'READY'
  | 'DEGRADED'
  | 'ERROR'

export type DeviceKind = 'printer' | 'scanner' | 'customer-display' | 'cash-drawer' | 'scale'

export interface DeviceManager {
  readonly kind: DeviceKind
  readonly name: string
  getStatus(): DeviceStatus
  /** Milestone B+：建立设备连接 */
  connect(): Promise<void>
  /** Milestone B+：释放设备 */
  disconnect(): Promise<void>
}

abstract class PlaceholderDeviceManager implements DeviceManager {
  abstract readonly kind: DeviceKind
  abstract readonly name: string
  getStatus(): DeviceStatus {
    return 'UNAVAILABLE'
  }
  async connect(): Promise<void> {
    throw new Error(`${this.kind}: native driver not implemented in Milestone A`)
  }
  async disconnect(): Promise<void> {
    // 占位：无资源可释放
  }
}

export class PrinterManager extends PlaceholderDeviceManager {
  readonly kind = 'printer' as const
  readonly name = 'Xprinter 80mm USB (placeholder)'
}

export class ScannerManager extends PlaceholderDeviceManager {
  readonly kind = 'scanner' as const
  readonly name = 'USB HID Scanner (placeholder)'
}

export class CustomerDisplayManager extends PlaceholderDeviceManager {
  readonly kind = 'customer-display' as const
  readonly name = 'USB Digit Customer Display (placeholder)'
}

export class CashDrawerManager extends PlaceholderDeviceManager {
  readonly kind = 'cash-drawer' as const
  readonly name = 'Cash Drawer (placeholder)'
}

export class ScaleManager extends PlaceholderDeviceManager {
  readonly kind = 'scale' as const
  readonly name = 'Scale (placeholder)'
}

export class HardwareManager {
  private readonly devices = new Map<DeviceKind, DeviceManager>()

  register(device: DeviceManager) {
    if (this.devices.has(device.kind)) {
      throw new Error(`device kind already registered: ${device.kind}`)
    }
    this.devices.set(device.kind, device)
  }

  get(kind: DeviceKind): DeviceManager | undefined {
    return this.devices.get(kind)
  }

  list(): DeviceManager[] {
    return [...this.devices.values()]
  }

  getStatusSummary(): Record<string, DeviceStatus> {
    const out: Record<string, DeviceStatus> = {}
    for (const device of this.devices.values()) out[device.kind] = device.getStatus()
    return out
  }
}

export function createDefaultHardwareManager(): HardwareManager {
  const manager = new HardwareManager()
  manager.register(new PrinterManager())
  manager.register(new ScannerManager())
  manager.register(new CustomerDisplayManager())
  manager.register(new CashDrawerManager())
  manager.register(new ScaleManager())
  return manager
}

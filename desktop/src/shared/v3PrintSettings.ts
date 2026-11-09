export type PrintSettingsEndpoint =
  | { kind: 'USB'; queueName: string; portName: string }
  | { kind: 'TCP'; host: string; port: number }

export type UsbQueueChoice = { queueName: string; portName: string; key: string }

export type PrintSettingsRequest =
  | { action: 'read'; storeCode: string }
  | { action: 'queues'; storeCode: string }
  | { action: 'save'; storeCode: string; role: 'FRONT' | 'KITCHEN'; revision: number; target: Extract<PrintSettingsEndpoint, { kind: 'TCP' }> | ({ kind: 'USB' } & UsbQueueChoice) }
  | { action: 'test'; storeCode: string; revision: number }

export type PrintSettingsState = {
  mode: 'V3' | 'LEGACY' | 'BLOCKED'
  revision: number
  usbSupported: boolean
  front: PrintSettingsEndpoint | null
  kitchen: Extract<PrintSettingsEndpoint, { kind: 'TCP' }> | null
  blockedCode: string | null
}

export type PrintSettingsReply =
  | { ok: false; code: string }
  | { ok: true; state: PrintSettingsState }
  | { ok: true; queues: UsbQueueChoice[] }
  | { ok: true; code: 'SETTINGS_SAVED' | 'USB_TEST_SPOOLED' }

export type WindowsUsbEndpoint = {
  kind: 'windows-usb'
  queueName: string
  portName: string
  deviceInstanceId: string
}

const KEY_PREFIX = 'windows-usb:'
// Exclude wildcard, remote, port-pool and special spooler name syntax.
const QUEUE_NAME = /^(?!.*[\u{10000}-\u{10ffff}])[\p{L}\p{M}\p{N} ._()-]{1,128}$/u

export function parseWindowsUsbEndpoint(value: unknown): WindowsUsbEndpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'deviceInstanceId,kind,portName,queueName' ||
      row.kind !== 'windows-usb' ||
      typeof row.queueName !== 'string' || !QUEUE_NAME.test(row.queueName) || row.queueName !== row.queueName.trim() ||
      typeof row.portName !== 'string' || !/^USB[0-9]{3,5}$/.test(row.portName) ||
      typeof row.deviceInstanceId !== 'string' ||
      !/^USB\\VID_[0-9A-F]{4}&PID_[0-9A-F]{4}(?:&MI_[0-9A-F]{2})?\\[A-Z0-9&_.-]{1,100}$/i.test(row.deviceInstanceId)) return null
  return { kind: row.kind, queueName: row.queueName, portName: row.portName, deviceInstanceId: row.deviceInstanceId.toUpperCase() }
}

export function windowsUsbEndpointKey(endpoint: WindowsUsbEndpoint): string {
  return KEY_PREFIX + JSON.stringify(endpoint)
}

export function isWindowsUsbEndpointKey(key: string): boolean {
  return key.startsWith(KEY_PREFIX)
}

export function readWindowsUsbEndpointKey(key: string): WindowsUsbEndpoint | null {
  if (!isWindowsUsbEndpointKey(key)) return null
  try {
    const endpoint = parseWindowsUsbEndpoint(JSON.parse(key.slice(KEY_PREFIX.length)))
    return endpoint && windowsUsbEndpointKey(endpoint) === key ? endpoint : null
  } catch {
    return null
  }
}

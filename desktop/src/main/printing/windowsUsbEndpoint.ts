export type WindowsUsbEndpoint = {
  kind: 'windows-usb'
  queueName: string
  portName: string
  deviceInstanceId: string
}

const KEY_PREFIX = 'windows-usb:'
const DIAMOND_STORE_ID = 'cmvulpn8r000106jvpo58kye4'
const DIAMOND_DEVICE_ID = 'cmvyx1jes000208l14t5vf9ur'

export function isDiamondUsbIdentity(storeId: string, deviceId: string): boolean {
  return storeId === DIAMOND_STORE_ID && deviceId === DIAMOND_DEVICE_ID
}

export function parseWindowsUsbEndpoint(value: unknown): WindowsUsbEndpoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'deviceInstanceId,kind,portName,queueName' ||
      row.kind !== 'windows-usb' ||
      row.queueName !== 'E-Shop Diamond FRONT USB' ||
      typeof row.portName !== 'string' || !/^USB[0-9]{3,5}$/.test(row.portName) ||
      typeof row.deviceInstanceId !== 'string' ||
      !/^USB\\VID_0FE6&PID_811E\\[A-Z0-9&_.-]{1,100}$/i.test(row.deviceInstanceId)) return null
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

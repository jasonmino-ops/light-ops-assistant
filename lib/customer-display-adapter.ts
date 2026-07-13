'use client'

export type CustomerDisplayStatusKind =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'disconnecting'
  | 'connected'
  | 'error'

export type CustomerDisplayStatus = {
  status: CustomerDisplayStatusKind
  baudRate: number
  message?: string
  portInfo?: CustomerDisplayPortInfo | null
}

export type CustomerDisplayPortInfo = {
  usbVendorId?: number
  usbProductId?: number
}

export type CustomerDisplayStatusListener = (status: CustomerDisplayStatus) => void

export const CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE = 2400
export const CUSTOMER_DISPLAY_SUPPORTED_BAUD_RATES = [2400, 9600] as const
export const CUSTOMER_DISPLAY_MAX_AMOUNT_LENGTH = 12

const ESC_POS_INIT = new Uint8Array([0x1b, 0x40])
const ESC_POS_CLEAR = new Uint8Array([0x0c])
const ESC_POS_DISPLAY_AMOUNT_PREFIX = new Uint8Array([0x1b, 0x51, 0x41])
const ESC_POS_CR = 0x0d

let port: SerialPort | null = null
let baudRate = CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE
let status: CustomerDisplayStatus = makeStatus(isWebSerialSupported() ? 'disconnected' : 'unsupported')
let writeQueue: Promise<void> = Promise.resolve()
let connectionPromise: Promise<CustomerDisplayStatus> | null = null
const listeners = new Set<CustomerDisplayStatusListener>()

function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && !!navigator.serial
}

function normalizeBaudRate(input?: number) {
  return input === 9600 ? 9600 : CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE
}

function makeStatus(nextStatus: CustomerDisplayStatusKind, message?: string): CustomerDisplayStatus {
  return {
    status: isWebSerialSupported() ? nextStatus : 'unsupported',
    baudRate,
    message,
    portInfo: getSafePortInfo(port),
  }
}

function emitStatus(nextStatus: CustomerDisplayStatusKind, message?: string) {
  status = makeStatus(nextStatus, message)
  for (const listener of listeners) {
    try {
      listener(status)
    } catch (error) {
      console.warn('[customer-display] status listener failed', error)
    }
  }
}

function getSafePortInfo(nextPort: SerialPort | null): CustomerDisplayPortInfo | null {
  try {
    const info = nextPort?.getInfo?.()
    if (!info) return null
    return {
      usbVendorId: info.usbVendorId,
      usbProductId: info.usbProductId,
    }
  } catch {
    return null
  }
}

function bindDisconnect(nextPort: SerialPort) {
  try {
    nextPort.addEventListener?.('disconnect', () => {
      if (port === nextPort) {
        port = null
        emitStatus('disconnected', 'Device disconnected')
      }
    })
  } catch {}
}

function isPortWritable(nextPort: SerialPort | null) {
  return !!nextPort?.writable
}

function isAlreadyOpenError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /already open|port is already open/i.test(message)
}

async function openPort(nextPort: SerialPort, nextBaudRate: number) {
  baudRate = normalizeBaudRate(nextBaudRate)
  if (port === nextPort && isPortWritable(nextPort)) {
    emitStatus('connected')
    return
  }
  emitStatus('connecting')
  try {
    await nextPort.open({
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: 'none',
      flowControl: 'none',
    })
  } catch (error) {
    if (!isAlreadyOpenError(error) || !isPortWritable(nextPort)) throw error
  }
  port = nextPort
  bindDisconnect(nextPort)
  emitStatus('connected')
}

async function connectWithMutex(nextBaudRate: number, selectPort: () => Promise<SerialPort | null>) {
  if (!isWebSerialSupported()) {
    emitStatus('unsupported', 'Web Serial is not supported')
    return status
  }
  if (isPortWritable(port)) {
    baudRate = normalizeBaudRate(nextBaudRate)
    emitStatus('connected')
    return status
  }
  if (connectionPromise) return connectionPromise

  connectionPromise = (async () => {
    try {
      const nextPort = await selectPort()
      if (!nextPort) {
        emitStatus('disconnected')
        return status
      }
      await openPort(nextPort, nextBaudRate)
      await enqueueWrite(buildCustomerDisplayInitBytes())
      return status
    } catch (error) {
      if (isAlreadyOpenError(error) && isPortWritable(port)) {
        emitStatus('connected')
        return status
      }
      emitStatus('error', error instanceof Error ? error.message : 'Serial connection failed')
      return status
    } finally {
      connectionPromise = null
    }
  })()

  return connectionPromise
}

async function enqueueWrite(bytes: Uint8Array) {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
      const currentPort = port
      if (!currentPort?.writable) {
        emitStatus('disconnected', 'No writable serial port')
        return
      }

      const writer = currentPort.writable.getWriter()
      try {
        await writer.write(bytes)
        if (status.status === 'error' && port === currentPort) emitStatus('connected')
      } catch (error) {
        emitStatus('error', error instanceof Error ? error.message : 'Serial write failed')
      } finally {
        try {
          writer.releaseLock()
        } catch {}
      }
    })
  return writeQueue
}

export function formatCustomerDisplayAmount(amount: number, maxLength = CUSTOMER_DISPLAY_MAX_AMOUNT_LENGTH): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('INVALID_CUSTOMER_DISPLAY_AMOUNT')
  }
  const formatted = amount.toFixed(2)
  if (!/^\d+(\.\d+)?$/.test(formatted)) {
    throw new Error('INVALID_CUSTOMER_DISPLAY_AMOUNT_FORMAT')
  }
  if (formatted.length > maxLength) {
    throw new Error('CUSTOMER_DISPLAY_AMOUNT_TOO_LONG')
  }
  return formatted
}

export function buildCustomerDisplayAmountBytes(amount: number): Uint8Array {
  const text = formatCustomerDisplayAmount(amount)
  const bytes = new Uint8Array(ESC_POS_DISPLAY_AMOUNT_PREFIX.length + text.length + 1)
  bytes.set(ESC_POS_DISPLAY_AMOUNT_PREFIX, 0)
  for (let i = 0; i < text.length; i += 1) {
    bytes[ESC_POS_DISPLAY_AMOUNT_PREFIX.length + i] = text.charCodeAt(i)
  }
  bytes[bytes.length - 1] = ESC_POS_CR
  return bytes
}

export function buildCustomerDisplayInitBytes(): Uint8Array {
  return new Uint8Array(ESC_POS_INIT)
}

export function buildCustomerDisplayClearBytes(): Uint8Array {
  return new Uint8Array(ESC_POS_CLEAR)
}

export async function connectCustomerDisplay(nextBaudRate = CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE): Promise<CustomerDisplayStatus> {
  return connectWithMutex(nextBaudRate, () => navigator.serial!.requestPort())
}

export async function reconnectAuthorizedCustomerDisplay(nextBaudRate = CUSTOMER_DISPLAY_DEFAULT_BAUD_RATE): Promise<CustomerDisplayStatus> {
  return connectWithMutex(nextBaudRate, async () => {
    const ports = await navigator.serial!.getPorts()
    return ports[0] ?? null
  })
}

export async function disconnectCustomerDisplay(): Promise<CustomerDisplayStatus> {
  if (!isWebSerialSupported()) {
    emitStatus('unsupported')
    return status
  }
  try {
    emitStatus('disconnecting')
    if (connectionPromise) await connectionPromise.catch(() => undefined)
    const currentPort = port
    await writeQueue.catch(() => undefined)
    await currentPort?.close?.()
    if (port === currentPort) port = null
    emitStatus('disconnected')
  } catch (error) {
    emitStatus('error', error instanceof Error ? error.message : 'Serial disconnect failed')
  }
  return status
}

export async function showCustomerDisplayAmount(amount: number): Promise<CustomerDisplayStatus> {
  try {
    await enqueueWrite(buildCustomerDisplayAmountBytes(amount))
  } catch (error) {
    emitStatus('error', error instanceof Error ? error.message : 'Serial amount display failed')
  }
  return status
}

export async function clearCustomerDisplay(): Promise<CustomerDisplayStatus> {
  try {
    await enqueueWrite(buildCustomerDisplayClearBytes())
  } catch (error) {
    emitStatus('error', error instanceof Error ? error.message : 'Serial clear failed')
  }
  return status
}

export async function testCustomerDisplay(): Promise<CustomerDisplayStatus> {
  try {
    await enqueueWrite(buildCustomerDisplayInitBytes())
    await enqueueWrite(buildCustomerDisplayAmountBytes(8888.88))
  } catch (error) {
    emitStatus('error', error instanceof Error ? error.message : 'Serial test failed')
  }
  return status
}

export function getCustomerDisplayStatus(): CustomerDisplayStatus {
  return status
}

export function subscribeCustomerDisplayStatus(listener: CustomerDisplayStatusListener): () => void {
  listeners.add(listener)
  listener(status)
  return () => {
    listeners.delete(listener)
  }
}

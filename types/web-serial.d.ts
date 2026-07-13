type SerialParity = 'none' | 'even' | 'odd'
type SerialFlowControl = 'none' | 'hardware'

interface SerialOptions {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: SerialParity
  flowControl?: SerialFlowControl
}

interface SerialPortInfo {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialPort extends EventTarget {
  readonly writable?: WritableStream<Uint8Array> | null
  open(options: SerialOptions): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
}

interface Serial {
  requestPort(): Promise<SerialPort>
  getPorts(): Promise<SerialPort[]>
}

interface Navigator {
  readonly serial?: Serial
}

// QZ Tray adapter for the controlled QZ-PRINT-01B dual-queue field test.
//
// This deliberately has no default-printer lookup and no browser-print
// fallback. Each button submits one job to its fixed Windows queue, so a
// customer-receipt failure and a kitchen-ticket failure remain independent.

export const QZ_PRINT_QUEUES = {
  receipt: '前台',
  kitchen: '厨房',
} as const

export type QzPrintKind = keyof typeof QZ_PRINT_QUEUES
export type QzStatus = 'idle' | 'checking' | 'online' | 'offline'

export type QzClient = {
  websocket: {
    isActive: () => boolean
    connect: (options?: Record<string, unknown>) => Promise<void>
  }
  printers: {
    find: (query?: string) => Promise<string | string[]>
  }
  configs: {
    create: (printer: string, options?: Record<string, unknown>) => unknown
  }
  print: (config: unknown, data: unknown[]) => Promise<void>
  security: {
    setCertificatePromise: (
      promiseHandler: (resolve: (value: string) => void, reject: (error: unknown) => void) => void,
    ) => void
    setSignaturePromise: (
      promiseFactory: (toSign: string) => (resolve: (value: string) => void, reject: (error: unknown) => void) => void,
    ) => void
  }
}

export class QzPrintError extends Error {
  constructor(
    public readonly code: 'QZ_UNAVAILABLE' | 'QZ_QUEUE_NOT_FOUND' | 'QZ_PRINT_FAILED',
    public readonly queueName: string,
    options?: { cause?: unknown },
  ) {
    super(`${code}:${queueName}`, options)
    this.name = 'QzPrintError'
  }
}

let qzModulePromise: Promise<QzClient> | null = null

// QZ's HTML renderer otherwise inherits the printer/default page size and can
// create an A4 raster job even when the HTML itself is 80mm wide.
export const QZ_RECEIPT_WIDTH_INCHES = 80 / 25.4

async function loadQz(): Promise<QzClient> {
  if (typeof window === 'undefined') {
    throw new QzPrintError('QZ_UNAVAILABLE', '')
  }
  if (!qzModulePromise) {
    qzModulePromise = import('qz-tray').then((mod) => {
      const qz = ((mod as { default?: QzClient }).default ?? mod) as QzClient
      qz.security.setCertificatePromise((resolve) => resolve(''))
      qz.security.setSignaturePromise(() => (resolve) => resolve(''))
      return qz
    })
  }
  return qzModulePromise
}

async function ensureConnected(qz: QzClient, queueName: string): Promise<void> {
  try {
    if (!qz.websocket.isActive()) {
      await qz.websocket.connect({ retries: 1, delay: 0 })
    }
    if (!qz.websocket.isActive()) {
      throw new Error('QZ websocket inactive after connect')
    }
  } catch (cause) {
    throw new QzPrintError('QZ_UNAVAILABLE', queueName, { cause })
  }
}

function normalizePrinters(result: string | string[]): string[] {
  return Array.isArray(result) ? result : [result]
}

async function assertQueueExists(qz: QzClient, queueName: string): Promise<void> {
  let printers: string[]
  try {
    printers = normalizePrinters(await qz.printers.find())
  } catch (cause) {
    throw new QzPrintError('QZ_UNAVAILABLE', queueName, { cause })
  }
  if (!printers.includes(queueName)) {
    throw new QzPrintError('QZ_QUEUE_NOT_FOUND', queueName)
  }
}

export async function detectQzOnline(client?: QzClient): Promise<boolean> {
  try {
    const qz = client ?? (await loadQz())
    await ensureConnected(qz, '')
    return qz.websocket.isActive()
  } catch {
    return false
  }
}

export async function listQzPrinters(client?: QzClient): Promise<string[]> {
  const qz = client ?? (await loadQz())
  await ensureConnected(qz, '')
  try {
    return normalizePrinters(await qz.printers.find())
  } catch (cause) {
    throw new QzPrintError('QZ_UNAVAILABLE', '', { cause })
  }
}

export async function printHelloWorldViaQz(printerName: string, client?: QzClient): Promise<void> {
  if (!printerName) throw new QzPrintError('QZ_QUEUE_NOT_FOUND', '')
  const qz = client ?? (await loadQz())
  await ensureConnected(qz, printerName)
  const config = qz.configs.create(printerName)
  try {
    await qz.print(config, ['Hello World\n', 'E-Shop QZ Tray POC\n', '\n\n\n'])
  } catch (cause) {
    throw new QzPrintError('QZ_PRINT_FAILED', printerName, { cause })
  }
}

export async function printHtmlViaFixedQzQueue(
  kind: QzPrintKind,
  html: string,
  client?: QzClient,
): Promise<{ kind: QzPrintKind; queueName: string }> {
  const queueName = QZ_PRINT_QUEUES[kind]
  const qz = client ?? (await loadQz())
  await ensureConnected(qz, queueName)
  await assertQueueExists(qz, queueName)

  const config = qz.configs.create(queueName, {
    units: 'in',
    size: { width: QZ_RECEIPT_WIDTH_INCHES },
    margins: 0,
    orientation: 'portrait',
    scaleContent: false,
  })

  try {
    await qz.print(config, [{
      type: 'pixel',
      format: 'html',
      flavor: 'plain',
      data: html,
      options: { pageWidth: QZ_RECEIPT_WIDTH_INCHES },
    }])
  } catch (cause) {
    throw new QzPrintError('QZ_PRINT_FAILED', queueName, { cause })
  }

  return { kind, queueName }
}

export function printCustomerReceiptViaQz(html: string, client?: QzClient) {
  return printHtmlViaFixedQzQueue('receipt', html, client)
}

export function printKitchenTicketViaQz(html: string, client?: QzClient) {
  return printHtmlViaFixedQzQueue('kitchen', html, client)
}

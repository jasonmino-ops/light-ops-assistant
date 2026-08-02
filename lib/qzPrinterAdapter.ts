// QZ Tray adapter for the fixed front/kitchen queues.
//
// This deliberately has no default-printer lookup and no browser-print
// fallback. Formal tickets default to the field-verified RAW bitmap path;
// the earlier Pixel path remains available only for controlled comparison.

import { qzRawBytesToBase64 } from './qzEscPosBitImage'
import { renderTicketHtmlToEscPosRaw } from './qzHtmlBitmapRenderer'

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
export const QZ_PIXEL_DENSITY_DPI = 203

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
    density: QZ_PIXEL_DENSITY_DPI,
    fallbackDensity: QZ_PIXEL_DENSITY_DPI,
    colorType: 'blackwhite',
    interpolation: 'nearest-neighbor',
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

/**
 * Controlled QZ-PRINT-02A transport only: submits pre-built ESC/POS bytes as
 * base64 RAW data to one of the two exact queues. It deliberately has no
 * Pixel options, default-printer lookup, browser-print fallback, or retry.
 */
export async function printEscPosBitImageViaFixedQzQueue(
  kind: QzPrintKind,
  bytes: Uint8Array,
  client?: QzClient,
): Promise<{ kind: QzPrintKind; queueName: string }> {
  const queueName = QZ_PRINT_QUEUES[kind]
  const qz = client ?? (await loadQz())
  await ensureConnected(qz, queueName)
  await assertQueueExists(qz, queueName)

  const config = qz.configs.create(queueName)
  try {
    await qz.print(config, [{
      type: 'raw',
      format: 'base64',
      data: qzRawBytesToBase64(bytes),
    }])
  } catch (cause) {
    throw new QzPrintError('QZ_PRINT_FAILED', queueName, { cause })
  }

  return { kind, queueName }
}

export type QzHtmlRasterizer = (html: string) => Promise<Uint8Array>

/**
 * Default formal-ticket path. Pixel remains available through
 * printHtmlViaFixedQzQueue for the controlled comparison page, while formal
 * customer and kitchen tickets use the field-verified RAW bitmap transport.
 */
export async function printHtmlAsEscPosBitImageViaFixedQzQueue(
  kind: QzPrintKind,
  html: string,
  client?: QzClient,
  rasterize: QzHtmlRasterizer = renderTicketHtmlToEscPosRaw,
) {
  const queueName = QZ_PRINT_QUEUES[kind]
  let bytes: Uint8Array
  try {
    bytes = await rasterize(html)
  } catch (cause) {
    throw new QzPrintError('QZ_PRINT_FAILED', queueName, { cause })
  }
  return printEscPosBitImageViaFixedQzQueue(kind, bytes, client)
}

export function printCustomerReceiptViaQz(
  html: string,
  client?: QzClient,
  rasterize?: QzHtmlRasterizer,
) {
  return printHtmlAsEscPosBitImageViaFixedQzQueue('receipt', html, client, rasterize)
}

export function printKitchenTicketViaQz(
  html: string,
  client?: QzClient,
  rasterize?: QzHtmlRasterizer,
) {
  return printHtmlAsEscPosBitImageViaFixedQzQueue('kitchen', html, client, rasterize)
}

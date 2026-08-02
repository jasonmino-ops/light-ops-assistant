// QZ Tray adapter for the fixed front/kitchen queues.
//
// This deliberately has no default-printer lookup and no browser-print
// fallback. Formal tickets default to the field-verified RAW bitmap path;
// the earlier Pixel path remains available only for controlled comparison.

import { qzRawBytesToBase64 } from './qzEscPosBitImage'
import { renderTicketHtmlToEscPosRaw } from './qzHtmlBitmapRenderer'
import { posDeviceHeaders } from './desktop-pos-client'

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
    disconnect: () => Promise<void>
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
      options?: { rejectOnFailure?: boolean },
    ) => void
    setSignatureAlgorithm: (algorithm: 'SHA512') => void
    setSignaturePromise: (
      promiseFactory: (toSign: string) => (resolve: (value: string) => void, reject: (error: unknown) => void) => void,
    ) => void
  }
}

export class QzPrintError extends Error {
  constructor(
    public readonly code:
      | 'QZ_UNAVAILABLE'
      | 'QZ_QUEUE_NOT_FOUND'
      | 'QZ_PRINT_FAILED'
      | 'QZ_SECURITY_UNAVAILABLE',
    public readonly queueName: string,
    options?: { cause?: unknown },
  ) {
    super(`${code}:${queueName}`, options)
    this.name = 'QzPrintError'
  }
}

let qzModulePromise: Promise<QzClient> | null = null
let qzSecurityConfigPromise: Promise<QzSecurityConfig> | null = null
let qzSecurityFailureSequence = 0
let qzSecurityReconnectRequired = false

class QzSecurityUnavailableError extends Error {
  constructor() {
    super('QZ_SECURITY_UNAVAILABLE')
    this.name = 'QzSecurityUnavailableError'
  }
}

type QzSecurityConfig = {
  certificate: string
  signatureAlgorithm: 'SHA512'
  certificateVersion: string
  enabled: true
}

function currentCashierStoreCode(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('storeCode')?.trim() ?? ''
}

export async function fetchQzSecurityConfig(): Promise<QzSecurityConfig> {
  const response = await fetch('/api/qz/config', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new QzSecurityUnavailableError()
  const value = await response.json() as Partial<QzSecurityConfig>
  if (
    value.enabled !== true ||
    value.signatureAlgorithm !== 'SHA512' ||
    typeof value.certificate !== 'string' ||
    !value.certificate.includes('-----BEGIN CERTIFICATE-----') ||
    typeof value.certificateVersion !== 'string' ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.certificateVersion)
  ) {
    throw new QzSecurityUnavailableError()
  }
  return value as QzSecurityConfig
}

export function clearQzSecurityConfigForRecovery(): void {
  qzSecurityConfigPromise = null
}

function getQzSecurityConfig(): Promise<QzSecurityConfig> {
  if (!qzSecurityConfigPromise) {
    const pending = fetchQzSecurityConfig()
    qzSecurityConfigPromise = pending
    void pending.catch(() => {
      if (qzSecurityConfigPromise === pending) qzSecurityConfigPromise = null
    })
  }
  return qzSecurityConfigPromise
}

export async function fetchQzSignature(toSign: string): Promise<string> {
  if (!/^[0-9a-fA-F]{64}$/.test(toSign)) throw new QzSecurityUnavailableError()
  const securityConfig = await getQzSecurityConfig()
  const response = await fetch('/api/qz/sign', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-QZ-Certificate-Version': securityConfig.certificateVersion,
      ...posDeviceHeaders(currentCashierStoreCode()),
    },
    body: toSign,
  })
  if (!response.ok) {
    if (response.status === 409) {
      clearQzSecurityConfigForRecovery()
      qzSecurityReconnectRequired = true
    }
    throw new QzSecurityUnavailableError()
  }
  const signature = (await response.text()).trim()
  const responseVersion = response.headers.get('x-qz-certificate-version')?.trim() ?? ''
  if (
    responseVersion !== securityConfig.certificateVersion ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signature)
  ) {
    clearQzSecurityConfigForRecovery()
    qzSecurityReconnectRequired = true
    throw new QzSecurityUnavailableError()
  }
  return signature
}

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
      configureQzSecurity(qz)
      return qz
    })
  }
  return qzModulePromise
}

function rememberQzSecurityFailure(): void {
  qzSecurityFailureSequence += 1
}

export function configureQzSecurity(qz: QzClient): void {
  qz.security.setSignatureAlgorithm('SHA512')
  qz.security.setCertificatePromise((resolve, reject) => {
    getQzSecurityConfig().then(({ certificate }) => resolve(certificate), (error) => {
      rememberQzSecurityFailure()
      reject(error)
    })
  }, { rejectOnFailure: true })
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    fetchQzSignature(toSign).then(resolve, (error) => {
      rememberQzSecurityFailure()
      reject(error)
    })
  })
}

async function recoverQzSecurityConnection(qz: QzClient): Promise<void> {
  clearQzSecurityConfigForRecovery()
  try {
    if (qz.websocket.isActive()) await qz.websocket.disconnect()
  } catch {
    // The current print is already blocked. A page reload remains fail-closed.
  } finally {
    qzSecurityReconnectRequired = false
  }
}

async function qzFailure(
  qz: QzClient,
  queueName: string,
  failureSequenceBefore: number,
  cause: unknown,
  defaultCode: 'QZ_UNAVAILABLE' | 'QZ_PRINT_FAILED',
): Promise<QzPrintError> {
  if (
    cause instanceof QzSecurityUnavailableError ||
    qzSecurityFailureSequence !== failureSequenceBefore ||
    qzSecurityReconnectRequired
  ) {
    await recoverQzSecurityConnection(qz)
    return new QzPrintError('QZ_SECURITY_UNAVAILABLE', queueName, { cause })
  }
  return new QzPrintError(defaultCode, queueName, { cause })
}

async function ensureConnected(qz: QzClient, queueName: string): Promise<void> {
  const failureSequenceBefore = qzSecurityFailureSequence
  try {
    if (!qz.websocket.isActive()) {
      clearQzSecurityConfigForRecovery()
      await qz.websocket.connect({ retries: 1, delay: 0 })
    }
    if (!qz.websocket.isActive()) {
      throw new Error('QZ websocket inactive after connect')
    }
  } catch (cause) {
    throw await qzFailure(qz, queueName, failureSequenceBefore, cause, 'QZ_UNAVAILABLE')
  }
}

function normalizePrinters(result: string | string[]): string[] {
  return Array.isArray(result) ? result : [result]
}

async function assertQueueExists(qz: QzClient, queueName: string): Promise<void> {
  let printers: string[]
  const failureSequenceBefore = qzSecurityFailureSequence
  try {
    printers = normalizePrinters(await qz.printers.find())
  } catch (cause) {
    throw await qzFailure(qz, queueName, failureSequenceBefore, cause, 'QZ_UNAVAILABLE')
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
  const failureSequenceBefore = qzSecurityFailureSequence
  try {
    return normalizePrinters(await qz.printers.find())
  } catch (cause) {
    throw await qzFailure(qz, '', failureSequenceBefore, cause, 'QZ_UNAVAILABLE')
  }
}

async function submitQzPrint(
  qz: QzClient,
  queueName: string,
  config: unknown,
  data: unknown[],
): Promise<void> {
  const failureSequenceBefore = qzSecurityFailureSequence
  try {
    await qz.print(config, data)
  } catch (cause) {
    throw await qzFailure(qz, queueName, failureSequenceBefore, cause, 'QZ_PRINT_FAILED')
  }
}

export async function printHelloWorldViaQz(printerName: string, client?: QzClient): Promise<void> {
  if (!printerName) throw new QzPrintError('QZ_QUEUE_NOT_FOUND', '')
  const qz = client ?? (await loadQz())
  await ensureConnected(qz, printerName)
  const config = qz.configs.create(printerName)
  await submitQzPrint(qz, printerName, config, ['Hello World\n', 'E-Shop QZ Tray POC\n', '\n\n\n'])
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

  await submitQzPrint(qz, queueName, config, [{
    type: 'pixel',
    format: 'html',
    flavor: 'plain',
    data: html,
    options: { pageWidth: QZ_RECEIPT_WIDTH_INCHES },
  }])

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
  await submitQzPrint(qz, queueName, config, [{
    type: 'raw',
    format: 'base64',
    data: qzRawBytesToBase64(bytes),
  }])

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

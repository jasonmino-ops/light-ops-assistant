// Browser Print Adapter for QZ Tray.
//
// This module owns all qz-tray SDK calls so business pages only need to
// call these functions and never touch the qz-tray library directly.

import { posDeviceHeaders } from './desktop-pos-client'
import { qzRawBytesToBase64 } from './qzEscPosBitImage'
import { renderTicketHtmlToEscPosRaw } from './qzHtmlBitmapRenderer'

const QZ_CONFIG_ENDPOINT = '/api/qz/config'
const QZ_SIGN_ENDPOINT = '/api/qz/sign'
const QZ_CERTIFICATE_VERSION_HEADER = 'x-qz-certificate-version'
const QZ_SIGNATURE_ALGORITHM = 'SHA512' as const
const STORE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const DIGEST_PATTERN = /^[0-9a-fA-F]{64}$/

type QzRemoteSigningConfig = {
  certificate: string
  certificateVersion: string
  signatureAlgorithm: typeof QZ_SIGNATURE_ALGORITHM
  enabled: true
}

export type QzSigningAdapterDependencies = {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>
  readLocationSearch: () => string
  getPosHeaders: (storeCode: string) => Record<string, string>
}

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
      promiseHandler: () => Promise<string>,
      options?: { rejectOnFailure?: boolean },
    ) => void
    setSignaturePromise: (
      promiseFactory: (toSign: string) => Promise<string>,
    ) => void
    setSignatureAlgorithm: (algorithm: typeof QZ_SIGNATURE_ALGORITHM) => void
  }
}

export const QZ_PRINT_QUEUES = {
  receipt: '前台',
  kitchen: '厨房',
} as const

export type QzPrintKind = keyof typeof QZ_PRINT_QUEUES
export type QzClientMode = 'signed' | 'raw'

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
let qzRawModulePromise: Promise<QzClient> | null = null
let qzRawSignedPrintTail: Promise<void> = Promise.resolve()

const DEFAULT_SIGNING_DEPENDENCIES: QzSigningAdapterDependencies = {
  fetchImpl: (input, init) => fetch(input, init),
  readLocationSearch: () => {
    if (typeof window === 'undefined') throw new Error('QZ_BROWSER_ONLY')
    return window.location.search
  },
  getPosHeaders: posDeviceHeaders,
}

function assertCertificate(value: unknown): string {
  if (typeof value !== 'string') throw new Error('QZ_SIGNING_CONFIG_INVALID')
  const certificate = value.trim()
  if (
    certificate.length === 0 ||
    certificate.length > 32_768 ||
    !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(certificate)
  ) {
    throw new Error('QZ_SIGNING_CONFIG_INVALID')
  }
  return certificate
}

function assertCertificateVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    throw new Error('QZ_SIGNING_CONFIG_INVALID')
  }
  return value
}

async function readSigningConfig(
  dependencies: QzSigningAdapterDependencies,
): Promise<QzRemoteSigningConfig> {
  const response = await dependencies.fetchImpl(QZ_CONFIG_ENDPOINT, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (response.status !== 200) throw new Error('QZ_SIGNING_CONFIG_UNAVAILABLE')

  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new Error('QZ_SIGNING_CONFIG_INVALID')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('QZ_SIGNING_CONFIG_INVALID')
  }
  const config = value as Record<string, unknown>
  if (config.enabled !== true) throw new Error('QZ_SIGNING_DISABLED')
  if (config.signatureAlgorithm !== QZ_SIGNATURE_ALGORITHM) {
    throw new Error('QZ_SIGNING_CONFIG_INVALID')
  }
  return {
    certificate: assertCertificate(config.certificate),
    certificateVersion: assertCertificateVersion(config.certificateVersion),
    signatureAlgorithm: QZ_SIGNATURE_ALGORITHM,
    enabled: true,
  }
}

function readStoreCode(dependencies: QzSigningAdapterDependencies): string {
  const values = new URLSearchParams(dependencies.readLocationSearch())
    .getAll('storeCode')
    .map((value) => value.trim())
  if (values.length !== 1 || !STORE_CODE_PATTERN.test(values[0])) {
    throw new Error('QZ_SIGNING_STORE_CONTEXT_INVALID')
  }
  return values[0]
}

function isValidBase64Signature(value: string): boolean {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return false
  }
  try {
    return atob(value).length > 0
  } catch {
    return false
  }
}

async function requestSignature(
  config: QzRemoteSigningConfig,
  digest: string,
  dependencies: QzSigningAdapterDependencies,
): Promise<string> {
  if (!DIGEST_PATTERN.test(digest)) throw new Error('QZ_SIGNING_DIGEST_INVALID')
  const storeCode = readStoreCode(dependencies)
  const posHeaders = dependencies.getPosHeaders(storeCode)
  const token = posHeaders['x-pos-device-token']?.trim() ?? ''
  const deviceId = posHeaders['x-pos-device-id']?.trim() ?? ''
  if (!token || !deviceId) throw new Error('QZ_SIGNING_POS_AUTH_MISSING')

  const response = await dependencies.fetchImpl(QZ_SIGN_ENDPOINT, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      ...posHeaders,
      'Content-Type': 'text/plain',
      [QZ_CERTIFICATE_VERSION_HEADER]: config.certificateVersion,
      'x-pos-device-token': token,
      'x-pos-device-id': deviceId,
    },
    body: digest,
  })
  if (response.status !== 200) throw new Error('QZ_SIGNING_REQUEST_FAILED')
  const signature = await response.text()
  if (signature !== signature.trim() || !isValidBase64Signature(signature)) {
    throw new Error('QZ_SIGNING_RESPONSE_INVALID')
  }
  return signature
}

export function configureQzSigningSecurity(
  qz: QzClient,
  dependencies: QzSigningAdapterDependencies = DEFAULT_SIGNING_DEPENDENCIES,
): void {
  let activeConfig: QzRemoteSigningConfig | null = null

  qz.security.setCertificatePromise(async () => {
    activeConfig = null
    const config = await readSigningConfig(dependencies)
    qz.security.setSignatureAlgorithm(config.signatureAlgorithm)
    activeConfig = config
    return config.certificate
  }, { rejectOnFailure: true })

  qz.security.setSignaturePromise(async (digest) => {
    if (!activeConfig) throw new Error('QZ_SIGNING_CONFIG_UNAVAILABLE')
    return requestSignature(activeConfig, digest, dependencies)
  })
}

// QZ Tray's HTML renderer falls back to the printer/default page when no
// explicit width is supplied. A POS-80 driver can therefore receive an A4
// raster job even though the receipt HTML itself is 80mm wide.
export const QZ_RECEIPT_WIDTH_INCHES = 80 / 25.4

async function loadQz(): Promise<QzClient> {
  if (typeof window === 'undefined') {
    throw new Error('QZ_BROWSER_ONLY')
  }
  if (!qzModulePromise) {
    qzModulePromise = import('qz-tray').then((mod) => {
      const qz = ((mod as { default?: QzClient }).default ?? mod) as QzClient
      configureQzSigningSecurity(qz)
      return qz
    })
  }
  return qzModulePromise
}

type HistoricalRawQzSecurity = {
  setCertificatePromise: (
    promiseHandler: (resolve: (value: string) => void) => void,
  ) => void
  setSignaturePromise: (
    promiseFactory: () => (resolve: (value: string) => void) => void,
  ) => void
  setSignatureAlgorithm: (algorithm: 'SHA1') => void
}

function configureHistoricalRawQzSecurity(qz: QzClient): void {
  const security = qz.security as unknown as HistoricalRawQzSecurity
  security.setCertificatePromise((resolve) => resolve(''))
  security.setSignaturePromise(() => (resolve) => resolve(''))
  security.setSignatureAlgorithm('SHA1')
}

async function loadRawQz(): Promise<QzClient> {
  if (typeof window === 'undefined') {
    throw new Error('QZ_BROWSER_ONLY')
  }
  if (!qzRawModulePromise) {
    // The resource query gives the historical RAW path its own qz-tray SDK
    // instance, so its unsigned callbacks cannot be replaced by the optional
    // Signed adapter's security initialization.
    qzRawModulePromise = import('qz-tray?raw-connection').then((mod) => {
      const qz = ((mod as { default?: QzClient }).default ?? mod) as QzClient
      configureHistoricalRawQzSecurity(qz)
      return qz
    })
  }
  return qzRawModulePromise
}

async function loadQzClient(mode: QzClientMode): Promise<QzClient> {
  return mode === 'raw' ? loadRawQz() : loadQz()
}

async function ensureConnected(qz: QzClient): Promise<void> {
  if (qz.websocket.isActive()) return
  await qz.websocket.connect({ retries: 1, delay: 0 })
}

async function ensureFixedQueueConnected(qz: QzClient, queueName: string): Promise<void> {
  try {
    await ensureConnected(qz)
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

async function submitSignedRawPrintRequest(
  qz: QzClient,
  config: unknown,
  data: unknown[],
): Promise<void> {
  const request = qzRawSignedPrintTail.then(async () => {
    // Keep the historical RAW callbacks for connection and enumeration. Only
    // the actual print request uses the existing E-Shop signing implementation.
    configureQzSigningSecurity(qz)
    try {
      await qz.print(config, data)
    } finally {
      configureHistoricalRawQzSecurity(qz)
    }
  })
  qzRawSignedPrintTail = request.catch(() => {})
  return request
}

export async function detectQzOnline(
  client?: QzClient,
  mode: QzClientMode = 'signed',
): Promise<boolean> {
  try {
    const qz = client ?? (await loadQzClient(mode))
    await ensureConnected(qz)
    return qz.websocket.isActive()
  } catch {
    return false
  }
}

export async function listQzPrinters(
  client?: QzClient,
  mode: QzClientMode = 'signed',
): Promise<string[]> {
  const qz = client ?? (await loadQzClient(mode))
  await ensureConnected(qz)
  const result = await qz.printers.find()
  return Array.isArray(result) ? result : [result]
}

export async function printHelloWorldViaQz(printerName: string, client?: QzClient): Promise<void> {
  if (!printerName) throw new Error('QZ_NO_PRINTER_SELECTED')
  const qz = client ?? (await loadQz())
  await ensureConnected(qz)
  const config = qz.configs.create(printerName)
  await qz.print(config, ['Hello World\n', 'Light Ops Assistant QZ Tray POC\n', '\n\n\n'])
}

export async function printReceiptHtmlViaQz(printerName: string, html: string, client?: QzClient): Promise<void> {
  if (!printerName) throw new Error('QZ_NO_PRINTER_SELECTED')
  const qz = client ?? (await loadQz())
  await ensureConnected(qz)
  const config = qz.configs.create(printerName, {
    units: 'in',
    size: { width: QZ_RECEIPT_WIDTH_INCHES },
    margins: 0,
    orientation: 'portrait',
    scaleContent: false,
  })
  await qz.print(config, [{
    type: 'pixel',
    format: 'html',
    flavor: 'plain',
    data: html,
    // QZ auto-sizes HTML height when pageHeight is omitted. Supplying only
    // the 80mm width prevents the default A4 canvas from clipping this roll.
    options: { pageWidth: QZ_RECEIPT_WIDTH_INCHES },
  }])
}

export type QzStatus = 'idle' | 'checking' | 'online' | 'offline'

/**
 * Pure gate deciding whether the QZ path may be used for a given print
 * request. Kept separate from React state so the fallback rule can be
 * unit tested without a browser.
 */
export function shouldUseQzPrint(params: {
  qzPrintEnabled: boolean
  hasKitchenTicket: boolean
  qzStatus: QzStatus
  selectedPrinter: string | null
}): boolean {
  return (
    params.qzPrintEnabled &&
    !params.hasKitchenTicket &&
    params.qzStatus === 'online' &&
    !!params.selectedPrinter
  )
}

/**
 * Single choke point used by the cashier page to submit a customer
 * receipt print. `useQz` must be decided (via shouldUseQzPrint) before
 * calling this function — once a QZ submission starts, this function
 * never calls legacyPrint, whether QZ succeeds or fails. That is what
 * prevents duplicate/automatic browser-print fallback after a QZ print
 * request has already been submitted.
 */
export async function submitDesktopReceiptPrint(params: {
  useQz: boolean
  printerName: string | null
  html: string
  client?: QzClient
  legacyPrint: () => void
}): Promise<{ route: 'qz' | 'legacy'; qzError?: unknown }> {
  if (!params.useQz || !params.printerName) {
    params.legacyPrint()
    return { route: 'legacy' }
  }
  try {
    await printReceiptHtmlViaQz(params.printerName, params.html, params.client)
    return { route: 'qz' }
  } catch (qzError) {
    return { route: 'qz', qzError }
  }
}

/**
 * Submits pre-built ESC/POS bytes as base64 RAW data to one of the two exact
 * field-verified Windows queues. There is no default-printer lookup, browser
 * fallback, retry, or alternate transport in this path.
 */
export async function printEscPosBitImageViaFixedQzQueue(
  kind: QzPrintKind,
  bytes: Uint8Array,
  client?: QzClient,
): Promise<{ kind: QzPrintKind; queueName: string }> {
  const queueName = QZ_PRINT_QUEUES[kind]
  const qz = client ?? (await loadRawQz())
  await ensureFixedQueueConnected(qz, queueName)
  await assertQueueExists(qz, queueName)

  const config = qz.configs.create(queueName)
  try {
    await submitSignedRawPrintRequest(qz, config, [{
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

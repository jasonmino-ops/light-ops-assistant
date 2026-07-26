// Browser Print Adapter for the QZ Tray POC (EP-BR-QZ-01).
//
// Scope: development/staging POC only. QZ Tray is run in "unsigned" mode
// (empty certificate/signature promises), which makes QZ Tray show a
// one-time "Blocked Request" prompt the operator must click Allow on.
// Formal certificate + signature management is a later production
// requirement and is intentionally not built here.
//
// This module owns all qz-tray SDK calls so business pages only need to
// call these functions and never touch the qz-tray library directly.

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

let qzModulePromise: Promise<QzClient> | null = null

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
      qz.security.setCertificatePromise((resolve) => resolve(''))
      qz.security.setSignaturePromise(() => (resolve) => resolve(''))
      return qz
    })
  }
  return qzModulePromise
}

async function ensureConnected(qz: QzClient): Promise<void> {
  if (qz.websocket.isActive()) return
  await qz.websocket.connect({ retries: 1, delay: 0 })
}

export async function detectQzOnline(client?: QzClient): Promise<boolean> {
  try {
    const qz = client ?? (await loadQz())
    await ensureConnected(qz)
    return qz.websocket.isActive()
  } catch {
    return false
  }
}

export async function listQzPrinters(client?: QzClient): Promise<string[]> {
  const qz = client ?? (await loadQz())
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

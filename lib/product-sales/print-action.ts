'use client'

import { openExistingBrowserPrint } from '../browserPrintFallback'
import { getOrCreateEshopTray02PrintIntent, submitEshopTray02CloudPrint, type EshopTray02CloudEnableState, type EshopTray02PrintIntent } from '../eShopTrayCloudClient'
import { renderTicketHtmlToEscPosRaw } from '../qzHtmlBitmapRenderer'
import { ES_TRAY_MAX_COMMAND_BYTES } from '../es-tray-relay/config'
import { apiFetch } from '../api'

// Limits belong to this report caller, not to the shared printing contract.
const PREPARE_TIMEOUT_MS = 15_000
const SUBMIT_TIMEOUT_MS = 15_000

function bounded<T>(run: () => Promise<T>, timeoutMs: number, code: string, abort?: () => void): Promise<T> {
  if (timeoutMs <= 0) { abort?.(); return Promise.reject(new Error(code)) }
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new Error(code)); abort?.() }, Math.max(1, timeoutMs))
  })
  return Promise.race([Promise.resolve().then(run), timeout]).finally(() => clearTimeout(timer))
}

async function documentId(html: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  return `product-sales-report:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
const defaults = {
  render: renderTicketHtmlToEscPosRaw,
  submit: (input: Parameters<typeof submitEshopTray02CloudPrint>[0], signal: AbortSignal) => submitEshopTray02CloudPrint({
    ...input,
    fetchImpl: (path, init) => {
      // The shared client hashes bytes before fetch. A timed-out attempt must
      // never start a late POST when that earlier work eventually completes.
      if (signal.aborted) return Promise.reject(new Error('PRINT_SEND_TIMEOUT'))
      return apiFetch(path, { ...init, signal })
    },
  }),
  browser: openExistingBrowserPrint,
}

// A product-report caller of the same OWNER receipt capability used by
// OrderDetailSheet. No device/order endpoint or new transport is involved.
export function createProductReportPrintAction(deps: Partial<typeof defaults> = {}, limits = { prepareMs: PREPARE_TIMEOUT_MS, submitMs: SUBMIT_TIMEOUT_MS }) {
  const driver = { ...defaults, ...deps }
  let running = false
  let browserPending: object | null = null
  let intent: EshopTray02PrintIntent | null = null
  return async (html: string, state: EshopTray02CloudEnableState) => {
    if (running || state === 'pending') return 'ignored' as const
    if (browserPending) return 'browser-pending' as const
    running = true
    try {
      if (state !== 'enabled') {
        const browserRun = {}
        browserPending = browserRun
        try {
          // Preserve the synchronous popup opening/user gesture. The existing
          // helper bounds readiness and owns afterprint/90s DOM cleanup. Do not
          // race it with a timeout that could leave a late native print alive.
          const result = await driver.browser(html, () => { if (browserPending === browserRun) browserPending = null })
          if (result.status === 'blocked') throw new Error(`PRINT_BROWSER_${result.reason}`)
          return 'browser' as const
        } catch (error) {
          if (browserPending === browserRun) browserPending = null
          const code = error instanceof Error ? error.message : ''
          throw new Error(code.startsWith('PRINT_BROWSER_') ? code : 'PRINT_BROWSER_FAILED')
        }
      }
      let current: EshopTray02PrintIntent
      try {
        const deadline = Date.now() + limits.prepareMs
        const id = await bounded(() => documentId(html), limits.prepareMs, 'PRINT_PREPARE_TIMEOUT')
        current = getOrCreateEshopTray02PrintIntent(intent, id, () => `product-sales-report:${crypto.randomUUID()}`)
        intent = current
        if (!current.commandStream) current.commandStream = await bounded(() => driver.render(html), deadline - Date.now(), 'PRINT_PREPARE_TIMEOUT')
        if (current.commandStream.byteLength > ES_TRAY_MAX_COMMAND_BYTES) throw new Error('PRINT_TOO_LARGE')
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        throw new Error(code === 'PRINT_PREPARE_TIMEOUT' || code === 'PRINT_TOO_LARGE' ? code : 'PRINT_PREPARE_FAILED')
      }
      const controller = new AbortController()
      try {
        await bounded(() => driver.submit({ orderNo: current.orderNo, requestId: current.requestId, commandStream: current.commandStream! }, controller.signal), limits.submitMs, 'PRINT_SEND_TIMEOUT', () => controller.abort())
      } catch (error) {
        throw new Error(error instanceof Error && error.message === 'PRINT_SEND_TIMEOUT' ? 'PRINT_SEND_TIMEOUT' : 'PRINT_SEND_FAILED')
      }
      if (intent === current) intent = null
      return 'submitted' as const
    } finally {
      // On an uncertain response, retain the exact identity and bytes for an
      // explicit retry. Late stage completion cannot continue this pipeline.
      // Browser cleanup retains its own lock, without changing page UI state.
      running = false
    }
  }
}

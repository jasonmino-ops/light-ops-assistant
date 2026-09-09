'use client'

import { openExistingBrowserPrint } from '../browserPrintFallback'
import { getOrCreateEshopTray02PrintIntent, submitEshopTray02CloudPrint, type EshopTray02CloudEnableState, type EshopTray02PrintIntent } from '../eShopTrayCloudClient'
import { renderTicketHtmlToEscPosRaw } from '../qzHtmlBitmapRenderer'
import { ES_TRAY_MAX_COMMAND_BYTES } from '../es-tray-relay/config'

async function documentId(html: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))
  return `product-sales-report:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
const defaults = {
  render: renderTicketHtmlToEscPosRaw,
  submit: submitEshopTray02CloudPrint,
  browser: openExistingBrowserPrint,
}

// A product-report caller of the same OWNER receipt capability used by
// OrderDetailSheet. No device/order endpoint or new transport is involved.
export function createProductReportPrintAction(deps = defaults) {
  let running = false
  let intent: EshopTray02PrintIntent | null = null
  return async (html: string, state: EshopTray02CloudEnableState, onComplete: () => void) => {
    if (running || state === 'pending') return 'ignored' as const
    running = true
    let completed = false
    const complete = () => {
      if (completed) return
      completed = true; running = false; onComplete()
    }
    if (state !== 'enabled') {
      try {
        const result = await deps.browser(html, complete)
        if (result.status === 'blocked') throw new Error('PRINT_FAILED')
        return 'browser' as const
      } catch (error) { complete(); throw error }
    }
    try {
      intent = getOrCreateEshopTray02PrintIntent(intent, await documentId(html), () => `product-sales-report:${crypto.randomUUID()}`)
      if (!intent.commandStream) intent.commandStream = await deps.render(html)
      if (intent.commandStream.byteLength > ES_TRAY_MAX_COMMAND_BYTES) throw new Error('PRINT_TOO_LARGE')
      await deps.submit({ orderNo: intent.orderNo, requestId: intent.requestId, commandStream: intent.commandStream })
      intent = null
      return 'submitted' as const
    } finally {
      // On an uncertain response, retain the exact identity and bytes for an
      // explicit retry. Never fall back to another channel after submission.
      complete()
    }
  }
}

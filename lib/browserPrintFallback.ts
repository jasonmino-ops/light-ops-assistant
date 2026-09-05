export type BrowserPrintBlockReason =
  | 'WINDOW_CLOSED'
  | 'DOCUMENT_NOT_READY'
  | 'FONTS_NOT_READY'
  | 'FONTS_FAILED'
  | 'RECEIPT_ROOT_MISSING'
  | 'PRINTABLE_TEXT_MISSING'
  | 'RECEIPT_MARKERS_MISSING'
  | 'PRINTABLE_LAYOUT_TOO_SMALL'
  | 'READINESS_TIMEOUT'
  | 'PRINT_FAILED'

export type BrowserPrintMetrics = {
  contentPresent: boolean
  layoutWidth: number
  layoutHeight: number
}

export type BrowserPrintResult = BrowserPrintMetrics & (
  | { status: 'printed' }
  | { status: 'blocked'; reason: BrowserPrintBlockReason }
)

export type BrowserPrintReadiness = BrowserPrintMetrics & (
  | { status: 'ready' }
  | { status: 'blocked'; reason: BrowserPrintBlockReason }
)

type BrowserPrintOptions = {
  timeoutMs?: number
  pollIntervalMs?: number
  minimumWidth?: number
  minimumHeight?: number
  afterPrintCleanupTimeoutMs?: number
  hostWindow?: Window
  hostDocument?: Document
}

const DEFAULT_READY_TIMEOUT_MS = 5_000
const DEFAULT_POLL_INTERVAL_MS = 50
const DEFAULT_AFTERPRINT_CLEANUP_TIMEOUT_MS = 90_000
const DEFAULT_MINIMUM_WIDTH = 120
const DEFAULT_MINIMUM_HEIGHT = 80
const MINIMUM_TEXT_LENGTH = 16
const REQUIRED_RECEIPT_SELECTORS = [
  '.meta',
  'table tbody tr',
  '.total-row',
  '.total-value',
] as const

function printableMetrics(root: HTMLElement): BrowserPrintMetrics {
  const bounds = root.getBoundingClientRect()
  const layoutWidth = Math.ceil(Math.max(
    bounds.width,
    root.scrollWidth,
    root.offsetWidth,
    root.clientWidth,
  ))
  const layoutHeight = Math.ceil(Math.max(
    bounds.height,
    root.scrollHeight,
    root.offsetHeight,
    root.clientHeight,
  ))
  const text = (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim()
  const markersPresent = REQUIRED_RECEIPT_SELECTORS.every((selector) => root.querySelector(selector))

  return {
    contentPresent: text.length >= MINIMUM_TEXT_LENGTH && markersPresent,
    layoutWidth,
    layoutHeight,
  }
}

function nextLayoutFrame(targetWindow: Window, hostWindow: Window, fallbackMs: number) {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      hostWindow.clearTimeout(fallbackTimer)
      resolve()
    }
    const fallbackTimer = hostWindow.setTimeout(finish, fallbackMs)
    if (typeof targetWindow.requestAnimationFrame === 'function') {
      targetWindow.requestAnimationFrame(finish)
    }
  })
}

export async function waitForPrintableDocument(
  targetWindow: Window,
  root: () => HTMLElement | null,
  options: BrowserPrintOptions = {},
): Promise<BrowserPrintReadiness> {
  const hostWindow = options.hostWindow ?? window
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const minimumWidth = options.minimumWidth ?? DEFAULT_MINIMUM_WIDTH
  const minimumHeight = options.minimumHeight ?? DEFAULT_MINIMUM_HEIGHT
  const deadline = Date.now() + timeoutMs
  const targetDocument = targetWindow.document
  let fontsReady = !targetDocument.fonts
  let fontsFailed = false
  let stableFrames = 0
  let previousWidth = -1
  let previousHeight = -1
  let lastMetrics: BrowserPrintMetrics = {
    contentPresent: false,
    layoutWidth: 0,
    layoutHeight: 0,
  }

  if (targetDocument.fonts) {
    void Promise.resolve(targetDocument.fonts.ready).then(
      () => { fontsReady = true },
      () => { fontsFailed = true },
    )
  }

  while (Date.now() <= deadline) {
    if (targetWindow.closed) {
      return { status: 'blocked', reason: 'WINDOW_CLOSED', ...lastMetrics }
    }

    const printableRoot = root()
    if (
      targetDocument.readyState === 'complete'
      && fontsReady
      && !fontsFailed
      && printableRoot
    ) {
      lastMetrics = printableMetrics(printableRoot)
      const layoutReady = (
        lastMetrics.layoutWidth >= minimumWidth
        && lastMetrics.layoutHeight >= minimumHeight
      )
      if (lastMetrics.contentPresent && layoutReady) {
        const stable = (
          Math.abs(lastMetrics.layoutWidth - previousWidth) <= 1
          && Math.abs(lastMetrics.layoutHeight - previousHeight) <= 1
        )
        stableFrames = stable ? stableFrames + 1 : 1
        previousWidth = lastMetrics.layoutWidth
        previousHeight = lastMetrics.layoutHeight
        if (stableFrames >= 2) {
          return { status: 'ready', ...lastMetrics }
        }
      } else {
        stableFrames = 0
      }
    } else {
      stableFrames = 0
    }

    await nextLayoutFrame(targetWindow, hostWindow, pollIntervalMs)
  }

  if (fontsFailed) {
    return { status: 'blocked', reason: 'FONTS_FAILED', ...lastMetrics }
  }
  if (targetDocument.readyState !== 'complete') {
    return { status: 'blocked', reason: 'DOCUMENT_NOT_READY', ...lastMetrics }
  }
  if (!fontsReady) {
    return { status: 'blocked', reason: 'FONTS_NOT_READY', ...lastMetrics }
  }
  const printableRoot = root()
  if (!printableRoot) {
    return { status: 'blocked', reason: 'RECEIPT_ROOT_MISSING', ...lastMetrics }
  }
  lastMetrics = printableMetrics(printableRoot)
  if (!lastMetrics.contentPresent) {
    const hasText = (printableRoot.innerText || printableRoot.textContent || '').trim().length >= MINIMUM_TEXT_LENGTH
    return {
      status: 'blocked',
      reason: hasText ? 'RECEIPT_MARKERS_MISSING' : 'PRINTABLE_TEXT_MISSING',
      ...lastMetrics,
    }
  }
  if (lastMetrics.layoutWidth < minimumWidth || lastMetrics.layoutHeight < minimumHeight) {
    return { status: 'blocked', reason: 'PRINTABLE_LAYOUT_TOO_SMALL', ...lastMetrics }
  }
  return { status: 'blocked', reason: 'READINESS_TIMEOUT', ...lastMetrics }
}

function reportBlockedPrint(result: BrowserPrintResult | BrowserPrintReadiness) {
  if (result.status !== 'blocked') return
  console.warn('[browser-print] printable document blocked', {
    PRINT_CONTENT_PRESENT: result.contentPresent ? 'YES' : 'NO',
    PRINT_LAYOUT_WIDTH: result.layoutWidth,
    PRINT_LAYOUT_HEIGHT: result.layoutHeight,
    REASON: result.reason,
  })
}

export async function openExistingBrowserPrint(
  html: string,
  onComplete: () => void,
  options: BrowserPrintOptions = {},
): Promise<BrowserPrintResult> {
  const hostWindow = options.hostWindow ?? window
  const hostDocument = options.hostDocument ?? document
  let completed = false
  const completeOnce = () => {
    if (completed) return
    completed = true
    onComplete()
  }

  const printWindow = hostWindow.open('', '_blank', 'width=420,height=700')
  if (printWindow) {
    try {
      printWindow.document.open()
      printWindow.document.write(html)
      printWindow.document.close()
      const readiness = await waitForPrintableDocument(
        printWindow,
        () => printWindow.document.body,
        { ...options, hostWindow },
      )
      if (readiness.status === 'blocked') {
        reportBlockedPrint(readiness)
        try { printWindow.close() } catch { /* Best-effort blank preview cleanup. */ }
        completeOnce()
        return readiness
      }

      printWindow.focus()
      printWindow.print()
      completeOnce()
      // Preserve the historical preview behavior: the user may close the
      // separate receipt window after the native print dialog completes.
      return { ...readiness, status: 'printed' }
    } catch {
      const failed: BrowserPrintResult = {
        status: 'blocked',
        reason: 'PRINT_FAILED',
        contentPresent: false,
        layoutWidth: 0,
        layoutHeight: 0,
      }
      reportBlockedPrint(failed)
      try { printWindow.close() } catch { /* Best-effort failed preview cleanup. */ }
      completeOnce()
      return failed
    }
  }

  let styleEl: HTMLStyleElement | null = null
  let divEl: HTMLDivElement | null = null
  let cleanupTimer: number | null = null
  const cleanup = () => {
    if (cleanupTimer !== null) {
      hostWindow.clearTimeout(cleanupTimer)
      cleanupTimer = null
    }
    hostWindow.removeEventListener('afterprint', cleanup)
    styleEl?.remove()
    divEl?.remove()
    completeOnce()
  }

  try {
    // Popup-block fallback: stage the receipt offscreen so it can be measured
    // before print media makes it visible.
    styleEl = hostDocument.createElement('style')
    styleEl.id = '__oprint_style'
    styleEl.textContent = '@media print{body>*:not(#__oprint){display:none!important}#__oprint{display:block!important;position:static!important;visibility:visible!important;width:auto!important}}'
    divEl = hostDocument.createElement('div')
    divEl.id = '__oprint'
    divEl.style.cssText = 'display:block;position:fixed;left:-10000px;top:0;width:80mm;visibility:hidden;pointer-events:none'
    divEl.innerHTML = html
    hostDocument.head.appendChild(styleEl)
    hostDocument.body.appendChild(divEl)

    const readiness = await waitForPrintableDocument(
      hostWindow,
      () => divEl,
      { ...options, hostWindow },
    )
    if (readiness.status === 'blocked') {
      reportBlockedPrint(readiness)
      cleanup()
      return readiness
    }

    hostWindow.addEventListener('afterprint', cleanup, { once: true })
    cleanupTimer = hostWindow.setTimeout(
      cleanup,
      options.afterPrintCleanupTimeoutMs ?? DEFAULT_AFTERPRINT_CLEANUP_TIMEOUT_MS,
    )
    hostWindow.print()
    return { ...readiness, status: 'printed' }
  } catch {
    const failed: BrowserPrintResult = {
      status: 'blocked',
      reason: 'PRINT_FAILED',
      contentPresent: false,
      layoutWidth: 0,
      layoutHeight: 0,
    }
    reportBlockedPrint(failed)
    cleanup()
    return failed
  }
}

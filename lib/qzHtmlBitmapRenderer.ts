import { encodeRgbaToEscPosEscStar24 } from './qzEscPosBitImage'

// Both field-verified printers accept a 576-dot ESC * 0x21 image. The HTML
// remains the only ticket template; this module only rasterizes that document
// at the already verified printer width before handing it to the shared
// ESC/POS encoder.
export const QZ_RAW_PRINTABLE_WIDTH_PX = 576

const HTML_RENDER_TIMEOUT_MS = 10_000

export type QzHtmlBitmapRenderTraceEvent =
  | 'RENDER_DOM_MOUNTED'
  | 'FRAME_LOAD_START'
  | 'FRAME_LOAD_DONE'
  | 'FRAME_LOAD_FAILED'
  | 'FONTS_START'
  | 'FONTS_DONE'
  | 'FONTS_FAILED'
  | 'IMAGES_START'
  | 'IMAGES_DONE'
  | 'IMAGES_FAILED'
  | 'RAF_1_START'
  | 'RAF_1_DONE'
  | 'RAF_2_START'
  | 'RAF_2_DONE'
  | 'HTML2CANVAS_IMPORT_START'
  | 'HTML2CANVAS_IMPORT_DONE'
  | 'HTML2CANVAS_IMPORT_FAILED'
  | 'HTML2CANVAS_START'
  | 'HTML2CANVAS_DONE'
  | 'HTML2CANVAS_FAILED'
  | 'PIXEL_ENCODE_START'
  | 'PIXEL_ENCODE_DONE'
  | 'PIXEL_ENCODE_FAILED'

export type QzHtmlBitmapRenderTraceDetails = {
  elapsedMs: number
  canvasWidth?: number
  canvasHeight?: number
  error?: unknown
}

type QzHtmlBitmapRenderOptions = {
  trace?: (event: QzHtmlBitmapRenderTraceEvent, details: QzHtmlBitmapRenderTraceDetails) => void
}

function emitRenderTrace(
  options: QzHtmlBitmapRenderOptions | undefined,
  event: QzHtmlBitmapRenderTraceEvent,
  renderStartedAt: number,
  details: Omit<QzHtmlBitmapRenderTraceDetails, 'elapsedMs'> = {},
) {
  try {
    options?.trace?.(event, {
      elapsedMs: Math.max(0, Date.now() - renderStartedAt),
      ...details,
    })
  } catch {
    // FIELD diagnostics must never affect the existing renderer result.
  }
}

function documentWithBaseUrl(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const base = parsed.createElement('base')
  base.href = `${window.location.origin}/`
  parsed.head.prepend(base)
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}

function removeScreenPreviewCss(document: Document) {
  for (const style of Array.from(document.querySelectorAll('style'))) {
    const sheet = style.sheet
    if (!sheet) continue
    try {
      const printDocumentRules = Array.from(sheet.cssRules).filter((rule) => {
        if (rule.type !== CSSRule.MEDIA_RULE) return true
        const mediaText = (rule as CSSMediaRule).media.mediaText
        return !/(^|,)\s*screen\b/i.test(mediaText)
      })
      style.textContent = printDocumentRules.map((rule) => rule.cssText).join('\n')
    } catch {
      // The formal receipt documents contain only inline same-origin CSS. If a
      // future external sheet is unreadable, leave it unchanged rather than
      // silently altering the ticket template.
    }
  }
}

async function waitForDocumentAssets(
  document: Document,
  options: QzHtmlBitmapRenderOptions | undefined,
  renderStartedAt: number,
) {
  emitRenderTrace(options, 'FONTS_START', renderStartedAt)
  try {
    if (document.fonts) await document.fonts.ready
    emitRenderTrace(options, 'FONTS_DONE', renderStartedAt)
  } catch (error) {
    emitRenderTrace(options, 'FONTS_FAILED', renderStartedAt, { error })
    throw error
  }

  emitRenderTrace(options, 'IMAGES_START', renderStartedAt)
  try {
    await Promise.all(Array.from(document.images).map(async (image) => {
      if (image.complete && image.naturalWidth > 0) return
      try {
        await image.decode()
      } catch {
        throw new Error('QZ_HTML_IMAGE_LOAD_FAILED')
      }
    }))
    emitRenderTrace(options, 'IMAGES_DONE', renderStartedAt)
  } catch (error) {
    emitRenderTrace(options, 'IMAGES_FAILED', renderStartedAt, { error })
    throw error
  }
}

function waitForFrame(frameWindow: Window): Promise<void> {
  return new Promise((resolve) => frameWindow.requestAnimationFrame(() => resolve()))
}

function normalizeCanvasWidth(source: HTMLCanvasElement): HTMLCanvasElement {
  if (source.width === QZ_RAW_PRINTABLE_WIDTH_PX) return source
  const normalized = document.createElement('canvas')
  normalized.width = QZ_RAW_PRINTABLE_WIDTH_PX
  normalized.height = Math.max(
    1,
    Math.round(source.height * QZ_RAW_PRINTABLE_WIDTH_PX / source.width),
  )
  const context = normalized.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('QZ_HTML_CANVAS_UNAVAILABLE')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, normalized.width, normalized.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, normalized.width, normalized.height)
  return normalized
}

/**
 * Renders the exact existing receipt HTML into the field-verified ESC/POS
 * bitmap stream. No browser print window, Pixel job, alternate ticket markup,
 * default-printer lookup, or transport fallback exists here.
 */
export async function renderTicketHtmlToEscPosRaw(
  html: string,
  options?: QzHtmlBitmapRenderOptions,
): Promise<Uint8Array> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('QZ_HTML_RENDER_BROWSER_REQUIRED')
  }
  if (!html.trim()) throw new Error('QZ_HTML_RENDER_EMPTY_DOCUMENT')

  const renderStartedAt = Date.now()
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('sandbox', 'allow-same-origin')
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-10000px',
    top: '0',
    width: '80mm',
    height: '1px',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
  })

  let timeoutId: number | undefined
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      timeoutId = window.setTimeout(
        () => reject(new Error('QZ_HTML_RENDER_TIMEOUT')),
        HTML_RENDER_TIMEOUT_MS,
      )
      frame.addEventListener('load', () => resolve(), { once: true })
      frame.addEventListener('error', () => reject(new Error('QZ_HTML_RENDER_FAILED')), { once: true })
    })
    frame.srcdoc = documentWithBaseUrl(html)
    document.body.appendChild(frame)
    emitRenderTrace(options, 'RENDER_DOM_MOUNTED', renderStartedAt)
    emitRenderTrace(options, 'FRAME_LOAD_START', renderStartedAt)
    try {
      await loaded
      emitRenderTrace(options, 'FRAME_LOAD_DONE', renderStartedAt)
    } catch (error) {
      emitRenderTrace(options, 'FRAME_LOAD_FAILED', renderStartedAt, { error })
      throw error
    }
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)

    const frameDocument = frame.contentDocument
    const frameWindow = frame.contentWindow
    if (!frameDocument || !frameWindow) throw new Error('QZ_HTML_RENDER_FRAME_UNAVAILABLE')

    removeScreenPreviewCss(frameDocument)
    await waitForDocumentAssets(frameDocument, options, renderStartedAt)
    emitRenderTrace(options, 'RAF_1_START', renderStartedAt)
    await waitForFrame(frameWindow)
    emitRenderTrace(options, 'RAF_1_DONE', renderStartedAt)
    emitRenderTrace(options, 'RAF_2_START', renderStartedAt)
    await waitForFrame(frameWindow)
    emitRenderTrace(options, 'RAF_2_DONE', renderStartedAt)

    const ticketNode = frameDocument.body.firstElementChild
    if (!ticketNode || typeof ticketNode.getBoundingClientRect !== 'function') {
      throw new Error('QZ_HTML_RENDER_TICKET_MISSING')
    }
    const ticket = ticketNode as HTMLElement
    const bounds = ticket.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) {
      throw new Error('QZ_HTML_RENDER_TICKET_EMPTY')
    }
    frame.style.height = `${Math.ceil(Math.max(bounds.height, ticket.scrollHeight))}px`

    let html2canvas: typeof import('html2canvas').default
    emitRenderTrace(options, 'HTML2CANVAS_IMPORT_START', renderStartedAt)
    try {
      const module = await import('html2canvas')
      html2canvas = module.default
      emitRenderTrace(options, 'HTML2CANVAS_IMPORT_DONE', renderStartedAt)
    } catch (error) {
      emitRenderTrace(options, 'HTML2CANVAS_IMPORT_FAILED', renderStartedAt, { error })
      throw error
    }

    let source: HTMLCanvasElement
    emitRenderTrace(options, 'HTML2CANVAS_START', renderStartedAt)
    try {
      source = await html2canvas(ticket, {
        backgroundColor: '#fff',
        scale: QZ_RAW_PRINTABLE_WIDTH_PX / bounds.width,
        useCORS: true,
        allowTaint: false,
        logging: false,
        imageTimeout: HTML_RENDER_TIMEOUT_MS,
        scrollX: 0,
        scrollY: 0,
      })
      emitRenderTrace(options, 'HTML2CANVAS_DONE', renderStartedAt, {
        canvasWidth: source.width,
        canvasHeight: source.height,
      })
    } catch (error) {
      emitRenderTrace(options, 'HTML2CANVAS_FAILED', renderStartedAt, { error })
      throw error
    }

    emitRenderTrace(options, 'PIXEL_ENCODE_START', renderStartedAt)
    try {
      const canvas = normalizeCanvasWidth(source)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('QZ_HTML_CANVAS_UNAVAILABLE')
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const commandStream = encodeRgbaToEscPosEscStar24({
        width: canvas.width,
        height: canvas.height,
        rgba: image.data,
      })
      emitRenderTrace(options, 'PIXEL_ENCODE_DONE', renderStartedAt, {
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
      })
      return commandStream
    } catch (error) {
      emitRenderTrace(options, 'PIXEL_ENCODE_FAILED', renderStartedAt, { error })
      throw error
    }
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    frame.remove()
  }
}

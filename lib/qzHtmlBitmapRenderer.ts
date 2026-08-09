import { encodeRgbaToEscPosEscStar24 } from './qzEscPosBitImage'

// Both field-verified printers accept a 576-dot ESC * 0x21 image. The HTML
// remains the only ticket template; this module only rasterizes that document
// at the already verified printer width before handing it to the shared
// ESC/POS encoder.
export const QZ_RAW_PRINTABLE_WIDTH_PX = 576

const HTML_RENDER_TIMEOUT_MS = 10_000

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

async function waitForDocumentAssets(document: Document) {
  if (document.fonts) await document.fonts.ready
  await Promise.all(Array.from(document.images).map(async (image) => {
    if (image.complete && image.naturalWidth > 0) return
    try {
      await image.decode()
    } catch {
      throw new Error('QZ_HTML_IMAGE_LOAD_FAILED')
    }
  }))
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
export async function renderTicketHtmlToEscPosRaw(html: string): Promise<Uint8Array> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('QZ_HTML_RENDER_BROWSER_REQUIRED')
  }
  if (!html.trim()) throw new Error('QZ_HTML_RENDER_EMPTY_DOCUMENT')

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
    await loaded
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)

    const frameDocument = frame.contentDocument
    const frameWindow = frame.contentWindow
    if (!frameDocument || !frameWindow) throw new Error('QZ_HTML_RENDER_FRAME_UNAVAILABLE')

    removeScreenPreviewCss(frameDocument)
    await waitForDocumentAssets(frameDocument)
    await waitForFrame(frameWindow)
    await waitForFrame(frameWindow)

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

    const { default: html2canvas } = await import('html2canvas')
    const source = await html2canvas(ticket, {
      backgroundColor: '#fff',
      scale: QZ_RAW_PRINTABLE_WIDTH_PX / bounds.width,
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: HTML_RENDER_TIMEOUT_MS,
      scrollX: 0,
      scrollY: 0,
    })
    const canvas = normalizeCanvasWidth(source)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('QZ_HTML_CANVAS_UNAVAILABLE')
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    return encodeRgbaToEscPosEscStar24({
      width: canvas.width,
      height: canvas.height,
      rgba: image.data,
    })
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    frame.remove()
  }
}

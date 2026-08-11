import { encodeRgbaToEscPosEscStar24 } from './qzEscPosBitImage'
import {
  QZ_RAW_PRINTABLE_WIDTH_PX,
  type QzHtmlBitmapRenderTraceDetails,
  type QzHtmlBitmapRenderTraceEvent,
} from './qzHtmlBitmapRenderer'

type MountedDomRenderOptions = {
  trace?: (event: QzHtmlBitmapRenderTraceEvent, details: QzHtmlBitmapRenderTraceDetails) => void
}

function emitMountedDomTrace(
  options: MountedDomRenderOptions | undefined,
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
    // FIELD diagnostics must never affect the compatibility render result.
  }
}

function normalizeMountedCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  if (source.width === QZ_RAW_PRINTABLE_WIDTH_PX) return source
  const normalized = document.createElement('canvas')
  normalized.width = QZ_RAW_PRINTABLE_WIDTH_PX
  normalized.height = Math.max(
    1,
    Math.round(source.height * QZ_RAW_PRINTABLE_WIDTH_PX / source.width),
  )
  const context = normalized.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('ES_TRAY_02_MOUNTED_CANVAS_UNAVAILABLE')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, normalized.width, normalized.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, normalized.width, normalized.height)
  return normalized
}

/** FIELD ONLY compatibility path: mounted OrderShareCard -> existing encoder. */
export async function renderMountedOrderShareCardToEscPosRaw(
  ticket: HTMLElement,
  options?: MountedDomRenderOptions,
): Promise<Uint8Array> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('ES_TRAY_02_MOUNTED_RENDER_BROWSER_REQUIRED')
  }
  if (!ticket?.isConnected) throw new Error('ES_TRAY_02_MOUNTED_RECEIPT_MISSING')

  const bounds = ticket.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    throw new Error('ES_TRAY_02_MOUNTED_RECEIPT_EMPTY')
  }

  const renderStartedAt = Date.now()
  emitMountedDomTrace(options, 'RENDER_DOM_MOUNTED', renderStartedAt)

  let html2canvas: typeof import('html2canvas').default
  emitMountedDomTrace(options, 'HTML2CANVAS_IMPORT_START', renderStartedAt)
  try {
    const module = await import('html2canvas')
    html2canvas = module.default
    emitMountedDomTrace(options, 'HTML2CANVAS_IMPORT_DONE', renderStartedAt)
  } catch (error) {
    emitMountedDomTrace(options, 'HTML2CANVAS_IMPORT_FAILED', renderStartedAt, { error })
    throw error
  }

  let source: HTMLCanvasElement
  emitMountedDomTrace(options, 'HTML2CANVAS_START', renderStartedAt)
  try {
    source = await html2canvas(ticket, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#fff',
      logging: false,
    })
    emitMountedDomTrace(options, 'HTML2CANVAS_DONE', renderStartedAt, {
      canvasWidth: source.width,
      canvasHeight: source.height,
    })
  } catch (error) {
    emitMountedDomTrace(options, 'HTML2CANVAS_FAILED', renderStartedAt, { error })
    throw error
  }

  emitMountedDomTrace(options, 'PIXEL_ENCODE_START', renderStartedAt)
  try {
    const canvas = normalizeMountedCanvas(source)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('ES_TRAY_02_MOUNTED_CANVAS_UNAVAILABLE')
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const commandStream = encodeRgbaToEscPosEscStar24({
      width: canvas.width,
      height: canvas.height,
      rgba: image.data,
    })
    emitMountedDomTrace(options, 'PIXEL_ENCODE_DONE', renderStartedAt, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    })
    return commandStream
  } catch (error) {
    emitMountedDomTrace(options, 'PIXEL_ENCODE_FAILED', renderStartedAt, { error })
    throw error
  }
}

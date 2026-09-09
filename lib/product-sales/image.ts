'use client'

import type { ProductSalesResult } from './contract'

// Feature-local use of OrderDetailSheet's existing html2canvas -> PNG pipeline.
// These limits bound allocation; an oversized result is rejected, never cropped.
export function reportImageScale(width: number, height: number) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error('IMAGE_FAILED')
  const scale = Math.min(2, Math.sqrt(8_000_000 / (width * height)), 32767 / width, 32767 / height)
  if (scale < 1) throw new Error('IMAGE_TOO_LARGE')
  return scale
}
export function reportImageFilename(result: ProductSalesResult) {
  return `product-sales-${result.range.dateFrom}-${result.range.dateTo}.png`
}

// Observe late rejections too. Cancel/timeout ends the caller's wait, without
// ever continuing from that old attempt into preview, download or sharing.
export function waitForReportImage<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer); signal.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(value as T)
    }
    const abort = () => finish(new Error('IMAGE_CANCELLED'))
    const timer = setTimeout(() => finish(new Error('IMAGE_TIMEOUT')), timeoutMs)
    promise.then((value) => finish(undefined, value), (error) => finish(error instanceof Error ? error : new Error('IMAGE_FAILED')))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

export async function generateReportImage(node: HTMLElement, signal: AbortSignal, timeoutMs = 15_000): Promise<Blob> {
  let expired = false
  let captured: HTMLCanvasElement | undefined
  let cloneFrames: HTMLIFrameElement[] = []
  const release = () => {
    for (const frame of cloneFrames) frame.remove()
    cloneFrames = []
    if (captured) { captured.width = 0; captured.height = 0; captured = undefined }
  }
  const check = () => { if (expired || signal.aborted || !node.isConnected) throw new Error('IMAGE_CANCELLED') }
  const work = (async () => {
    check()
    const html2canvas = (await import('html2canvas')).default
    check()
    if (document.fonts) await document.fonts.ready
    check()
    const width = Math.ceil(node.getBoundingClientRect().width)
    const height = Math.ceil(node.scrollHeight)
    const scale = reportImageScale(width, height)
    // Own the output before rendering so even an allocation/render failure can
    // release it. html2canvas's supplied-canvas option expects explicit sizing.
    const canvas = document.createElement('canvas'); captured = canvas
    canvas.width = Math.floor(width * scale); canvas.height = Math.floor(height * scale)
    canvas.style.width = `${width}px`; canvas.style.height = `${height}px`
    try {
      // Installed html2canvas 1.4.1 appends its clone synchronously before its
      // first await, but only removes it on success. Capture only frames added
      // by this invocation's synchronous call, never a later global sweep.
      // This preserves pre-existing/concurrent order or report captures.
      const frames = () => Array.from(document.body.querySelectorAll<HTMLIFrameElement>(':scope > iframe.html2canvas-container'))
      const before = new Set(frames())
      let rendering: Promise<HTMLCanvasElement>
      try {
        rendering = html2canvas(node, { canvas, scale, useCORS: true, backgroundColor: '#fff', logging: false, width, height, onclone: () => check() })
      } finally { cloneFrames = frames().filter((frame) => !before.has(frame)) }
      await rendering
      check()
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
        if (value?.size && value.type === 'image/png') resolve(value)
        else reject(new Error('IMAGE_FAILED'))
      }, 'image/png'))
      check()
      return blob
    } finally { release() }
  })()
  try { return await waitForReportImage(work, signal, timeoutMs) }
  finally { expired = true; release() }
}
export function canShareReportImage(file: File) {
  try { return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true }
  catch { return false }
}
export function downloadReportImage(url: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename
  try { document.body.appendChild(anchor); anchor.click() }
  finally { anchor.remove() }
  // Preview owns the blob URL; retain it until close/replacement/unmount so
  // native download and long-press saving can consume it asynchronously.
}

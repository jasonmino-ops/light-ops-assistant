'use client'

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { ProductSalesResult } from '@/lib/product-sales/contract'
import type { ReportLang } from '@/lib/product-sales/copy'
import { IMAGE_COPY } from '@/lib/product-sales/image-copy'
import { canShareReportImage, downloadReportImage, generateReportImage, reportImageFilename, waitForReportImage } from '@/lib/product-sales/image'
import { ReportImageCard } from './ReportImageCard'
import styles from './image.module.css'

type Preview = { url: string; file: File; shareable: boolean }
export default function ReportImage({ result, lang, disabled }: { result: ProductSalesResult; lang: ReportLang; disabled: boolean }) {
  const copy = IMAGE_COPY[lang]
  const card = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const attempt = useRef<AbortController | null>(null)
  const url = useRef<string | null>(null)
  const nativeShare = useRef<Promise<void> | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [busy, setBusy] = useState<'generate' | 'share' | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function clear() {
    attempt.current?.abort(); attempt.current = null
    if (url.current) URL.revokeObjectURL(url.current)
    url.current = null
    setPreview(null); setCaptureOpen(false); setBusy(null); setError(''); setMessage('')
  }
  function close() { clear(); dialog.current?.close() }
  useEffect(() => {
    close()
    return () => { attempt.current?.abort(); if (url.current) URL.revokeObjectURL(url.current); url.current = null }
  }, [result, lang]) // An image cannot outlive the result/language it describes.
  useEffect(() => { if (disabled) close() }, [disabled])

  async function generate() {
    if (disabled || attempt.current) return
    clear()
    const controller = new AbortController(); attempt.current = controller
    setBusy('generate')
    try {
      // Mount only on demand, then measure the actual DOM for html2canvas.
      flushSync(() => setCaptureOpen(true))
      dialog.current?.showModal()
      if (!card.current) throw new Error('IMAGE_FAILED')
      const blob = await generateReportImage(card.current, controller.signal)
      if (controller.signal.aborted || attempt.current !== controller) return
      const file = new File([blob], reportImageFilename(result), { type: 'image/png' })
      const nextUrl = URL.createObjectURL(blob); url.current = nextUrl
      setPreview({ file, url: nextUrl, shareable: canShareReportImage(file) })
    } catch (failure) {
      if (!controller.signal.aborted && attempt.current === controller) {
        const code = failure instanceof Error ? failure.message : ''
        setError(code === 'IMAGE_TIMEOUT' ? copy.timeout : code === 'IMAGE_TOO_LARGE' ? copy.large : copy.failed)
      }
    } finally { if (attempt.current === controller) { attempt.current = null; setBusy(null) } }
  }
  function download() {
    if (!preview || busy) return
    setError(''); setMessage('')
    try { downloadReportImage(preview.url, preview.file.name); setMessage(copy.downloaded) }
    catch { setError(copy.downloadFailed) }
  }
  async function share() {
    if (!preview || attempt.current) return
    setError(''); setMessage('')
    if (nativeShare.current) { setMessage(copy.sharePending); return }
    if (!canShareReportImage(preview.file)) { setError(copy.unavailable); return }
    const controller = new AbortController(); attempt.current = controller; setBusy('share')
    try {
      // Invoke directly from this click, after PNG preparation, preserving the
      // browser's user activation. Never auto-share or auto-download on failure.
      const pending = navigator.share({ files: [preview.file] }); nativeShare.current = pending
      void pending.then(() => { if (nativeShare.current === pending) nativeShare.current = null }, () => { if (nativeShare.current === pending) nativeShare.current = null })
      await waitForReportImage(pending, controller.signal, 30_000)
      if (!controller.signal.aborted && attempt.current === controller) setMessage(copy.shared)
    } catch (failure) {
      if (!controller.signal.aborted && attempt.current === controller) {
        if (failure instanceof Error && failure.name === 'AbortError') setMessage(copy.cancelled)
        else setError(failure instanceof Error && failure.message === 'IMAGE_TIMEOUT' ? copy.sharePending : copy.shareFailed)
      }
    } finally { if (attempt.current === controller) { attempt.current = null; setBusy(null) } }
  }
  return <>
    <button type="button" disabled={disabled || !!busy} onClick={generate}>{copy.generate}</button>
    {error && !dialog.current?.open && <p role="alert" className={styles.error}>{error}</p>}
    {captureOpen && <div className={styles.capture} aria-hidden="true"><ReportImageCard ref={card} result={result} lang={lang} /></div>}
    <dialog ref={dialog} className={styles.dialog} aria-label={copy.preview} onCancel={clear} onClose={() => { if (!dialog.current?.open) clear() }}>
      <div className={styles.header}><h3>{copy.preview}</h3><button type="button" onClick={close}>{copy.close}</button></div>
      {busy && <p role="status" className={styles.note}>{busy === 'generate' ? copy.generating : copy.sharing}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {message && <p role="status" className={styles.note}>{message}</p>}
      {preview && <>
        {/* A blob URL deliberately bypasses remote image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview.url} alt={copy.preview} className={styles.preview} />
        <p className={styles.note}>{copy.saveHint}</p>
        {!preview.shareable && <p className={styles.note}>{copy.unavailable}</p>}
        <div className={styles.actions}>
          <button type="button" disabled={!!busy} onClick={download}>{copy.download}</button>
          {preview.shareable && <button type="button" disabled={!!busy} onClick={share}>{copy.share}</button>}
        </div>
      </>}
      {!preview && !busy && <button type="button" onClick={generate}>{copy.generate}</button>}
    </dialog>
  </>
}

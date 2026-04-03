'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  onScanned: (barcode: string) => void
  onClose: () => void
  /**
   * Called the moment camera fails to start (HTTPS missing, no device,
   * permission denied, etc.). Parent may choose to close the scanner and
   * trigger a fallback (e.g. Telegram showScanQrPopup).
   * If not provided, the error is shown inside the scanner component only.
   */
  onCameraError?: (errorMsg: string) => void
}

type ScanState = 'loading' | 'active' | 'scanned' | 'error'

// ─── Component ────────────────────────────────────────────────────────────────

export default function BarcodeScanner({ onScanned, onClose, onCameraError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const doneRef = useRef(false) // prevent double-fire

  const [scanState, setScanState] = useState<ScanState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [scannedText, setScannedText] = useState<string>('')

  // Stable callback to hand to ZXing — avoids re-mounting the effect
  const handleResult = useCallback(
    (text: string) => {
      if (doneRef.current) return
      doneRef.current = true
      controlsRef.current?.stop()
      // Show "scanned" confirmation for 800ms before firing onScanned
      setScannedText(text)
      setScanState('scanned')
      setTimeout(() => onScanned(text), 800)
    },
    [onScanned],
  )

  useEffect(() => {
    let cancelled = false

    function reportError(msg: string) {
      if (cancelled) return
      setErrorMsg(msg)
      setScanState('error')
      onCameraError?.(msg)
    }

    async function init() {
      // ── 1. HTTPS guard ────────────────────────────────────────────────────
      const secure =
        window.location.protocol === 'https:' ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      if (!secure) {
        reportError('摄像头扫码需要 HTTPS 连接，请通过安全链接访问')
        return
      }

      // ── 2. getUserMedia support guard ─────────────────────────────────────
      if (!navigator.mediaDevices?.getUserMedia) {
        reportError('当前浏览器不支持摄像头访问')
        return
      }

      // ── 3. Start ZXing scanner (dynamic import — not bundled until needed) ─
      try {
        const { BrowserMultiFormatReader, BarcodeFormat } = await import('@zxing/browser')
        const { DecodeHintType } = await import('@zxing/library')
        if (cancelled || !videoRef.current) return

        // Restrict to 1D barcodes only — QR codes and 2D formats are not supported
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.ITF,
          BarcodeFormat.CODABAR,
        ])
        const reader = new BrowserMultiFormatReader(hints)
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: 'environment' } },
          videoRef.current,
          (result, err) => {
            if (result) {
              const text = result.getText()
              if (text) handleResult(text)
              return
            }
            // NotFoundException fires every frame with no barcode — safe to ignore
            if (err && err.name !== 'NotFoundException') {
              const msg =
                err.name === 'NotAllowedError'
                  ? '摄像头权限被拒绝，请在系统/浏览器设置中允许'
                  : err.name === 'NotReadableError'
                  ? '摄像头被其他应用占用，请关闭后重试'
                  : `摄像头错误（${err.name}）`
              reportError(msg)
            }
          },
        )

        if (cancelled) { controls.stop(); return }
        controlsRef.current = controls
        setScanState('active')
      } catch (e: unknown) {
        const name = (e as Error)?.name ?? 'UnknownError'
        const msg =
          name === 'NotAllowedError'
            ? '摄像头权限被拒绝，请在系统/浏览器设置中允许'
            : name === 'NotFoundError'
            ? '未找到摄像头设备'
            : name === 'NotReadableError'
            ? '摄像头被其他应用占用，请关闭后重试'
            : `摄像头启动失败（${name}）`
        reportError(msg)
      }
    }

    init()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
    }
  }, [handleResult, onCameraError])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.overlay}>
      <div style={s.sheet}>
        {/* Header */}
        <div style={s.header}>
          <span style={s.title}>扫描商品条码</span>
          <button style={s.closeBtn} type="button" onClick={onClose}>✕</button>
        </div>

        {/* Viewport */}
        <div style={s.viewport}>
          <video ref={videoRef} style={s.video} autoPlay playsInline muted />

          {(scanState === 'active') && (
            <div style={s.frameWrap}>
              <div style={s.frame} />
              <div style={s.frameHint}>将商品条码对准框内</div>
            </div>
          )}

          {scanState === 'scanned' && (
            <div style={s.scannedLayer}>
              <div style={s.scannedCheck}>✓</div>
              <div style={s.scannedLabel}>已识别</div>
              <div style={s.scannedCode}>{scannedText}</div>
            </div>
          )}

          {scanState === 'loading' && (
            <div style={s.stateLayer}>
              <div style={s.stateText}>摄像头启动中…</div>
            </div>
          )}

          {scanState === 'error' && (
            <div style={s.stateLayer}>
              <div style={s.errIcon}>📷</div>
              <div style={s.errText}>{errorMsg}</div>
              <button style={s.errBtn} type="button" onClick={onClose}>关闭</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.78)',
    zIndex: 600,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: 480,
    background: '#000',
    borderRadius: '16px 16px 0 0',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 16px',
    background: '#111',
  },
  title: {
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#999',
    fontSize: 20,
    padding: '0 4px',
    lineHeight: 1,
  },
  viewport: {
    position: 'relative',
    width: '100%',
    aspectRatio: '1 / 1',
    background: '#0a0a0a',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  // Scanning overlay: dim everything outside the frame box
  frameWrap: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    pointerEvents: 'none',
  },
  frame: {
    width: '74%',
    height: '26%', // wide, short frame for 1D barcodes only (EAN-13, Code128, UPC etc.)
    border: '2px solid rgba(255,255,255,0.9)',
    borderRadius: 6,
    // Shadow makes everything outside the frame darker
    boxShadow: '0 0 0 2000px rgba(0,0,0,0.42)',
  },
  frameHint: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    background: 'rgba(0,0,0,0.52)',
    padding: '4px 14px',
    borderRadius: 20,
  },
  stateLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    background: '#0a0a0a',
    padding: 24,
  },
  stateText: {
    fontSize: 14,
    color: '#777',
  },
  scannedLayer: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    background: 'rgba(0,0,0,0.82)',
  },
  scannedCheck: {
    width: 60,
    height: 60,
    borderRadius: '50%',
    background: '#52c41a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 30,
    color: '#fff',
    fontWeight: 700,
  },
  scannedLabel: {
    fontSize: 16,
    fontWeight: 700,
    color: '#52c41a',
  },
  scannedCode: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    fontFamily: 'monospace',
    maxWidth: 260,
    textAlign: 'center' as const,
    wordBreak: 'break-all' as const,
    padding: '0 16px',
  },
  errIcon: {
    fontSize: 42,
    opacity: 0.35,
  },
  errText: {
    fontSize: 14,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 1.6,
    maxWidth: 240,
  },
  errBtn: {
    marginTop: 8,
    padding: '10px 28px',
    background: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: 20,
    color: '#fff',
    fontSize: 14,
  },
}

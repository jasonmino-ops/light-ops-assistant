'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  onScanned: (barcode: string) => void
  onClose: () => void
  onCameraError?: (errorMsg: string) => void
}

type ScanState = 'loading' | 'active' | 'scanned' | 'error'

// ─── Constants ────────────────────────────────────────────────────────────────

// ROI：只解码中心扫描框区域，降低全画面背景干扰
// 对应视觉 frame（74% 宽 × 26% 高）并留少量余量
const ROI_X_RATIO = 0.10   // 从视频宽度 10% 处开始
const ROI_Y_RATIO = 0.28   // 从视频高度 28% 处开始
const ROI_W_RATIO = 0.80   // 取视频宽度的 80%
const ROI_H_RATIO = 0.44   // 取视频高度的 44%（宽松包住条码区）

// 解码画布最大宽度（超出则等比缩小，提升性能）
const MAX_CANVAS_W = 640

// 安卓适度提升扫码频率（6~7fps），其他平台 5fps
const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
const FRAME_INTERVAL_MS = isAndroid ? 150 : 200

// ─── Component ────────────────────────────────────────────────────────────────

export default function BarcodeScanner({ onScanned, onClose, onCameraError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const doneRef = useRef(false)

  const [scanState, setScanState] = useState<ScanState>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [scannedText, setScannedText] = useState<string>('')

  const handleResult = useCallback(
    (text: string) => {
      if (doneRef.current) return
      doneRef.current = true
      controlsRef.current?.stop()
      // 震动反馈：成功识别后轻震 60ms（安卓有效，iOS/不支持环境静默跳过）
      try { navigator.vibrate?.(60) } catch { /* ignore */ }
      setScannedText(text)
      setScanState('scanned')
      setTimeout(() => onScanned(text), 800)
    },
    [onScanned],
  )

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let intervalId: ReturnType<typeof setInterval> | null = null

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

      // ── 3. Acquire stream ─────────────────────────────────────────────────
      // 720p 分辨率：画质足够识别小条码，不会过大影响性能
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
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
        return
      }

      if (cancelled || !videoRef.current) { stream.getTracks().forEach(t => t.stop()); return }

      // ── 4. 请求连续自动对焦（近距离/小商品码场景）────────────────────────
      // 失败静默跳过，不影响扫码启动
      const track = stream.getVideoTracks()[0]
      if (track) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (track as any).applyConstraints({
            advanced: [{ focusMode: 'continuous' }],
          })
        } catch { /* device/browser does not support focusMode constraint */ }
      }

      const video = videoRef.current
      video.srcObject = stream
      try { await video.play() } catch { /* ignore interrupted play */ }

      // ── 5. Wait for video dimensions ──────────────────────────────────────
      await new Promise<void>((resolve) => {
        function poll() {
          if (cancelled) { resolve(); return }
          if (video.videoWidth > 0 && video.videoHeight > 0) { resolve(); return }
          requestAnimationFrame(poll)
        }
        requestAnimationFrame(poll)
      })

      if (cancelled || !videoRef.current) return

      // ── 6. Build ROI canvas ───────────────────────────────────────────────
      const vw = video.videoWidth
      const vh = video.videoHeight
      const srcX = Math.round(vw * ROI_X_RATIO)
      const srcY = Math.round(vh * ROI_Y_RATIO)
      const srcW = Math.round(vw * ROI_W_RATIO)
      const srcH = Math.round(vh * ROI_H_RATIO)

      // 画布等比缩小（如需），避免高分辨率摄像头导致解码慢
      const scale = Math.min(1, MAX_CANVAS_W / srcW)
      const canvasW = Math.round(srcW * scale)
      const canvasH = Math.round(srcH * scale)

      const canvas = document.createElement('canvas')
      canvas.width = canvasW
      canvas.height = canvasH
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!

      // ── 7. Load ZXing ─────────────────────────────────────────────────────
      try {
        const { BrowserMultiFormatReader, BarcodeFormat } = await import('@zxing/browser')
        const { DecodeHintType } = await import('@zxing/library')
        if (cancelled || !videoRef.current) return

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

        // ── 8. 定时抽帧 → ROI 裁剪 → 解码 ───────────────────────────────────
        intervalId = setInterval(() => {
          if (cancelled || !videoRef.current || video.readyState < 2) return
          // 只绘制中心 ROI 区域到 canvas
          ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, canvasW, canvasH)
          try {
            const result = reader.decodeFromCanvas(canvas)
            const text = result?.getText?.()
            if (text) handleResult(text)
          } catch {
            // NotFoundException (no barcode in this frame) — expected, ignore
          }
        }, FRAME_INTERVAL_MS)

        if (cancelled) { clearInterval(intervalId); return }
        controlsRef.current = { stop: () => { if (intervalId) clearInterval(intervalId) } }
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
      if (intervalId) clearInterval(intervalId)
      controlsRef.current?.stop()
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [handleResult, onCameraError])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={s.overlay}>
      <div style={s.sheet}>
        <div style={s.header}>
          <span style={s.title}>扫描商品条码</span>
          <button style={s.closeBtn} type="button" onClick={onClose}>✕</button>
        </div>

        <div style={s.viewport}>
          <video ref={videoRef} style={s.video} autoPlay playsInline muted />

          {scanState === 'active' && (
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
    height: '26%',
    border: '2px solid rgba(255,255,255,0.9)',
    borderRadius: 6,
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

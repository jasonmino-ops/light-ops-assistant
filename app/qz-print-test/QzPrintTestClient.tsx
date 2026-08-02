'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { renderDesktopReceiptHtml, type DesktopReceiptData } from '@/app/components/DesktopReceipt'
import { renderKitchenTicketHtml, type KitchenTicketData } from '@/app/components/KitchenTicket'
import {
  detectQzOnline,
  listQzPrinters,
  printEscPosBitImageViaFixedQzQueue,
  printHtmlViaFixedQzQueue,
  QZ_PRINT_QUEUES,
  QzPrintError,
  type QzPrintKind,
  type QzStatus,
} from '@/lib/qzPrinterAdapter'
import { encodeRgbaToEscPosEscStar24 } from '@/lib/qzEscPosBitImage'

type PrintState = {
  status: 'idle' | 'printing' | 'success' | 'error'
  message: string
}

type TestCaseId = 'customer-front' | 'customer-kitchen' | 'kitchen-front' | 'kitchen-kitchen'
type DocumentKind = 'customer' | 'kitchen'

type FixedTestCase = {
  id: TestCaseId
  label: string
  documentKind: DocumentKind
  queueKind: QzPrintKind
  color: string
}

const INITIAL_PRINT_STATE: PrintState = { status: 'idle', message: '' }
const INITIAL_RAW_STATES: Record<QzPrintKind, PrintState> = {
  receipt: INITIAL_PRINT_STATE,
  kitchen: INITIAL_PRINT_STATE,
}
const QZ_STATUS_TIMEOUT_MS = 8_000
const FIXED_CREATED_AT = '2026-08-02T00:00:00.000Z'
const RAW_TEST_IMAGE_WIDTH = 576
const RAW_TEST_IMAGE_HEIGHT = 288
const RAW_TEST_ACTIONS: ReadonlyArray<{ kind: QzPrintKind; label: string; color: string }> = [
  { kind: 'receipt', label: '前台 RAW 位图测试', color: '#111827' },
  { kind: 'kitchen', label: '厨房 RAW 位图测试', color: '#374151' },
]
const FIXED_TEST_CASES: readonly FixedTestCase[] = [
  { id: 'customer-front', label: 'A｜顾客票 → 前台', documentKind: 'customer', queueKind: 'receipt', color: '#2563eb' },
  { id: 'customer-kitchen', label: 'B｜顾客票 → 厨房', documentKind: 'customer', queueKind: 'kitchen', color: '#0f766e' },
  { id: 'kitchen-front', label: 'C｜厨房票 → 前台', documentKind: 'kitchen', queueKind: 'receipt', color: '#7c3aed' },
  { id: 'kitchen-kitchen', label: 'D｜厨房票 → 厨房', documentKind: 'kitchen', queueKind: 'kitchen', color: '#ea580c' },
]

const INITIAL_TEST_STATES: Record<TestCaseId, PrintState> = {
  'customer-front': INITIAL_PRINT_STATE,
  'customer-kitchen': INITIAL_PRINT_STATE,
  'kitchen-front': INITIAL_PRINT_STATE,
  'kitchen-kitchen': INITIAL_PRINT_STATE,
}

async function withStatusTimeout<T>(operation: Promise<T>): Promise<T> {
  return Promise.race([
    operation,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('QZ_STATUS_TIMEOUT')), QZ_STATUS_TIMEOUT_MS)
    }),
  ])
}

function customerTestReceipt(): DesktopReceiptData {
  return {
    storeName: 'E-Shop QZ 安全测试',
    orderNo: 'QZ-PRINT-01D-CUSTOMER',
    createdAt: FIXED_CREATED_AT,
    cashierName: 'Preview Test',
    paymentMethod: 'TEST ONLY',
    totalAmount: 0,
    currencyCode: 'USD',
    items: [{
      name: '顾客测试票',
      spec: 'QZ-PRINT-01D 固定对照样本 · 不创建交易',
      qty: 1,
      price: 0,
      lineAmount: 0,
    }],
  }
}

function kitchenTestTicket(): KitchenTicketData {
  return {
    storeName: 'E-Shop QZ 安全测试',
    orderNo: 'QZ-PRINT-01D-KITCHEN',
    createdAt: FIXED_CREATED_AT,
    items: [{
      name: '厨房测试票',
      spec: 'QZ-PRINT-01D 固定对照样本 · 不含金额、价格或支付信息',
      qty: 1,
    }],
  }
}

async function buildFixedEscPosRawTestImage(): Promise<Uint8Array> {
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = RAW_TEST_IMAGE_WIDTH
  canvas.height = RAW_TEST_IMAGE_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('RAW_TEST_CANVAS_UNAVAILABLE')

  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#000'
  context.font = '900 30px Arial, "Microsoft YaHei", "SimHei", sans-serif'
  context.fillText('E-Shop ESC/POS IMAGE TEST', canvas.width / 2, 36)
  context.font = '900 34px "Courier New", monospace'
  context.fillText('1234567890', canvas.width / 2, 82)
  context.font = '900 34px "Microsoft YaHei", "SimHei", sans-serif'
  context.fillText('中文测试', canvas.width / 2, 130)
  context.fillRect(24, 164, canvas.width - 48, 5)
  context.fillRect(74, 190, canvas.width - 148, 70)
  context.fillStyle = '#fff'
  context.font = '900 30px Arial, "Microsoft YaHei", "SimHei", sans-serif'
  context.fillText('BOLD  粗体区域', canvas.width / 2, 225)

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  return encodeRgbaToEscPosEscStar24({
    width: canvas.width,
    height: canvas.height,
    rgba: image.data,
  })
}

function errorMessage(kind: QzPrintKind, error: unknown) {
  const queueName = QZ_PRINT_QUEUES[kind]
  const code = error instanceof QzPrintError ? error.code : 'QZ_PRINT_FAILED'
  if (code === 'QZ_UNAVAILABLE') return 'QZ Tray 不可用，请确认 QZ Tray 2.2.6 正在运行'
  if (code === 'QZ_QUEUE_NOT_FOUND') return `未找到 Windows 打印队列“${queueName}”`
  return `提交到“${queueName}”失败，请检查该队列后重试`
}

export default function QzPrintTestClient({ previewCommit }: { previewCommit: string }) {
  const [qzStatus, setQzStatus] = useState<QzStatus>('checking')
  const [printers, setPrinters] = useState<string[]>([])
  const [statusMessage, setStatusMessage] = useState('正在检测 QZ Tray…')
  const [testStates, setTestStates] = useState<Record<TestCaseId, PrintState>>(INITIAL_TEST_STATES)
  const [rawStates, setRawStates] = useState<Record<QzPrintKind, PrintState>>(INITIAL_RAW_STATES)
  const rawInFlight = useRef<Set<QzPrintKind>>(new Set())
  const rawBitmapBytes = useRef<Promise<Uint8Array> | null>(null)

  const refreshStatus = useCallback(async () => {
    setQzStatus('checking')
    setStatusMessage('正在检测 QZ Tray…')
    try {
      const online = await withStatusTimeout(detectQzOnline())
      if (!online) {
        setQzStatus('offline')
        setPrinters([])
        setStatusMessage('QZ Tray 不可用，请确认 QZ Tray 2.2.6 正在运行')
        return
      }
      const nextPrinters = await withStatusTimeout(listQzPrinters())
      setQzStatus('online')
      setPrinters(nextPrinters)
      setStatusMessage(`QZ Tray 在线，检测到 ${nextPrinters.length} 个 Windows 打印队列`)
    } catch {
      setQzStatus('offline')
      setPrinters([])
      setStatusMessage('QZ Tray 状态检测失败，请确认 QZ Tray 正在运行')
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  async function submitFixedTest(testCase: FixedTestCase) {
    const current = testStates[testCase.id]
    if (current.status === 'printing') return
    const setState = (next: PrintState) => {
      setTestStates((previous) => ({ ...previous, [testCase.id]: next }))
    }
    const queueName = QZ_PRINT_QUEUES[testCase.queueKind]
    if (qzStatus !== 'online') {
      setState({ status: 'error', message: 'QZ Tray 不可用，请先确认 QZ Tray 在线并刷新状态' })
      return
    }
    if (!printers.includes(queueName)) {
      setState({ status: 'error', message: `未找到 Windows 打印队列“${queueName}”` })
      return
    }
    setState({ status: 'printing', message: '' })
    try {
      const html = testCase.documentKind === 'customer'
        ? renderDesktopReceiptHtml(customerTestReceipt(), 'zh')
        : renderKitchenTicketHtml(kitchenTestTicket(), 'zh')
      await printHtmlViaFixedQzQueue(testCase.queueKind, html)
      setState({ status: 'success', message: `已提交到“${queueName}”` })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(testCase.queueKind, error) })
    }
  }

  async function submitRawBitmapTest(kind: QzPrintKind) {
    if (rawInFlight.current.has(kind)) return
    const queueName = QZ_PRINT_QUEUES[kind]
    const setState = (next: PrintState) => {
      setRawStates((previous) => ({ ...previous, [kind]: next }))
    }
    if (qzStatus !== 'online') {
      setState({ status: 'error', message: `“${queueName}”：QZ Tray 不可用，请先确认 QZ Tray 在线并刷新状态` })
      return
    }
    if (!printers.includes(queueName)) {
      setState({ status: 'error', message: `未找到 Windows 打印队列“${queueName}”` })
      return
    }

    rawInFlight.current.add(kind)
    setState({ status: 'printing', message: '' })
    try {
      if (!rawBitmapBytes.current) rawBitmapBytes.current = buildFixedEscPosRawTestImage()
      let bytes: Uint8Array
      try {
        bytes = await rawBitmapBytes.current
      } catch (error) {
        rawBitmapBytes.current = null
        throw error
      }
      await printEscPosBitImageViaFixedQzQueue(kind, bytes)
      setState({ status: 'success', message: `ESC * 0x21 RAW 已提交到“${queueName}”（${bytes.length} bytes）` })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(kind, error) })
    } finally {
      rawInFlight.current.delete(kind)
    }
  }

  const statusLabel = qzStatus === 'online' ? '在线' : qzStatus === 'checking' ? '检测中' : '离线'

  return (
    <main style={styles.page}>
      <section style={styles.card} data-qz-print-test-page="QZ-PRINT-02A">
        <header style={styles.header}>
          <div style={styles.eyebrow}>QZ-PRINT-02A</div>
          <h1 style={styles.title}>ESC/POS RAW 位图最小验证</h1>
          <div style={styles.meta}>Commit: {previewCommit}</div>
          <div style={styles.meta}>Environment: Preview</div>
          <div style={styles.meta}>Mode: ESC * 0x21 / QZ RAW / Fixed Bitmap</div>
        </header>

        <section style={styles.section}>
          <div style={styles.sectionHeading}>
            <div>
              <div style={styles.sectionTitle}>QZ 连接状态</div>
              <div data-qz-status={qzStatus} style={{ ...styles.status, color: qzStatus === 'online' ? '#166534' : qzStatus === 'offline' ? '#b91c1c' : '#92400e' }}>
                {statusLabel}
              </div>
            </div>
            <button type="button" style={styles.secondaryButton} onClick={() => void refreshStatus()} disabled={qzStatus === 'checking'}>
              {qzStatus === 'checking' ? '检测中…' : '刷新状态'}
            </button>
          </div>
          <div style={styles.message}>{statusMessage}</div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionTitle}>Windows 打印机枚举结果</div>
          {printers.length > 0 ? (
            <ul data-qz-printer-list style={styles.printerList}>
              {printers.map((printerName) => (
                <li key={printerName} style={styles.printerItem}>{printerName}</li>
              ))}
            </ul>
          ) : (
            <div data-qz-printer-list-empty style={styles.empty}>尚未枚举到打印机</div>
          )}
        </section>

        <section style={styles.section}>
          <div style={styles.sectionTitle}>ESC/POS RAW 固定黑白图</div>
          <div style={styles.message}>
            同一张 {RAW_TEST_IMAGE_WIDTH}×{RAW_TEST_IMAGE_HEIGHT} 黑白测试图，经浏览器单色化后编码为 ESC * 0x21；不经过 QZ Pixel，不调用浏览器打印。
          </div>
          <div style={styles.actionGrid}>
            {RAW_TEST_ACTIONS.map((action) => {
              const state = rawStates[action.kind]
              return (
                <div key={action.kind}>
                  <button
                    type="button"
                    data-qz-raw-action={action.kind}
                    style={{ ...styles.primaryButton, width: '100%', background: action.color }}
                    disabled={state.status === 'printing'}
                    onClick={() => void submitRawBitmapTest(action.kind)}
                  >
                    {state.status === 'printing' ? '提交中…' : action.label}
                  </button>
                  {state.message && (
                    <div data-qz-raw-result={action.kind} style={{ ...styles.result, color: state.status === 'error' ? '#b91c1c' : '#166534' }}>
                      {state.message}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section style={styles.section}>
          <div style={styles.sectionTitle}>固定队列测试</div>
          <div style={styles.message}>保留的 QZ Pixel 四票对照入口（QZ-PRINT-01D），本轮未删除或替换。</div>
          <div style={styles.actionGrid}>
            {FIXED_TEST_CASES.map((testCase) => {
              const state = testStates[testCase.id]
              return (
                <div key={testCase.id}>
                  <button
                    type="button"
                    data-qz-test-action={testCase.id}
                    style={{ ...styles.primaryButton, width: '100%', background: testCase.color }}
                    disabled={state.status === 'printing'}
                    onClick={() => void submitFixedTest(testCase)}
                  >
                    {state.status === 'printing' ? '提交中…' : testCase.label}
                  </button>
                  {state.message && (
                    <div data-qz-test-result={testCase.id} style={{ ...styles.result, color: state.status === 'error' ? '#b91c1c' : '#166534' }}>
                      {state.message}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <footer style={styles.footer}>
          本页面不读取或创建真实订单、支付、商品、库存、顾客或 Computer Binding 数据；RAW 与 Pixel 均只允许固定队列，失败时不会回退浏览器打印。
        </footer>
      </section>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100dvh', background: '#e2e8f0', padding: '28px 16px', fontFamily: 'system-ui,-apple-system,sans-serif', color: '#0f172a' },
  card: { width: 'min(720px, 100%)', margin: '0 auto', borderRadius: 18, background: '#fff', boxShadow: '0 22px 60px rgba(15,23,42,.16)', overflow: 'hidden' },
  header: { padding: '24px 24px 20px', background: '#0f172a', color: '#fff' },
  eyebrow: { display: 'inline-block', padding: '5px 10px', borderRadius: 999, background: '#2563eb', fontSize: 12, fontWeight: 900, letterSpacing: '.08em' },
  title: { margin: '12px 0 10px', fontSize: 25, lineHeight: 1.2 },
  meta: { fontFamily: 'monospace', fontSize: 12, lineHeight: 1.55, color: '#cbd5e1' },
  section: { padding: 20, borderBottom: '1px solid #e2e8f0' },
  sectionHeading: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { fontSize: 15, fontWeight: 900 },
  status: { marginTop: 3, fontSize: 12, fontWeight: 800 },
  message: { marginTop: 10, padding: 10, borderRadius: 10, background: '#f8fafc', fontSize: 12, lineHeight: 1.5 },
  secondaryButton: { minHeight: 38, padding: '0 14px', border: '1px solid #94a3b8', borderRadius: 9, background: '#fff', color: '#334155', fontWeight: 800, cursor: 'pointer' },
  printerList: { margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 7 },
  printerItem: { padding: '9px 11px', borderRadius: 9, background: '#f1f5f9', border: '1px solid #e2e8f0', fontFamily: 'monospace', fontSize: 12 },
  empty: { marginTop: 10, padding: 11, borderRadius: 9, background: '#f8fafc', color: '#64748b', fontSize: 12 },
  actionGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 },
  primaryButton: { minHeight: 52, border: 'none', borderRadius: 11, color: '#fff', padding: '9px 12px', fontSize: 14, fontWeight: 900, cursor: 'pointer' },
  result: { marginTop: 9, padding: 9, borderRadius: 9, background: '#f8fafc', fontSize: 12, fontWeight: 700, lineHeight: 1.45 },
  footer: { padding: 18, background: '#f8fafc', color: '#64748b', fontSize: 11, lineHeight: 1.55 },
}

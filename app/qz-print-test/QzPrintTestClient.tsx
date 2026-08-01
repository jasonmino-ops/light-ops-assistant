'use client'

import { useCallback, useEffect, useState } from 'react'
import { renderDesktopReceiptHtml, type DesktopReceiptData } from '@/app/components/DesktopReceipt'
import { renderKitchenTicketHtml, type KitchenTicketData } from '@/app/components/KitchenTicket'
import {
  detectQzOnline,
  listQzPrinters,
  printCustomerReceiptViaQz,
  printKitchenTicketViaQz,
  QZ_PRINT_QUEUES,
  QzPrintError,
  type QzPrintKind,
  type QzStatus,
} from '@/lib/qzPrinterAdapter'

type PrintState = {
  status: 'idle' | 'printing' | 'success' | 'error'
  message: string
}

const INITIAL_PRINT_STATE: PrintState = { status: 'idle', message: '' }
const QZ_STATUS_TIMEOUT_MS = 8_000

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
    orderNo: 'QZ-PRINT-01C-CUSTOMER',
    createdAt: new Date().toISOString(),
    cashierName: 'Preview Test',
    paymentMethod: 'TEST ONLY',
    totalAmount: 0,
    currencyCode: 'USD',
    items: [{
      name: '顾客测试票',
      spec: '固定队列：前台 · 不创建交易',
      qty: 1,
      price: 0,
      lineAmount: 0,
    }],
  }
}

function kitchenTestTicket(): KitchenTicketData {
  return {
    storeName: 'E-Shop QZ 安全测试',
    orderNo: 'QZ-PRINT-01C-KITCHEN',
    createdAt: new Date().toISOString(),
    items: [{
      name: '厨房测试票',
      spec: '固定队列：厨房 · 不含金额、价格或支付信息',
      qty: 1,
    }],
  }
}

function errorMessage(kind: QzPrintKind, error: unknown) {
  const queueName = QZ_PRINT_QUEUES[kind]
  const code = error instanceof QzPrintError ? error.code : 'QZ_PRINT_FAILED'
  if (code === 'QZ_UNAVAILABLE') return 'QZ Tray 不可用，请确认 QZ Tray 2.2.6 正在运行'
  if (code === 'QZ_QUEUE_NOT_FOUND') return `未找到 Windows 打印队列“${queueName}”`
  return `提交到“${queueName}”失败，请检查该队列后重试`
}

export default function QzPrintTestClient() {
  const [qzStatus, setQzStatus] = useState<QzStatus>('checking')
  const [printers, setPrinters] = useState<string[]>([])
  const [statusMessage, setStatusMessage] = useState('正在检测 QZ Tray…')
  const [receiptState, setReceiptState] = useState<PrintState>(INITIAL_PRINT_STATE)
  const [kitchenState, setKitchenState] = useState<PrintState>(INITIAL_PRINT_STATE)

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

  async function submitFixedTest(kind: QzPrintKind) {
    const current = kind === 'receipt' ? receiptState : kitchenState
    if (current.status === 'printing') return
    const setState = kind === 'receipt' ? setReceiptState : setKitchenState
    const queueName = QZ_PRINT_QUEUES[kind]
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
      if (kind === 'receipt') {
        await printCustomerReceiptViaQz(renderDesktopReceiptHtml(customerTestReceipt(), 'zh'))
      } else {
        await printKitchenTicketViaQz(renderKitchenTicketHtml(kitchenTestTicket(), 'zh'))
      }
      setState({ status: 'success', message: `已提交到“${QZ_PRINT_QUEUES[kind]}”` })
    } catch (error) {
      setState({ status: 'error', message: errorMessage(kind, error) })
    }
  }

  const statusLabel = qzStatus === 'online' ? '在线' : qzStatus === 'checking' ? '检测中' : '离线'

  return (
    <main style={styles.page}>
      <section style={styles.card} data-qz-print-test-page="QZ-PRINT-01C">
        <header style={styles.header}>
          <div style={styles.eyebrow}>QZ-PRINT-01C</div>
          <h1 style={styles.title}>Windows 双打印机受控测试</h1>
          <div style={styles.meta}>Commit: ba9e599</div>
          <div style={styles.meta}>Environment: Preview</div>
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
          <div style={styles.sectionTitle}>固定队列测试</div>
          <div style={styles.actionGrid}>
            <button
              type="button"
              data-qz-test-action="receipt"
              style={{ ...styles.primaryButton, background: '#2563eb' }}
              disabled={receiptState.status === 'printing'}
              onClick={() => void submitFixedTest('receipt')}
            >
              {receiptState.status === 'printing' ? '提交中…' : '顾客测试票 → 前台'}
            </button>
            <button
              type="button"
              data-qz-test-action="kitchen"
              style={{ ...styles.primaryButton, background: '#ea580c' }}
              disabled={kitchenState.status === 'printing'}
              onClick={() => void submitFixedTest('kitchen')}
            >
              {kitchenState.status === 'printing' ? '提交中…' : '厨房测试票 → 厨房'}
            </button>
          </div>
          {receiptState.message && <div data-qz-test-result="receipt" style={{ ...styles.result, color: receiptState.status === 'error' ? '#b91c1c' : '#166534' }}>{receiptState.message}</div>}
          {kitchenState.message && <div data-qz-test-result="kitchen" style={{ ...styles.result, color: kitchenState.status === 'error' ? '#b91c1c' : '#166534' }}>{kitchenState.message}</div>}
        </section>

        <footer style={styles.footer}>
          本页面不读取或创建真实订单、支付、商品、库存、顾客或 Computer Binding 数据；固定队列失败时不会回退浏览器打印。
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

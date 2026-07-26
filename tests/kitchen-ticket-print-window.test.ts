import assert from 'node:assert/strict'
import { printDesktopReceipt } from '../app/components/DesktopReceipt'
import { printKitchenTicket } from '../app/components/KitchenTicket'

type Listener = { callback: () => void; once: boolean }

class FakePrintWindow {
  closed = false
  writes: string[] = []
  private listeners = new Map<string, Listener[]>()
  document = {
    open: () => {},
    write: (html: string) => this.writes.push(html),
    close: () => {},
  }

  addEventListener(type: string, callback: () => void, options?: { once?: boolean }) {
    const existing = this.listeners.get(type) ?? []
    existing.push({ callback, once: options?.once === true })
    this.listeners.set(type, existing)
  }

  focus() {}

  print() {
    setTimeout(() => {
      const listeners = this.listeners.get('afterprint') ?? []
      this.listeners.set('afterprint', listeners.filter((listener) => !listener.once))
      listeners.forEach((listener) => listener.callback())
    }, 0)
  }

  close() {
    this.closed = true
  }
}

async function run() {
  const realWindow = globalThis.window
  const printWindow = new FakePrintWindow()
  let openCalls = 0
  let finished = 0

  Object.assign(globalThis, {
    window: {
      open: () => {
        openCalls += 1
        return printWindow
      },
      setTimeout,
      clearInterval,
      setInterval,
    },
  })

  try {
    printDesktopReceipt({
      storeName: 'Mino Pet Shop',
      orderNo: 'SO-TEST-001',
      createdAt: '2026-07-26T06:00:00.000Z',
      paymentMethod: 'CASH',
      totalAmount: 12,
      currencyCode: 'USD',
      items: [{ name: 'Item A', qty: 1, price: 12, lineAmount: 12 }],
    }, 'zh', {
      onAfterPrint: () => { finished += 1 },
      onAfterPrintWithWindow: (customerReceiptWindow) => {
        printKitchenTicket({
          storeName: 'Mino Pet Shop',
          orderNo: 'SO-TEST-001',
          createdAt: '2026-07-26T06:00:00.000Z',
          items: [{ name: 'Item A', qty: 1 }],
        }, 'zh', {
          printWindow: customerReceiptWindow,
          onAfterPrint: () => { finished += 1 },
        })
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 750))

    assert.equal(openCalls, 1, 'kitchen printing must not need a second browser popup')
    assert.equal(printWindow.writes.length, 2, 'the same print window must receive both receipts in order')
    assert.match(printWindow.writes[0], /销售小票/)
    assert.match(printWindow.writes[1], /厨房单/)
    assert.equal(finished, 1, 'completion must run only after kitchen printing finishes')
    assert.equal(printWindow.closed, true)
  } finally {
    Object.assign(globalThis, { window: realWindow })
  }
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})

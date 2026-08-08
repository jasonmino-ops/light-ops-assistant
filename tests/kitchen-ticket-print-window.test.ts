import assert from 'node:assert/strict'
import { printDesktopReceipt } from '../app/components/DesktopReceipt'
import { getKitchenTicketHtmlForTest, printKitchenTicket } from '../app/components/KitchenTicket'

type Listener = { callback: () => void; once: boolean }
type PrintAction = 'afterprint' | 'none' | 'throw'

class FakePrintWindow {
  closed = false
  writes: string[] = []
  printCalls = 0
  private listeners = new Map<string, Listener[]>()

  constructor(private readonly printPlan: PrintAction[]) {}

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

  removeEventListener(type: string, callback: () => void) {
    const existing = this.listeners.get(type) ?? []
    this.listeners.set(type, existing.filter((listener) => listener.callback !== callback))
  }

  emit(type: string) {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, listeners.filter((listener) => !listener.once))
    listeners.forEach((listener) => listener.callback())
  }

  focus() {}

  print() {
    const action = this.printPlan[this.printCalls] ?? 'none'
    this.printCalls += 1
    if (action === 'throw') throw new Error('print failed')
    if (action === 'afterprint') setTimeout(() => this.emit('afterprint'), 0)
  }

  close() {
    this.closed = true
  }
}

const receipt = {
  storeName: 'Mino Pet Shop',
  orderNo: 'SO-TEST-001',
  createdAt: '2026-07-26T06:00:00.000Z',
  paymentMethod: 'CASH',
  totalAmount: 12,
  currencyCode: 'USD',
  items: [{ name: 'Item A', qty: 1, price: 12, lineAmount: 12 }],
}

const kitchenTicket = {
  storeName: 'Mino Pet Shop',
  orderNo: 'SO-TEST-001',
  createdAt: '2026-07-26T06:00:00.000Z',
  items: [{ name: 'Item A', qty: 1 }],
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withPrintWindows<T>(windows: FakePrintWindow[], run: (getOpenCalls: () => number) => Promise<T>) {
  const realWindow = globalThis.window
  let openCalls = 0
  Object.assign(globalThis, {
    window: {
      open: () => windows[openCalls++] ?? null,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    },
  })
  try {
    return await run(() => openCalls)
  } finally {
    Object.assign(globalThis, { window: realWindow })
  }
}

async function testNormalTwoStagePrint() {
  const printWindow = new FakePrintWindow(['afterprint', 'afterprint'])
  await withPrintWindows([printWindow], async (getOpenCalls) => {
    let cleanupCalls = 0
    let timedOut = 0
    printDesktopReceipt(receipt, 'zh', {
      firstPrintCompletionTimeoutMs: 200,
      onAfterPrint: () => { cleanupCalls += 1 },
      onFirstPrintTimeout: () => { timedOut += 1 },
      onAfterPrintWithWindow: (customerReceiptWindow) => {
        printKitchenTicket(kitchenTicket, 'zh', {
          printWindow: customerReceiptWindow,
          onAfterPrint: () => { cleanupCalls += 1 },
        })
      },
    })

    await wait(800)

    assert.equal(getOpenCalls(), 1, 'kitchen printing must not need a second browser popup')
    assert.equal(printWindow.printCalls, 2, 'the shared window must print customer then kitchen ticket')
    assert.equal(printWindow.writes.length, 2, 'the shared window must receive both receipts in order')
    assert.match(printWindow.writes[0], /销售小票/)
    assert.match(printWindow.writes[1], /厨房单/)
    assert.equal(cleanupCalls, 1, 'cleanup must run only after kitchen printing finishes')
    assert.equal(timedOut, 0, 'a normal completion must cancel the first-stage timeout')
    assert.equal(printWindow.closed, true)
  })
}

async function testMissingFirstAfterprintRecoversAndAllowsNextPrint() {
  const stalledWindow = new FakePrintWindow(['none'])
  const nextTransactionWindow = new FakePrintWindow(['afterprint', 'afterprint'])
  await withPrintWindows([stalledWindow, nextTransactionWindow], async (getOpenCalls) => {
    let cleanupCalls = 0
    let timeoutCalls = 0
    let kitchenStarts = 0
    let chainLocked = true
    const releaseChain = () => {
      cleanupCalls += 1
      chainLocked = false
    }

    printDesktopReceipt(receipt, 'zh', {
      firstPrintCompletionTimeoutMs: 20,
      onFirstPrintTimeout: () => { timeoutCalls += 1 },
      onAfterPrint: releaseChain,
      onAfterPrintWithWindow: () => { kitchenStarts += 1 },
    })

    await wait(340)

    assert.equal(stalledWindow.printCalls, 1)
    assert.equal(kitchenStarts, 0, 'a missing customer completion signal must not start kitchen printing')
    assert.equal(timeoutCalls, 1)
    assert.equal(cleanupCalls, 1)
    assert.equal(chainLocked, false, 'the page-level chain lock can be released')
    assert.equal(stalledWindow.closed, true)

    printDesktopReceipt(receipt, 'zh', {
      onAfterPrint: releaseChain,
      onAfterPrintWithWindow: (customerReceiptWindow) => {
        printKitchenTicket(kitchenTicket, 'zh', {
          printWindow: customerReceiptWindow,
          onAfterPrint: releaseChain,
        })
      },
    })
    await wait(800)

    assert.equal(getOpenCalls(), 2, 'a recovered chain must allow the next transaction to open a receipt')
    assert.equal(nextTransactionWindow.printCalls, 2, 'the next transaction must restart the two-stage print flow')
    assert.equal(cleanupCalls, 2, 'the next transaction must complete independently')
  })
}

async function testLateAfterprintCannotRestartKitchenPrinting() {
  const printWindow = new FakePrintWindow(['none'])
  await withPrintWindows([printWindow], async () => {
    let cleanupCalls = 0
    let kitchenStarts = 0
    printDesktopReceipt(receipt, 'zh', {
      firstPrintCompletionTimeoutMs: 20,
      onAfterPrint: () => { cleanupCalls += 1 },
      onAfterPrintWithWindow: () => { kitchenStarts += 1 },
    })

    await wait(340)
    printWindow.emit('afterprint')
    await wait(160)

    assert.equal(kitchenStarts, 0, 'a late customer afterprint must not start the kitchen stage')
    assert.equal(cleanupCalls, 1, 'a late customer afterprint must not repeat cleanup')
    assert.equal(printWindow.printCalls, 1)
  })
}

async function testManualCloseAndPrintFailuresRecover() {
  const manuallyClosedWindow = new FakePrintWindow(['none'])
  await withPrintWindows([manuallyClosedWindow], async () => {
    let cleanupCalls = 0
    let timeoutCalls = 0
    printDesktopReceipt(receipt, 'zh', {
      firstPrintCompletionTimeoutMs: 900,
      onAfterPrint: () => { cleanupCalls += 1 },
      onFirstPrintTimeout: () => { timeoutCalls += 1 },
      onAfterPrintWithWindow: () => { throw new Error('kitchen must not start after manual close') },
    })
    await wait(280)
    manuallyClosedWindow.close()
    await wait(1_050)

    assert.equal(cleanupCalls, 1, 'manual close must release the chain once')
    assert.equal(timeoutCalls, 0, 'manual close must cancel the first-stage timeout')
  })

  const customerPrintFailureWindow = new FakePrintWindow(['throw'])
  await withPrintWindows([customerPrintFailureWindow], async () => {
    let cleanupCalls = 0
    let timeoutCalls = 0
    printDesktopReceipt(receipt, 'zh', {
      firstPrintCompletionTimeoutMs: 20,
      onAfterPrint: () => { cleanupCalls += 1 },
      onFirstPrintTimeout: () => { timeoutCalls += 1 },
      onAfterPrintWithWindow: () => { throw new Error('kitchen must not start after customer print failure') },
    })
    await wait(400)

    assert.equal(cleanupCalls, 1, 'customer print failure must release the chain')
    assert.equal(timeoutCalls, 0, 'customer print failure must clear the timeout')
  })

  const kitchenPrintFailureWindow = new FakePrintWindow(['afterprint', 'throw'])
  await withPrintWindows([kitchenPrintFailureWindow], async () => {
    let cleanupCalls = 0
    printDesktopReceipt(receipt, 'zh', {
      onAfterPrint: () => { cleanupCalls += 1 },
      onAfterPrintWithWindow: (customerReceiptWindow) => {
        printKitchenTicket(kitchenTicket, 'zh', {
          printWindow: customerReceiptWindow,
          onAfterPrint: () => { cleanupCalls += 1 },
        })
      },
    })
    await wait(750)

    assert.equal(kitchenPrintFailureWindow.printCalls, 2)
    assert.equal(cleanupCalls, 1, 'kitchen print failure must release the chain once')
    assert.equal(kitchenPrintFailureWindow.closed, true)
  })
}

async function testKitchenOffStaysSinglePrint() {
  const printWindow = new FakePrintWindow(['afterprint'])
  await withPrintWindows([printWindow], async (getOpenCalls) => {
    let cleanupCalls = 0
    printDesktopReceipt(receipt, 'zh', { onAfterPrint: () => { cleanupCalls += 1 } })
    await wait(480)

    assert.equal(getOpenCalls(), 1)
    assert.equal(printWindow.printCalls, 1, 'OFF must keep customer printing to one print call')
    assert.equal(printWindow.writes.length, 1, 'OFF must not write kitchen ticket content')
    assert.equal(cleanupCalls, 1)
  })
}

async function testManualKitchenUsesTheSameKhmerTemplate() {
  const printWindow = new FakePrintWindow(['afterprint'])
  await withPrintWindows([printWindow], async () => {
    printKitchenTicket(kitchenTicket, 'km', { printWindow: printWindow as unknown as Window })
    await wait(420)

    assert.equal(printWindow.writes.length, 1)
    assert.equal(printWindow.writes[0], getKitchenTicketHtmlForTest(kitchenTicket, 'km'), 'manual and RAW kitchen printing must share the same localized template')
    assert.match(printWindow.writes[0], /បង្កាន់ដៃផ្ទះបាយ/)
    assert.doesNotMatch(printWindow.writes[0], /厨房单|订单号|交易时间|数量/)
  })
}

async function run() {
  await testNormalTwoStagePrint()
  await testMissingFirstAfterprintRecoversAndAllowsNextPrint()
  await testLateAfterprintCannotRestartKitchenPrinting()
  await testManualCloseAndPrintFailuresRecover()
  await testKitchenOffStaysSinglePrint()
  await testManualKitchenUsesTheSameKhmerTemplate()
  console.log('kitchen ticket print-window tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})

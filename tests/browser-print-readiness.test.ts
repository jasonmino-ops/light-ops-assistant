import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { buildPrintHTML, type ShareData, type ShareLabels } from '../app/components/OrderShareCard'
import {
  openExistingBrowserPrint,
  waitForPrintableDocument,
} from '../lib/browserPrintFallback'

type Listener = { callback: () => void; once: boolean }

class FakeElement {
  id = ''
  style = { cssText: '' }
  textContent = 'Test Store Order SO-BROWSER-READY-001 Item A Total 2.00 Paid'
  innerText = this.textContent
  removed = false
  markersPresent = true
  width = 220
  height = 300
  children: FakeElement[] = []
  private html = ''

  get innerHTML() {
    return this.html
  }

  set innerHTML(value: string) {
    this.html = value
    this.textContent = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    this.innerText = this.textContent
  }

  get scrollWidth() { return this.width }
  get offsetWidth() { return this.width }
  get clientWidth() { return this.width }
  get scrollHeight() { return this.height }
  get offsetHeight() { return this.height }
  get clientHeight() { return this.height }

  getBoundingClientRect() {
    return { width: this.width, height: this.height } as DOMRect
  }

  querySelector(selector: string) {
    if (!this.markersPresent) return null
    return ['.meta', 'table tbody tr', '.total-row', '.total-value'].includes(selector)
      ? ({} as Element)
      : null
  }

  appendChild(child: FakeElement) {
    this.children.push(child)
    return child
  }

  remove() {
    this.removed = true
  }
}

class FakeDocument {
  readyState: DocumentReadyState = 'complete'
  body: FakeElement | null = new FakeElement()
  fonts: { ready: Promise<unknown> } | undefined = { ready: Promise.resolve() }
  writes: string[] = []
  openCalls = 0
  closeCalls = 0
  created: FakeElement[] = []
  head = new FakeElement()

  open() { this.openCalls += 1 }
  write(html: string) { this.writes.push(html) }
  close() { this.closeCalls += 1 }
  createElement() {
    const element = new FakeElement()
    this.created.push(element)
    return element
  }
}

class FakeWindow {
  closed = false
  printCalls = 0
  focusCalls = 0
  openCalls = 0
  frameCalls = 0
  throwOnPrint = false
  openResult: FakeWindow | null = null
  onFrame: (() => void) | null = null
  private listeners = new Map<string, Listener[]>()

  constructor(readonly fakeDocument = new FakeDocument()) {}

  get document() {
    return this.fakeDocument as unknown as Document
  }

  open() {
    this.openCalls += 1
    return this.openResult as unknown as Window | null
  }

  requestAnimationFrame(callback: FrameRequestCallback) {
    const id = globalThis.setTimeout(() => {
      this.frameCalls += 1
      this.onFrame?.()
      callback(Date.now())
    }, 1)
    return Number(id)
  }

  setTimeout(callback: TimerHandler, delay?: number) {
    return Number(globalThis.setTimeout(callback as () => void, delay))
  }

  clearTimeout(id?: number) {
    globalThis.clearTimeout(id)
  }

  addEventListener(type: string, callback: () => void, options?: AddEventListenerOptions) {
    const listeners = this.listeners.get(type) ?? []
    listeners.push({ callback, once: options?.once === true })
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, callback: () => void) {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, listeners.filter((listener) => listener.callback !== callback))
  }

  listenerCount(type: string) {
    return (this.listeners.get(type) ?? []).length
  }

  emit(type: string) {
    const listeners = this.listeners.get(type) ?? []
    this.listeners.set(type, listeners.filter((listener) => !listener.once))
    listeners.forEach((listener) => listener.callback())
  }

  focus() { this.focusCalls += 1 }
  print() {
    this.printCalls += 1
    if (this.throwOnPrint) throw new Error('print failed')
  }
  close() { this.closed = true }
}

const printableHtml = '<!doctype html><html><head><title>SO-BROWSER-READY-001</title></head><body><div class="meta">Order SO-BROWSER-READY-001</div><table><tbody><tr><td>Item A</td></tr></tbody></table><div class="total-row"><span class="total-value">2.00</span></div></body></html>'

function testOptions(hostWindow: FakeWindow, hostDocument = hostWindow.fakeDocument) {
  return {
    hostWindow: hostWindow as unknown as Window,
    hostDocument: hostDocument as unknown as Document,
    timeoutMs: 30,
    pollIntervalMs: 2,
  }
}

let cases = 0
async function test(name: string, run: () => void | Promise<void>) {
  cases += 1
  try {
    await run()
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function main() {
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await test('ready printable content calls print exactly once and preserves popup completion', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      host.openResult = popup
      let completed = 0
      const result = await openExistingBrowserPrint(
        printableHtml,
        () => { completed += 1 },
        testOptions(host),
      )
      assert.equal(result.status, 'printed')
      assert.equal(popup.fakeDocument.openCalls, 1)
      assert.deepEqual(popup.fakeDocument.writes, [printableHtml])
      assert.equal(popup.fakeDocument.closeCalls, 1)
      assert.equal(popup.printCalls, 1)
      assert.equal(popup.focusCalls, 1)
      assert.equal(popup.closed, false, 'the historical separate preview remains user-controlled')
      assert.equal(completed, 1)
    })

    await test('document loading waits until readyState is complete', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      popup.fakeDocument.readyState = 'loading'
      popup.onFrame = () => { popup.fakeDocument.readyState = 'complete' }
      host.openResult = popup
      const result = await openExistingBrowserPrint(printableHtml, () => {}, testOptions(host))
      assert.equal(result.status, 'printed')
      assert.ok(popup.frameCalls >= 2)
      assert.equal(popup.printCalls, 1)
    })

    await test('pending fonts delay printing until fonts.ready resolves', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      let resolveFonts!: () => void
      popup.fakeDocument.fonts = { ready: new Promise<void>((resolve) => { resolveFonts = resolve }) }
      popup.onFrame = () => {
        if (popup.frameCalls === 2) resolveFonts()
      }
      host.openResult = popup
      const result = await openExistingBrowserPrint(printableHtml, () => {}, testOptions(host))
      assert.equal(result.status, 'printed')
      assert.ok(popup.frameCalls >= 3)
      assert.equal(popup.printCalls, 1)
    })

    await test('zero layout waits until two stable nonzero frames', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      const body = popup.fakeDocument.body!
      body.width = 0
      body.height = 0
      popup.onFrame = () => {
        if (popup.frameCalls >= 2) {
          body.width = 220
          body.height = 300
        }
      }
      host.openResult = popup
      const result = await openExistingBrowserPrint(printableHtml, () => {}, testOptions(host))
      assert.equal(result.status, 'printed')
      assert.ok(popup.frameCalls >= 3)
      assert.equal(popup.printCalls, 1)
    })

    await test('empty printable text fails closed', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      popup.fakeDocument.body!.textContent = ''
      popup.fakeDocument.body!.innerText = ''
      host.openResult = popup
      let completed = 0
      const result = await openExistingBrowserPrint(printableHtml, () => { completed += 1 }, {
        ...testOptions(host),
        timeoutMs: 8,
      })
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'PRINTABLE_TEXT_MISSING')
      assert.equal(popup.printCalls, 0)
      assert.equal(popup.closed, true)
      assert.equal(completed, 1)
    })

    await test('missing receipt structure markers fails closed', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      popup.fakeDocument.body!.markersPresent = false
      host.openResult = popup
      const result = await openExistingBrowserPrint(printableHtml, () => {}, {
        ...testOptions(host),
        timeoutMs: 8,
      })
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'RECEIPT_MARKERS_MISSING')
      assert.equal(popup.printCalls, 0)
    })

    await test('missing receipt root fails closed', async () => {
      const target = new FakeWindow()
      target.fakeDocument.body = null
      const result = await waitForPrintableDocument(target as unknown as Window, () => null, {
        ...testOptions(target),
        timeoutMs: 8,
      })
      assert.deepEqual(result, {
        status: 'blocked',
        reason: 'RECEIPT_ROOT_MISSING',
        contentPresent: false,
        layoutWidth: 0,
        layoutHeight: 0,
      })
      assert.equal(target.printCalls, 0)
    })

    await test('too-small receipt height fails closed', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      popup.fakeDocument.body!.height = 20
      host.openResult = popup
      const result = await openExistingBrowserPrint(printableHtml, () => {}, {
        ...testOptions(host),
        timeoutMs: 8,
      })
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'PRINTABLE_LAYOUT_TOO_SMALL')
      assert.equal(popup.printCalls, 0)
    })

    await test('unstable layout reaches the bounded timeout without printing', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      const body = popup.fakeDocument.body!
      popup.onFrame = () => { body.width = body.width === 220 ? 230 : 220 }
      host.openResult = popup
      const result = await openExistingBrowserPrint(printableHtml, () => {}, {
        ...testOptions(host),
        timeoutMs: 8,
      })
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'READINESS_TIMEOUT')
      assert.equal(popup.printCalls, 0)
    })

    await test('popup-block fallback cleans up only after afterprint', async () => {
      const host = new FakeWindow()
      host.openResult = null
      let completed = 0
      const result = await openExistingBrowserPrint(
        printableHtml,
        () => { completed += 1 },
        testOptions(host),
      )
      assert.equal(result.status, 'printed')
      assert.equal(host.printCalls, 1)
      assert.equal(completed, 0)
      assert.equal(host.fakeDocument.created.length, 2)
      host.emit('afterprint')
      assert.equal(completed, 1)
      assert.equal(host.fakeDocument.created[0].removed, true)
      assert.equal(host.fakeDocument.created[1].removed, true)
      assert.equal(host.listenerCount('afterprint'), 0)
    })

    await test('missing afterprint cannot permanently lock injected fallback', async () => {
      const host = new FakeWindow()
      host.openResult = null
      let completed = 0
      const result = await openExistingBrowserPrint(
        printableHtml,
        () => { completed += 1 },
        { ...testOptions(host), afterPrintCleanupTimeoutMs: 5 },
      )
      assert.equal(result.status, 'printed')
      assert.equal(host.printCalls, 1)
      assert.equal(completed, 0)
      await new Promise((resolve) => setTimeout(resolve, 15))
      assert.equal(completed, 1)
      assert.equal(host.fakeDocument.created[0].removed, true)
      assert.equal(host.fakeDocument.created[1].removed, true)
      assert.equal(host.listenerCount('afterprint'), 0)
    })

    await test('injected setup failure cleans up and releases the caller', async () => {
      const host = new FakeWindow()
      host.openResult = null
      const hostDocument = host.fakeDocument
      hostDocument.createElement = () => { throw new Error('DOM unavailable') }
      let completed = 0
      const result = await openExistingBrowserPrint(
        printableHtml,
        () => { completed += 1 },
        testOptions(host, hostDocument),
      )
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'PRINT_FAILED')
      assert.equal(host.printCalls, 0)
      assert.equal(completed, 1)
      assert.equal(host.listenerCount('afterprint'), 0)
    })

    await test('injected print failure removes its completion listener and staging DOM', async () => {
      const host = new FakeWindow()
      host.openResult = null
      host.throwOnPrint = true
      let completed = 0
      const result = await openExistingBrowserPrint(
        printableHtml,
        () => { completed += 1 },
        testOptions(host),
      )
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'PRINT_FAILED')
      assert.equal(host.printCalls, 1)
      assert.equal(completed, 1)
      assert.equal(host.listenerCount('afterprint'), 0)
      assert.equal(host.fakeDocument.created[0].removed, true)
      assert.equal(host.fakeDocument.created[1].removed, true)
    })

    await test('print exceptions fail closed without duplicate print', async () => {
      const host = new FakeWindow()
      const popup = new FakeWindow()
      popup.throwOnPrint = true
      host.openResult = popup
      let completed = 0
      const result = await openExistingBrowserPrint(printableHtml, () => { completed += 1 }, testOptions(host))
      assert.equal(result.status, 'blocked')
      assert.equal(result.reason, 'PRINT_FAILED')
      assert.equal(popup.printCalls, 1)
      assert.equal(completed, 1)
    })

    await test('buildPrintHTML output remains byte-for-byte unchanged', () => {
      const data: ShareData = {
        orderNo: 'SO-BROWSER-READY-001',
        storeName: 'Test Store',
        operatorDisplayName: 'Operator',
        createdAt: '2026-09-06T00:00:00.000Z',
        saleStatus: 'COMPLETED',
        items: [{
          id: 'i1',
          productNameSnapshot: 'Item A',
          specSnapshot: null,
          quantity: 1,
          unitPrice: 2,
          lineAmount: 2,
        }],
        totalAmount: 2,
        paymentMethod: 'CASH',
        paymentStatus: 'PAID',
        paidAt: null,
      }
      const labels: ShareLabels & { title: string; subtotal: string } = {
        title: 'Receipt',
        orderNo: 'Order',
        time: 'Time',
        operator: 'Operator',
        products: 'Products',
        qty: 'Qty',
        unitPrice: 'Unit',
        subtotal: 'Subtotal',
        total: 'Total',
        payMethod: 'Payment',
        payStatus: 'Status',
        cash: 'Cash',
        khqr: 'KHQR',
        noPayment: 'None',
        completed: 'Completed',
        pending: 'Pending',
        cancelled: 'Cancelled',
        paid: 'Paid',
        unpaidHint: 'Unpaid',
      }
      const digest = createHash('sha256').update(buildPrintHTML(data, labels)).digest('hex')
      assert.equal(digest, '67d2bdc72d603656e51215c2fba8af5a5f192be4b9996f71c3beff4a0ef6b3a0')
    })

    await test('OrderDetail keeps the same browser fallback selection point', () => {
      const source = readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
      assert.match(source, /cloudRelayState !== 'enabled'[\s\S]*void openExistingBrowserPrint\(html, completePrintAction\)/)
      assert.match(source, /html = buildPrintHTML\(d as ShareData, shareLabels\)/)
    })

    await test('legacy browser printing remains an about:blank popup contract', () => {
      const source = readFileSync('lib/browserPrintFallback.ts', 'utf8')
      assert.match(source, /hostWindow\.open\('', '_blank', 'width=420,height=700'\)/)
      assert.match(source, /printWindow\.document\.write\(html\)/)
      assert.match(source, /printWindow\.print\(\)/)
      assert.doesNotMatch(source, /setTimeout\([^)]*400|,\s*400\)/)
    })

    await test('QZ and Relay branches remain outside the browser fallback helper', () => {
      const fallback = readFileSync('lib/browserPrintFallback.ts', 'utf8')
      const orderSheet = readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
      assert.doesNotMatch(fallback, /qz|es-tray|print-jobs|WindowsQueueTransport/i)
      assert.match(orderSheet, /renderTicketHtmlToEscPosRaw\(html\)/)
      assert.match(orderSheet, /await submitPrint\(/)
    })
  } finally {
    console.warn = originalWarn
  }

  console.log(`browser print readiness tests passed (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

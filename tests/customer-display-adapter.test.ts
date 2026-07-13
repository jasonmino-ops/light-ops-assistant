import assert from 'node:assert/strict'
import {
  buildCustomerDisplayAmountBytes,
  buildCustomerDisplayClearBytes,
  buildCustomerDisplayInitBytes,
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  formatCustomerDisplayAmount,
  showCustomerDisplayAmount,
} from '../lib/customer-display-adapter'
import { shouldSendCustomerDisplayAmount } from '../app/desktop/pos/UsbCustomerDisplayBridge'

function bytes(input: Uint8Array) {
  return Array.from(input)
}

async function main() {
  assert.equal(formatCustomerDisplayAmount(12.5), '12.50')
  assert.equal(formatCustomerDisplayAmount(0), '0.00')
  assert.deepEqual(bytes(buildCustomerDisplayAmountBytes(12.5)), [0x1b, 0x51, 0x41, 0x31, 0x32, 0x2e, 0x35, 0x30, 0x0d])
  assert.deepEqual(bytes(buildCustomerDisplayInitBytes()), [0x1b, 0x40])
  assert.deepEqual(bytes(buildCustomerDisplayClearBytes()), [0x0c])

  assert.throws(() => formatCustomerDisplayAmount(Number.NaN), /INVALID_CUSTOMER_DISPLAY_AMOUNT/)
  assert.throws(() => formatCustomerDisplayAmount(Number.POSITIVE_INFINITY), /INVALID_CUSTOMER_DISPLAY_AMOUNT/)
  assert.throws(() => formatCustomerDisplayAmount(-0.01), /INVALID_CUSTOMER_DISPLAY_AMOUNT/)
  assert.throws(() => formatCustomerDisplayAmount(1234567890.12), /CUSTOMER_DISPLAY_AMOUNT_TOO_LONG/)

  const session = {
    status: 'AWAITING_PAYMENT',
    totalAmount: 12.5,
    orderNo: 'ORD-1',
    updatedAt: '2026-07-13T01:00:00.000Z',
  }
  const first = shouldSendCustomerDisplayAmount(session, null, null)
  assert.equal(first.shouldSend, true)
  assert.equal(shouldSendCustomerDisplayAmount(session, first.signature, first.amountKey).shouldSend, false)
  assert.equal(shouldSendCustomerDisplayAmount({ ...session, updatedAt: '2026-07-13T01:00:01.000Z' }, first.signature, first.amountKey).shouldSend, false)
  assert.equal(shouldSendCustomerDisplayAmount({ ...session, totalAmount: 13 }, first.signature, first.amountKey).shouldSend, true)

  const originalNavigator = globalThis.navigator
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {},
  })
  assert.equal((await connectCustomerDisplay()).status, 'unsupported')
  assert.equal((await showCustomerDisplayAmount(1)).status, 'unsupported')

  const written: number[][] = []
  let activeWriters = 0
  let maxActiveWriters = 0
  const fakePort = {
    writable: {
      getWriter() {
        activeWriters += 1
        maxActiveWriters = Math.max(maxActiveWriters, activeWriters)
        return {
          async write(value: Uint8Array) {
            await new Promise((resolve) => setTimeout(resolve, 5))
            written.push(bytes(value))
          },
          releaseLock() {
            activeWriters -= 1
          },
        }
      },
    },
    async open() {},
    async close() {},
    getInfo() {
      return { usbVendorId: 1, usbProductId: 2 }
    },
    addEventListener() {},
  }

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serial: {
        async requestPort() {
          return fakePort
        },
        async getPorts() {
          return [fakePort]
        },
      },
    },
  })

  assert.equal((await connectCustomerDisplay(9600)).status, 'connected')
  await Promise.all([
    showCustomerDisplayAmount(1),
    showCustomerDisplayAmount(2),
    showCustomerDisplayAmount(3),
  ])
  assert.equal(maxActiveWriters, 1)
  assert.deepEqual(written[0], [0x1b, 0x40])
  assert.deepEqual(written.slice(-3), [
    [0x1b, 0x51, 0x41, 0x31, 0x2e, 0x30, 0x30, 0x0d],
    [0x1b, 0x51, 0x41, 0x32, 0x2e, 0x30, 0x30, 0x0d],
    [0x1b, 0x51, 0x41, 0x33, 0x2e, 0x30, 0x30, 0x0d],
  ])
  assert.equal((await disconnectCustomerDisplay()).status, 'disconnected')

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  })

  const bridgeSource = await import('node:fs').then((fs) => fs.readFileSync('app/desktop/pos/UsbCustomerDisplayBridge.tsx', 'utf8'))
  assert.match(bridgeSource, /console\.warn\('\[usb-customer-display\] poll failed'/, 'poll failure should only warn')
  assert.doesNotMatch(bridgeSource, /catch \(error\)[\s\S]{0,180}clearCustomerDisplay\(\)/, 'poll failure should not trigger clear')

  console.log('customer display adapter tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

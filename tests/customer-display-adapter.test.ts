import assert from 'node:assert/strict'
import {
  buildCustomerDisplayAmountBytes,
  buildCustomerDisplayClearBytes,
  buildCustomerDisplayInitBytes,
  clearCustomerDisplay,
  connectCustomerDisplay,
  disconnectCustomerDisplay,
  formatCustomerDisplayAmount,
  getCustomerDisplayStatus,
  reconnectAuthorizedCustomerDisplay,
  showCustomerDisplayAmount,
  testCustomerDisplay,
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
  let openCount = 0
  let closeCount = 0
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
    async open() {
      openCount += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
    },
    async close() {
      closeCount += 1
    },
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
  assert.equal(openCount, 1)
  assert.equal((await connectCustomerDisplay(9600)).status, 'connected')
  assert.equal(openCount, 1, 'already connected connect should not call open again')
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
  await clearCustomerDisplay()
  assert.equal(openCount, 1, 'clear should not call open')
  assert.equal(getCustomerDisplayStatus().status, 'connected', 'clear should keep connected status')
  assert.deepEqual(written.at(-1), [0x0c])
  await testCustomerDisplay()
  assert.deepEqual(written.slice(-2), [
    [0x1b, 0x40],
    [0x1b, 0x51, 0x41, 0x38, 0x38, 0x38, 0x38, 0x2e, 0x38, 0x38, 0x0d],
  ])
  assert.equal((await disconnectCustomerDisplay()).status, 'disconnected')
  assert.equal(closeCount, 1)

  written.length = 0
  const concurrentConnect = await Promise.all([
    connectCustomerDisplay(2400),
    connectCustomerDisplay(2400),
  ])
  assert.equal(concurrentConnect[0].status, 'connected')
  assert.equal(concurrentConnect[1].status, 'connected')
  assert.equal(openCount, 2, 'two concurrent connects after disconnect should share one open')
  assert.equal(written.length, 1, 'concurrent connect should initialize once')
  assert.equal((await disconnectCustomerDisplay()).status, 'disconnected')

  const alreadyOpenPort = {
    ...fakePort,
    async open() {
      openCount += 1
      throw new Error("Failed to execute 'open' on 'SerialPort': The port is already open.")
    },
  }
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serial: {
        async requestPort() {
          return alreadyOpenPort
        },
        async getPorts() {
          return [alreadyOpenPort]
        },
      },
    },
  })
  assert.equal((await reconnectAuthorizedCustomerDisplay(2400)).status, 'connected')
  assert.equal(getCustomerDisplayStatus().status, 'connected', 'already-open writable port should recover as connected')
  assert.equal((await disconnectCustomerDisplay()).status, 'disconnected')
  assert.equal((await connectCustomerDisplay(2400)).status, 'connected', 'disconnect should allow reconnect')
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

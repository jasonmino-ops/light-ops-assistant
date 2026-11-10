import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SharedPrintingCore, ExecutionSafetyCheck } from './sharedPrintingCore'

const PREFIX = '--v3-usb-front-test='
const VALID_FOR_MS = 5 * 60_000

export function usbFrontTestLedgerPath(userDataPath: string): string {
  return join(userDataPath, 'v3-printing', 'usb-front-test')
}

export function readUsbFrontTestRequest(argv: readonly string[], now = Date.now()) {
  const flags = argv.filter((arg) => arg.startsWith(PREFIX))
  if (flags.length === 0) return null
  const match = /^(\d{13}):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
    .exec(flags[0]!.slice(PREFIX.length))
  if (flags.length !== 1 || !match) throw new Error('USB_TEST_REQUEST_INVALID')
  const issuedAt = Number(match[1])
  if (issuedAt > now || issuedAt + VALID_FOR_MS <= now) throw new Error('USB_TEST_REQUEST_EXPIRED')
  return {
    printJobId: `usb-front-test:${match[0].toLowerCase()}`,
    expiresAt: new Date(issuedAt + VALID_FOR_MS).toISOString(),
  }
}

export type UsbFrontTestRequest = NonNullable<ReturnType<typeof readUsbFrontTestRequest>>

export function executeUsbFrontTest(
  core: SharedPrintingCore<Uint8Array>,
  request: UsbFrontTestRequest,
  endpointKey: string,
  validateExecution: ExecutionSafetyCheck,
) {
  const payload = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(`E-Shop USB FRONT TEST - NO SALE\n${request.printJobId}\n\n\n`, 'ascii'),
  ])
  const requestHash = createHash('sha256').update(endpointKey).update('\0').update(payload).digest('hex')
  return core.execute({
    identity: { ...request, requestHash, rendererVersion: 'usb-front-test-v1' },
    endpointKey,
    payload,
    validateExecution,
    // The diagnostic ledger is local. There is no commercial job to report to the Outbox.
    onDurableBarrier: async () => ({ ok: true, value: undefined }),
  })
}

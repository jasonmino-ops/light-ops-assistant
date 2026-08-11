import assert from 'node:assert/strict'
import { submitEshopTrayCloudPrint, EshopTrayCloudClientError } from '../lib/eShopTrayCloudClient'

async function main() {
  const bytes = Uint8Array.from([0x1b, 0x40, 0x1d, 0x56, 0x00])
  const snapshot = Uint8Array.from(bytes)
  const capture: { value: Record<string, unknown> | null } = { value: null }
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    capture.value = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({
      created: true,
      task: {
        id: 'task-cloud-001', taskId: 'task-cloud-001', storeCode: 'ST169E7000',
        status: 'ACCEPTED', idempotencyKey: 'eshop-tray:ORDER-1:request-cloud-001',
      },
    }, { status: 201 })
  }
  const result = await submitEshopTrayCloudPrint({
    storeCode: 'ST169E7000', orderNo: 'ORDER-1', commandStream: bytes,
    requestId: 'request-cloud-001', fetchImpl: fetchImpl as never,
  })
  assert.equal(result.id, 'task-cloud-001')
  assert.deepEqual(bytes, snapshot, 'Cloud Client must not mutate the existing ESC/POS command stream')
  assert.ok(capture.value)
  assert.equal(capture.value.taskType, 'PRINT_ESC_POS')
  assert.equal(capture.value.storeCode, 'ST169E7000')
  assert.deepEqual(capture.value.target, { type: 'WINDOWS_QUEUE', name: '前台' })
  assert.equal((capture.value.commandStream as { byteLength: number }).byteLength, bytes.byteLength)

  await assert.rejects(
    submitEshopTrayCloudPrint({
      storeCode: 'ST169E7000', orderNo: 'ORDER-2', commandStream: bytes,
      fetchImpl: (async () => { throw new TypeError('response lost') }) as never,
    }),
    (error) => error instanceof EshopTrayCloudClientError && error.submissionUncertain,
  )
}

main().catch((error) => { console.error(error); process.exitCode = 1 })

import assert from 'node:assert/strict'

import {
  buildSandboxPrintTask,
  submitSandboxPrintTask,
  type NativePrintTaskV1,
} from '../mobile-runtime/browser-sandbox/native-task-client'

async function main() {
  const originalBytes = Uint8Array.from([0x1b, 0x40, 0x00, 0xff, 0x1d, 0x56, 0x00])
  const snapshot = Uint8Array.from(originalBytes)
  const task = buildSandboxPrintTask(originalBytes, '192.168.18.49', 'sandbox-task-1')

  assert.deepEqual(task, {
    contractVersion: '1.0',
    taskId: 'sandbox-task-1',
    taskType: 'print',
    payload: {
      target: { host: '192.168.18.49', port: 9100 },
      commandStream: {
        encoding: 'base64',
        byteLength: 7,
        data: Buffer.from(originalBytes).toString('base64'),
      },
    },
  })

  let receivedTask: NativePrintTaskV1 | undefined
  const result = await submitSandboxPrintTask(originalBytes, '192.168.18.49', {
    taskId: 'sandbox-task-2',
    submitter: async (submitted) => {
      receivedTask = submitted
      return {
        contractVersion: '1.0',
        taskId: submitted.taskId,
        taskType: 'print',
        status: 'success',
        result: { bytesSent: submitted.payload.commandStream.byteLength, durationMs: 12 },
      }
    },
  })

  assert.ok(receivedTask)
  assert.equal(result.status, 'success')
  assert.equal(result.result?.bytesSent, originalBytes.byteLength)
  assert.deepEqual(originalBytes, snapshot, 'sandbox handoff must not mutate the existing command stream')

  await assert.rejects(
    submitSandboxPrintTask(originalBytes, '192.168.18.49', {
      taskId: 'sandbox-task-3',
      submitter: async () => ({
        contractVersion: '1.0',
        taskId: 'different-task',
        taskType: 'print',
        status: 'success',
      }),
    }),
    /INVALID_NATIVE_RESULT/,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

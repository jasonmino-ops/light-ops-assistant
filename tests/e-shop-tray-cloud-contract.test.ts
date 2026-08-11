import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { parseStoreRuntimePrintTaskCreateInput, parseStoreRuntimeTaskProgressInput, StoreRuntimeContractError } from '../lib/store-runtime/contract'

const bytes = Buffer.from([0x1b, 0x40, 0x1d, 0x56, 0x00])
const input = {
  taskType: 'PRINT_ESC_POS', schemaVersion: 1,
  idempotencyKey: 'eshop-tray:ORDER-1:request-0001', storeCode: 'ST169E7000',
  target: { type: 'WINDOWS_QUEUE', name: '前台' }, documentName: 'E-Shop ORDER-1',
  commandStream: { encoding: 'base64', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') },
}
assert.equal(parseStoreRuntimePrintTaskCreateInput(input).commandStream.byteLength, bytes.length)
assert.throws(() => parseStoreRuntimePrintTaskCreateInput({ ...input, target: { type: 'WINDOWS_QUEUE', name: '后厨' } }), (error) => error instanceof StoreRuntimeContractError && error.code === 'STORE_RUNTIME_INVALID_TARGET')
assert.throws(() => parseStoreRuntimePrintTaskCreateInput({ ...input, taskType: 'RUN_SCRIPT' }), (error) => error instanceof StoreRuntimeContractError && error.code === 'STORE_RUNTIME_UNSUPPORTED_TASK')
assert.deepEqual(parseStoreRuntimeTaskProgressInput({ state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER', effectBoundary: 'CROSSED', physicalCompletionKnown: false }), {
  state: 'SUCCEEDED', resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER', effectBoundary: 'CROSSED', physicalCompletionKnown: false,
})
assert.throws(() => parseStoreRuntimeTaskProgressInput({ state: 'SUCCEEDED', resultCode: 'PRINTED', effectBoundary: 'CROSSED', physicalCompletionKnown: true }))
console.log('E-Shop Tray Cloud Relay contract checks passed')

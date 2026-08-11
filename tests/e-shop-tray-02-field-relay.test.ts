import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  EshopTray02ContractError,
  parseEshopTray02PrintRequest,
} from '../lib/eShopTrayRelayContract'
import {
  isEshopTray02FieldStore,
  readEshopTray02FieldConfig,
} from '../lib/eShopTrayRelayField'

const bytes = Buffer.from([0x1b, 0x40, 0x1d, 0x56, 0x00])
const valid = {
  relayVersion: '0.1',
  requestId: 'field-request-001',
  orderNo: 'ORD-001',
  documentName: 'E-Shop ORD-001',
  target: { transport: 'windows-queue', queueName: '前台' },
  commandStream: {
    encoding: 'base64',
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    data: bytes.toString('base64'),
  },
}

assert.deepEqual(parseEshopTray02PrintRequest(valid), valid)

assert.throws(
  () => parseEshopTray02PrintRequest({ ...valid, target: { ...valid.target, queueName: '厨房' } }),
  (error: unknown) => error instanceof EshopTray02ContractError && error.code === 'ES_TRAY_02_INVALID_TARGET',
)

assert.throws(
  () => parseEshopTray02PrintRequest({
    ...valid,
    commandStream: { ...valid.commandStream, sha256: '0'.repeat(64) },
  }),
  (error: unknown) => error instanceof EshopTray02ContractError && error.code === 'ES_TRAY_02_COMMAND_DIGEST_MISMATCH',
)

const fieldEnv = {
  ES_TRAY_02_FIELD_STORE_CODE: 'STORE-A',
  ES_TRAY_02_FIELD_TOKEN: 'field-only-token-with-at-least-32-characters',
}
assert.deepEqual(readEshopTray02FieldConfig(fieldEnv), {
  storeCode: 'STORE-A',
  token: fieldEnv.ES_TRAY_02_FIELD_TOKEN,
})
assert.equal(isEshopTray02FieldStore('STORE-A', fieldEnv), true)
assert.equal(isEshopTray02FieldStore('STORE-B', fieldEnv), false)
assert.equal(readEshopTray02FieldConfig({ ...fieldEnv, ES_TRAY_02_FIELD_TOKEN: 'short' }), null)

console.log('ES-TRAY-02 FIELD relay contract tests passed')

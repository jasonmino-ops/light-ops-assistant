import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  hashPrintRequest,
  parseExecutingInput,
  parsePrintRequest,
  parseResultInput,
  RelayContractError,
} from '../lib/es-tray-relay/contract'

let cases = 0
function test(name: string, run: () => void) {
  run()
  cases += 1
  console.log(`PASS ${name}`)
}

const bytes = Buffer.from([0x1b, 0x40, 0x0a])
const input = {
  relayVersion: '0.1',
  requestId: 'contract-request-0001',
  orderNo: 'ORDER-001',
  documentName: '  receipt  ',
  target: { transport: 'windows-queue', queueName: '前台' },
  commandStream: {
    encoding: 'base64',
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    data: bytes.toString('base64'),
  },
}

test('the 0.1 Desktop request contract remains accepted and canonical', () => {
  const request = parsePrintRequest(input)
  assert.equal(request.documentName, 'receipt')
  assert.equal(request.target.queueName, '前台')
  assert.match(hashPrintRequest(request), /^[0-9a-f]{64}$/)
})

test('command stream tampering is rejected', () => {
  assert.throws(
    () => parsePrintRequest({ ...input, commandStream: { ...input.commandStream, data: Buffer.from('tampered').toString('base64') } }),
    (error: unknown) => error instanceof RelayContractError,
  )
})

test('executing requires schema, attempt, and a high-entropy claim token', () => {
  const proof = parseExecutingInput({
    schemaVersion: 1,
    claimAttempt: 2,
    claimToken: `ecp_v1_${'a'.repeat(43)}`,
  })
  assert.equal(proof.claimAttempt, 2)
  assert.throws(() => parseExecutingInput({ ...proof, claimToken: 'plaintext' }))
})

test('SUCCEEDED means CROSSED but never physical completion', () => {
  const success = parseResultInput({
    schemaVersion: 1,
    claimAttempt: 1,
    claimToken: `ecp_v1_${'b'.repeat(43)}`,
    state: 'SUCCEEDED',
    resultCode: 'SUBMITTED_TO_WINDOWS_SPOOLER',
    effectBoundary: 'CROSSED',
    physicalCompletionKnown: false,
  })
  assert.equal(success.physicalCompletionKnown, false)
  assert.throws(() => parseResultInput({ ...success, physicalCompletionKnown: true }))
  assert.throws(() => parseResultInput({ ...success, effectBoundary: 'CROSSING_UNKNOWN' }))
})

test('the enqueue response preserves the frozen Desktop 0.4.7 envelope', () => {
  const source = fs.readFileSync('app/api/es-tray-02/print-jobs/route.ts', 'utf8')
  assert.match(source, /fieldOnly:\s*true/)
  assert.match(source, /jobId:\s*result\.job\.id/)
  assert.match(source, /requestId:\s*request\.requestId/)
  assert.match(source, /status:\s*'PENDING_RECEIVE'/)
  assert.match(source, /productionContract:\s*true/)
  assert.match(source, /\{\s*status:\s*202\s*\}/)
})

console.log(`es-tray relay contract tests passed (${cases} cases)`)

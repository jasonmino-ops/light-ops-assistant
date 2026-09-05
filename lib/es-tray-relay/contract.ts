import { createHash } from 'node:crypto'
import {
  ES_TRAY_MAX_COMMAND_BYTES,
  ES_TRAY_QUEUE_NAME,
  ES_TRAY_RELAY_SCHEMA_VERSION,
  ES_TRAY_RELAY_VERSION,
} from './config'
import { isValidClaimToken } from './crypto'

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/
const ORDER_NO_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const RESULT_CODE_PATTERN = /^[A-Z0-9_:-]{3,80}$/

export type RelayEffectBoundary = 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED'

export type EshopTrayCommandStream = {
  encoding: 'base64'
  byteLength: number
  sha256: string
  data: string
}

export type EshopTrayPrintRequest = {
  relayVersion: typeof ES_TRAY_RELAY_VERSION
  requestId: string
  orderNo: string
  documentName: string
  target: {
    transport: 'windows-queue'
    queueName: typeof ES_TRAY_QUEUE_NAME
  }
  commandStream: EshopTrayCommandStream
}

export type RelayClaimProof = {
  schemaVersion: typeof ES_TRAY_RELAY_SCHEMA_VERSION
  claimAttempt: number
  claimToken: string
}

export type RelayTerminalResult = RelayClaimProof & {
  state: 'SUCCEEDED' | 'FAILED'
  resultCode: string
  resultMessage?: string
  effectBoundary: RelayEffectBoundary
  physicalCompletionKnown: false
}

export class RelayContractError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'RelayContractError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
}

function decodeCanonicalBase64(value: string): Buffer {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new RelayContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new RelayContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  }
  return decoded
}

export function parsePrintRequest(value: unknown): EshopTrayPrintRequest {
  const body = object(value)
  if (!body || !exactKeys(body, [
    'relayVersion', 'requestId', 'orderNo', 'documentName', 'target', 'commandStream',
  ])) throw new RelayContractError('ES_TRAY_02_INVALID_REQUEST')
  if (body.relayVersion !== ES_TRAY_RELAY_VERSION) {
    throw new RelayContractError('ES_TRAY_02_UNSUPPORTED_VERSION')
  }
  if (typeof body.requestId !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(body.requestId)) {
    throw new RelayContractError('ES_TRAY_02_INVALID_IDEMPOTENCY_KEY')
  }
  if (typeof body.orderNo !== 'string' || !ORDER_NO_PATTERN.test(body.orderNo)) {
    throw new RelayContractError('ES_TRAY_02_INVALID_ORDER_NO')
  }
  if (
    typeof body.documentName !== 'string'
    || body.documentName.trim().length === 0
    || body.documentName.length > 96
  ) throw new RelayContractError('ES_TRAY_02_INVALID_DOCUMENT_NAME')

  const target = object(body.target)
  if (
    !target
    || !exactKeys(target, ['transport', 'queueName'])
    || target.transport !== 'windows-queue'
    || target.queueName !== ES_TRAY_QUEUE_NAME
  ) throw new RelayContractError('ES_TRAY_02_INVALID_TARGET')

  const stream = object(body.commandStream)
  if (!stream || !exactKeys(stream, ['encoding', 'byteLength', 'sha256', 'data'])) {
    throw new RelayContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  }
  if (
    stream.encoding !== 'base64'
    || !Number.isInteger(stream.byteLength)
    || Number(stream.byteLength) < 1
    || Number(stream.byteLength) > ES_TRAY_MAX_COMMAND_BYTES
    || typeof stream.sha256 !== 'string'
    || !SHA256_PATTERN.test(stream.sha256)
    || typeof stream.data !== 'string'
  ) throw new RelayContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')

  const decoded = decodeCanonicalBase64(stream.data)
  if (decoded.byteLength !== Number(stream.byteLength)) {
    throw new RelayContractError('ES_TRAY_02_COMMAND_LENGTH_MISMATCH')
  }
  if (createHash('sha256').update(decoded).digest('hex') !== stream.sha256) {
    throw new RelayContractError('ES_TRAY_02_COMMAND_DIGEST_MISMATCH')
  }

  return {
    relayVersion: ES_TRAY_RELAY_VERSION,
    requestId: body.requestId,
    orderNo: body.orderNo,
    documentName: body.documentName.trim(),
    target: { transport: 'windows-queue', queueName: ES_TRAY_QUEUE_NAME },
    commandStream: {
      encoding: 'base64',
      byteLength: Number(stream.byteLength),
      sha256: stream.sha256,
      data: stream.data,
    },
  }
}

export function hashPrintRequest(request: EshopTrayPrintRequest) {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function parseClaimProof(body: Record<string, unknown>): RelayClaimProof {
  if (body.schemaVersion !== ES_TRAY_RELAY_SCHEMA_VERSION) {
    throw new RelayContractError('ES_TRAY_02_UNSUPPORTED_SCHEMA_VERSION')
  }
  if (!Number.isSafeInteger(body.claimAttempt) || Number(body.claimAttempt) < 1) {
    throw new RelayContractError('ES_TRAY_02_INVALID_CLAIM_ATTEMPT')
  }
  if (!isValidClaimToken(body.claimToken)) {
    throw new RelayContractError('ES_TRAY_02_INVALID_CLAIM_TOKEN')
  }
  return {
    schemaVersion: ES_TRAY_RELAY_SCHEMA_VERSION,
    claimAttempt: Number(body.claimAttempt),
    claimToken: body.claimToken,
  }
}

export function parseExecutingInput(value: unknown): RelayClaimProof {
  const body = object(value)
  if (!body || !exactKeys(body, ['schemaVersion', 'claimAttempt', 'claimToken'])) {
    throw new RelayContractError('ES_TRAY_02_INVALID_EXECUTING_REQUEST')
  }
  return parseClaimProof(body)
}

export function parseResultInput(value: unknown): RelayTerminalResult {
  const body = object(value)
  if (!body || !exactKeys(body, [
    'schemaVersion', 'claimAttempt', 'claimToken', 'state', 'resultCode',
    'effectBoundary', 'physicalCompletionKnown',
  ], ['resultMessage'])) throw new RelayContractError('ES_TRAY_02_INVALID_RESULT')
  const proof = parseClaimProof(body)
  if (body.state !== 'SUCCEEDED' && body.state !== 'FAILED') {
    throw new RelayContractError('ES_TRAY_02_INVALID_RESULT')
  }
  if (typeof body.resultCode !== 'string' || !RESULT_CODE_PATTERN.test(body.resultCode)) {
    throw new RelayContractError('ES_TRAY_02_INVALID_RESULT_CODE')
  }
  if (
    body.resultMessage !== undefined
    && (typeof body.resultMessage !== 'string' || body.resultMessage.length > 500)
  ) throw new RelayContractError('ES_TRAY_02_INVALID_RESULT_MESSAGE')
  if (!['NOT_CROSSED', 'CROSSING_UNKNOWN', 'CROSSED'].includes(String(body.effectBoundary))) {
    throw new RelayContractError('ES_TRAY_02_INVALID_EFFECT_BOUNDARY')
  }
  if (body.physicalCompletionKnown !== false) {
    throw new RelayContractError('ES_TRAY_02_PHYSICAL_COMPLETION_UNSUPPORTED')
  }
  if (body.state === 'SUCCEEDED' && body.effectBoundary !== 'CROSSED') {
    throw new RelayContractError('ES_TRAY_02_INVALID_SUCCESS_BOUNDARY')
  }
  return {
    ...proof,
    state: body.state,
    resultCode: body.resultCode,
    ...(body.resultMessage === undefined ? {} : { resultMessage: body.resultMessage }),
    effectBoundary: body.effectBoundary as RelayEffectBoundary,
    physicalCompletionKnown: false,
  }
}

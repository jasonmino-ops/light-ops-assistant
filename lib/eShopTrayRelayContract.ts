import { createHash } from 'node:crypto'
import {
  ES_TRAY_02_FIELD_QUEUE_NAME,
  ES_TRAY_02_MAX_COMMAND_BYTES,
  ES_TRAY_02_RELAY_VERSION,
} from './eShopTrayRelayField'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/
const ORDER_NO_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export type EshopTray02CommandStream = {
  encoding: 'base64'
  byteLength: number
  sha256: string
  data: string
}

export type EshopTray02PrintRequest = {
  relayVersion: typeof ES_TRAY_02_RELAY_VERSION
  requestId: string
  orderNo: string
  documentName: string
  target: {
    transport: 'windows-queue'
    queueName: typeof ES_TRAY_02_FIELD_QUEUE_NAME
  }
  commandStream: EshopTray02CommandStream
}

export class EshopTray02ContractError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'EshopTray02ContractError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function decodeCanonicalBase64(value: string): Buffer {
  if (
    value.length === 0
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new EshopTray02ContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new EshopTray02ContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  }
  return decoded
}

export function parseEshopTray02PrintRequest(value: unknown): EshopTray02PrintRequest {
  const body = object(value)
  if (!body || !exactKeys(body, [
    'relayVersion', 'requestId', 'orderNo', 'documentName', 'target', 'commandStream',
  ])) throw new EshopTray02ContractError('ES_TRAY_02_INVALID_REQUEST')
  if (body.relayVersion !== ES_TRAY_02_RELAY_VERSION) {
    throw new EshopTray02ContractError('ES_TRAY_02_UNSUPPORTED_VERSION')
  }
  if (typeof body.requestId !== 'string' || !REQUEST_ID_PATTERN.test(body.requestId)) {
    throw new EshopTray02ContractError('ES_TRAY_02_INVALID_REQUEST_ID')
  }
  if (typeof body.orderNo !== 'string' || !ORDER_NO_PATTERN.test(body.orderNo)) {
    throw new EshopTray02ContractError('ES_TRAY_02_INVALID_ORDER_NO')
  }
  if (
    typeof body.documentName !== 'string'
    || body.documentName.trim().length === 0
    || body.documentName.length > 96
  ) throw new EshopTray02ContractError('ES_TRAY_02_INVALID_DOCUMENT_NAME')

  const target = object(body.target)
  if (
    !target
    || !exactKeys(target, ['transport', 'queueName'])
    || target.transport !== 'windows-queue'
    || target.queueName !== ES_TRAY_02_FIELD_QUEUE_NAME
  ) throw new EshopTray02ContractError('ES_TRAY_02_INVALID_TARGET')

  const stream = object(body.commandStream)
  if (!stream || !exactKeys(stream, ['encoding', 'byteLength', 'sha256', 'data'])) {
    throw new EshopTray02ContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')
  }
  if (
    stream.encoding !== 'base64'
    || !Number.isInteger(stream.byteLength)
    || Number(stream.byteLength) < 1
    || Number(stream.byteLength) > ES_TRAY_02_MAX_COMMAND_BYTES
    || typeof stream.sha256 !== 'string'
    || !SHA256_PATTERN.test(stream.sha256)
    || typeof stream.data !== 'string'
  ) throw new EshopTray02ContractError('ES_TRAY_02_INVALID_COMMAND_STREAM')

  const decoded = decodeCanonicalBase64(stream.data)
  if (decoded.byteLength !== Number(stream.byteLength)) {
    throw new EshopTray02ContractError('ES_TRAY_02_COMMAND_LENGTH_MISMATCH')
  }
  if (createHash('sha256').update(decoded).digest('hex') !== stream.sha256) {
    throw new EshopTray02ContractError('ES_TRAY_02_COMMAND_DIGEST_MISMATCH')
  }

  return {
    relayVersion: ES_TRAY_02_RELAY_VERSION,
    requestId: body.requestId,
    orderNo: body.orderNo,
    documentName: body.documentName.trim(),
    target: { transport: 'windows-queue', queueName: ES_TRAY_02_FIELD_QUEUE_NAME },
    commandStream: {
      encoding: 'base64',
      byteLength: Number(stream.byteLength),
      sha256: stream.sha256,
      data: stream.data,
    },
  }
}

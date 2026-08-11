import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import {
  ESHOP_TRAY_MAX_COMMAND_BYTES,
  PrintDeliveryError,
  type PrintDelivery,
} from './printing/windowsQueueTransport'

export const ESHOP_TRAY_PROTOCOL_VERSION = '0.1' as const
export const ESHOP_TRAY_PORT = 17631 as const
export const ESHOP_TRAY_ALLOWED_ORIGINS = new Set([
  'https://elifekh.com',
  'https://www.elifekh.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

const MAX_REQUEST_BODY_BYTES = 11 * 1024 * 1024
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

export type PrintTransport = {
  isBusy(): boolean
  deliver(commandStream: Uint8Array, documentName: string): Promise<PrintDelivery>
}

type LocalApiOptions = {
  version: string
  transport: PrintTransport
  allowedOrigins?: ReadonlySet<string>
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

type PrintRequest = {
  protocolVersion: typeof ESHOP_TRAY_PROTOCOL_VERSION
  requestId: string
  commandStream: {
    encoding: 'base64'
    byteLength: number
    sha256: string
    data: string
  }
}

class LocalApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code)
    this.name = 'LocalApiError'
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false
  }
  return octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
}

function allowedHostHeader(value: string | undefined): boolean {
  if (!value) return false
  const hostname = value.startsWith('[')
    ? value.slice(1, value.indexOf(']')).toLowerCase()
    : value.split(':')[0].toLowerCase()
  return hostname === 'localhost'
    || hostname === 'e-shop-tray.local'
    || isPrivateIpv4(hostname)
    || hostname === '::1'
    || hostname.startsWith('fe80:')
    || hostname.startsWith('fc')
    || hostname.startsWith('fd')
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function parsePrintRequest(value: unknown): { request: PrintRequest; bytes: Uint8Array } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LocalApiError(400, 'INVALID_REQUEST')
  }
  const body = value as Record<string, unknown>
  if (!hasExactKeys(body, ['protocolVersion', 'requestId', 'commandStream'])) {
    throw new LocalApiError(400, 'INVALID_REQUEST')
  }
  if (body.protocolVersion !== ESHOP_TRAY_PROTOCOL_VERSION) {
    throw new LocalApiError(400, 'UNSUPPORTED_PROTOCOL')
  }
  if (typeof body.requestId !== 'string' || !REQUEST_ID_PATTERN.test(body.requestId)) {
    throw new LocalApiError(400, 'INVALID_REQUEST_ID')
  }
  if (!body.commandStream || typeof body.commandStream !== 'object' || Array.isArray(body.commandStream)) {
    throw new LocalApiError(400, 'INVALID_COMMAND_STREAM')
  }
  const stream = body.commandStream as Record<string, unknown>
  if (!hasExactKeys(stream, ['encoding', 'byteLength', 'sha256', 'data'])) {
    throw new LocalApiError(400, 'INVALID_COMMAND_STREAM')
  }
  if (
    stream.encoding !== 'base64'
    || !Number.isInteger(stream.byteLength)
    || Number(stream.byteLength) <= 0
    || Number(stream.byteLength) > ESHOP_TRAY_MAX_COMMAND_BYTES
    || typeof stream.sha256 !== 'string'
    || !SHA256_PATTERN.test(stream.sha256)
    || typeof stream.data !== 'string'
    || stream.data.length === 0
    || stream.data.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(stream.data)
  ) {
    throw new LocalApiError(400, 'INVALID_COMMAND_STREAM')
  }
  const decoded = Buffer.from(stream.data, 'base64')
  if (decoded.byteLength !== Number(stream.byteLength) || decoded.toString('base64') !== stream.data) {
    throw new LocalApiError(400, 'COMMAND_STREAM_LENGTH_MISMATCH')
  }
  const digest = createHash('sha256').update(decoded).digest('hex')
  if (digest !== stream.sha256) {
    throw new LocalApiError(400, 'COMMAND_STREAM_DIGEST_MISMATCH')
  }
  return {
    request: body as PrintRequest,
    bytes: Uint8Array.from(decoded),
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') throw new LocalApiError(415, 'JSON_REQUIRED')
  const declaredLength = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    throw new LocalApiError(413, 'REQUEST_TOO_LARGE')
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_REQUEST_BODY_BYTES) throw new LocalApiError(413, 'REQUEST_TOO_LARGE')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new LocalApiError(400, 'INVALID_JSON')
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const encoded = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(encoded))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(encoded)
}

function applyCors(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-E-Shop-Tray-Protocol')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Max-Age', '600')
  res.setHeader('Vary', 'Origin, Access-Control-Request-Private-Network')
}

function isAllowedOrigin(req: IncomingMessage, allowedOrigins: ReadonlySet<string>): boolean {
  const origin = req.headers.origin
  return typeof origin === 'string' && allowedOrigins.has(origin)
}

export function createLocalApi(options: LocalApiOptions): Server {
  const allowedOrigins = options.allowedOrigins ?? ESHOP_TRAY_ALLOWED_ORIGINS
  const logger = options.logger ?? console
  const server = createServer(async (req, res) => {
    try {
      if (!allowedHostHeader(req.headers.host)) throw new LocalApiError(421, 'INVALID_HOST')
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
      if (url.search) throw new LocalApiError(404, 'NOT_FOUND')
      const allowedOrigin = isAllowedOrigin(req, allowedOrigins)
      if (allowedOrigin) applyCors(res, String(req.headers.origin))

      if (req.method === 'OPTIONS') {
        if (url.pathname !== '/v1/health' && url.pathname !== '/v1/print') {
          throw new LocalApiError(404, 'NOT_FOUND')
        }
        if (!allowedOrigin) throw new LocalApiError(403, 'ORIGIN_FORBIDDEN')
        res.statusCode = 204
        res.end()
        return
      }

      if (url.pathname === '/v1/health' && req.method === 'GET') {
        if (req.headers.origin && !allowedOrigin) throw new LocalApiError(403, 'ORIGIN_FORBIDDEN')
        writeJson(res, 200, {
          service: 'e-shop-tray',
          version: options.version,
          protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
          status: options.transport.isBusy() ? 'busy' : 'online',
        })
        return
      }

      if (url.pathname === '/v1/print' && req.method === 'POST') {
        if (!allowedOrigin) throw new LocalApiError(403, 'ORIGIN_FORBIDDEN')
        if (req.headers['x-e-shop-tray-protocol'] !== ESHOP_TRAY_PROTOCOL_VERSION) {
          throw new LocalApiError(400, 'UNSUPPORTED_PROTOCOL')
        }
        if (options.transport.isBusy()) throw new LocalApiError(409, 'TRAY_BUSY')
        const { request, bytes } = parsePrintRequest(await readJsonBody(req))
        const delivery = await options.transport.deliver(bytes, `E-Shop ${request.requestId}`)
        logger.info('[e-shop-tray] print delivered', {
          requestId: request.requestId,
          bytesWritten: delivery.bytesWritten,
          durationMs: delivery.durationMs,
        })
        writeJson(res, 200, {
          protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
          requestId: request.requestId,
          status: 'success',
          delivery,
        })
        return
      }

      if (url.pathname === '/v1/health' || url.pathname === '/v1/print') {
        throw new LocalApiError(405, 'METHOD_NOT_ALLOWED')
      }
      throw new LocalApiError(404, 'NOT_FOUND')
    } catch (error) {
      const mapped = error instanceof LocalApiError
        ? error
        : error instanceof PrintDeliveryError && error.code === 'TRAY_BUSY'
          ? new LocalApiError(409, 'TRAY_BUSY')
          : new LocalApiError(503, 'PRINT_DELIVERY_FAILED')
      if (mapped.status >= 500) logger.error('[e-shop-tray] request failed', mapped.code)
      else if (mapped.status !== 404) logger.warn('[e-shop-tray] request rejected', mapped.code)
      if (!res.headersSent) {
        writeJson(res, mapped.status, {
          protocolVersion: ESHOP_TRAY_PROTOCOL_VERSION,
          status: 'failure',
          error: { code: mapped.code },
        })
      } else {
        res.end()
      }
    }
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  return server
}

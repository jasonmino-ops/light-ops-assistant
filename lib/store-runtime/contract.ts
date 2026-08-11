export const STORE_RUNTIME_SCHEMA_VERSION = 1 as const
export const STORE_RUNTIME_TASK_TYPE = 'PRINT_ESC_POS' as const
export const STORE_RUNTIME_TARGET_TYPE = 'WINDOWS_QUEUE' as const
export const STORE_RUNTIME_MAX_COMMAND_BYTES = 3 * 1024 * 1024

export type StoreRuntimeCommandStream = {
  encoding: 'base64'
  byteLength: number
  sha256: string
  data: string
}

export type StoreRuntimePrintTaskCreateInput = {
  taskType: typeof STORE_RUNTIME_TASK_TYPE
  schemaVersion: typeof STORE_RUNTIME_SCHEMA_VERSION
  idempotencyKey: string
  storeCode: string
  target: { type: typeof STORE_RUNTIME_TARGET_TYPE; name: string }
  documentName: string
  commandStream: StoreRuntimeCommandStream
}

export type StoreRuntimeTaskProgressInput =
  | { state: 'EXECUTING' }
  | {
      state: 'SUCCEEDED' | 'FAILED'
      resultCode: string
      message?: string
      effectBoundary: 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED'
      physicalCompletionKnown: false
    }

export class StoreRuntimeContractError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'StoreRuntimeContractError'
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function validBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0
}

export function parseStoreRuntimePrintTaskCreateInput(value: unknown): StoreRuntimePrintTaskCreateInput {
  const body = record(value)
  if (!body || !exactKeys(body, [
    'taskType', 'schemaVersion', 'idempotencyKey', 'storeCode', 'target', 'documentName', 'commandStream',
  ])) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_PAYLOAD')
  if (body.taskType !== STORE_RUNTIME_TASK_TYPE) throw new StoreRuntimeContractError('STORE_RUNTIME_UNSUPPORTED_TASK')
  if (body.schemaVersion !== STORE_RUNTIME_SCHEMA_VERSION) throw new StoreRuntimeContractError('STORE_RUNTIME_UNSUPPORTED_SCHEMA')
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9:_-]{16,160}$/.test(body.idempotencyKey)) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_IDEMPOTENCY_KEY')
  }
  if (typeof body.storeCode !== 'string' || !/^[A-Z0-9_-]{4,64}$/.test(body.storeCode)) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_STORE')
  }
  const target = record(body.target)
  if (!target || !exactKeys(target, ['type', 'name']) || target.type !== STORE_RUNTIME_TARGET_TYPE || target.name !== '前台') {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_TARGET')
  }
  if (typeof body.documentName !== 'string' || body.documentName.trim().length < 1 || body.documentName.length > 96) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_DOCUMENT_NAME')
  }
  const commandStream = record(body.commandStream)
  if (!commandStream || !exactKeys(commandStream, ['encoding', 'byteLength', 'sha256', 'data'])) {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_COMMAND_STREAM')
  }
  if (
    commandStream.encoding !== 'base64'
    || !Number.isInteger(commandStream.byteLength)
    || Number(commandStream.byteLength) < 1
    || Number(commandStream.byteLength) > STORE_RUNTIME_MAX_COMMAND_BYTES
    || typeof commandStream.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(commandStream.sha256)
    || typeof commandStream.data !== 'string'
    || !validBase64(commandStream.data)
    || Buffer.byteLength(commandStream.data, 'base64') !== commandStream.byteLength
  ) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_COMMAND_STREAM')

  return {
    taskType: STORE_RUNTIME_TASK_TYPE,
    schemaVersion: STORE_RUNTIME_SCHEMA_VERSION,
    idempotencyKey: body.idempotencyKey,
    storeCode: body.storeCode,
    target: { type: STORE_RUNTIME_TARGET_TYPE, name: '前台' },
    documentName: body.documentName.trim(),
    commandStream: {
      encoding: 'base64',
      byteLength: Number(commandStream.byteLength),
      sha256: commandStream.sha256,
      data: commandStream.data,
    },
  }
}

export function parseStoreRuntimeTaskProgressInput(value: unknown): StoreRuntimeTaskProgressInput {
  const body = record(value)
  if (!body || typeof body.state !== 'string') throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
  if (body.state === 'EXECUTING') {
    if (!exactKeys(body, ['state'])) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
    return { state: 'EXECUTING' }
  }
  if (body.state !== 'SUCCEEDED' && body.state !== 'FAILED') {
    throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
  }
  const allowedKeys = body.message === undefined
    ? ['state', 'resultCode', 'effectBoundary', 'physicalCompletionKnown']
    : ['state', 'resultCode', 'message', 'effectBoundary', 'physicalCompletionKnown']
  if (
    !exactKeys(body, allowedKeys)
    || typeof body.resultCode !== 'string'
    || !/^[A-Z0-9_]{3,80}$/.test(body.resultCode)
    || (body.message !== undefined && (typeof body.message !== 'string' || body.message.length > 240))
    || !['NOT_CROSSED', 'CROSSING_UNKNOWN', 'CROSSED'].includes(String(body.effectBoundary))
    || body.physicalCompletionKnown !== false
  ) throw new StoreRuntimeContractError('STORE_RUNTIME_INVALID_RESULT')
  return {
    state: body.state,
    resultCode: body.resultCode,
    ...(typeof body.message === 'string' ? { message: body.message } : {}),
    effectBoundary: body.effectBoundary as 'NOT_CROSSED' | 'CROSSING_UNKNOWN' | 'CROSSED',
    physicalCompletionKnown: false,
  }
}

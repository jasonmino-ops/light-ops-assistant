export const MOBILE_RUNTIME_CONTRACT_VERSION = '1.0' as const
export const MOBILE_RUNTIME_PRINT_TASK_TYPE = 'print' as const
export const MOBILE_RUNTIME_RAW_TCP_PORT = 9100 as const

export type NativePrintTaskV1 = {
  contractVersion: typeof MOBILE_RUNTIME_CONTRACT_VERSION
  taskId: string
  taskType: typeof MOBILE_RUNTIME_PRINT_TASK_TYPE
  payload: {
    target: {
      host: string
      port: typeof MOBILE_RUNTIME_RAW_TCP_PORT
    }
    commandStream: {
      encoding: 'base64'
      byteLength: number
      data: string
    }
  }
}

export type NativeTaskResultV1 = {
  contractVersion: typeof MOBILE_RUNTIME_CONTRACT_VERSION
  taskId: string
  taskType: typeof MOBILE_RUNTIME_PRINT_TASK_TYPE
  status: 'success' | 'failure'
  result?: {
    bytesSent: number
    durationMs: number
  }
  error?: {
    code: string
    stage: 'validate' | 'connect' | 'send' | 'close' | 'runtime'
    retryable: boolean
  }
}

export type NativeTaskSubmitter = (task: NativePrintTaskV1) => Promise<unknown>

declare global {
  interface Window {
    eshopMobileRuntime?: {
      contractVersion: string
      submitTask(task: NativePrintTaskV1): Promise<unknown>
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    for (let index = 0; index < chunk.length; index += 1) {
      binary += String.fromCharCode(chunk[index])
    }
  }
  return btoa(binary)
}

function createTaskId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `print-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildSandboxPrintTask(
  commandStream: Uint8Array,
  printerHost: string,
  taskId = createTaskId(),
): NativePrintTaskV1 {
  if (!(commandStream instanceof Uint8Array) || commandStream.byteLength === 0) {
    throw new Error('INVALID_COMMAND_STREAM')
  }
  return {
    contractVersion: MOBILE_RUNTIME_CONTRACT_VERSION,
    taskId,
    taskType: MOBILE_RUNTIME_PRINT_TASK_TYPE,
    payload: {
      target: {
        host: printerHost,
        port: MOBILE_RUNTIME_RAW_TCP_PORT,
      },
      commandStream: {
        encoding: 'base64',
        byteLength: commandStream.byteLength,
        data: bytesToBase64(commandStream),
      },
    },
  }
}

function injectedSubmitter(): NativeTaskSubmitter {
  const runtime = typeof window !== 'undefined' ? window.eshopMobileRuntime : undefined
  if (!runtime || runtime.contractVersion !== MOBILE_RUNTIME_CONTRACT_VERSION) {
    throw new Error('MOBILE_RUNTIME_UNAVAILABLE')
  }
  return (task) => runtime.submitTask(task)
}

function parseResult(value: unknown, task: NativePrintTaskV1): NativeTaskResultV1 {
  if (!value || typeof value !== 'object') throw new Error('INVALID_NATIVE_RESULT')
  const result = value as Partial<NativeTaskResultV1>
  if (
    result.contractVersion !== MOBILE_RUNTIME_CONTRACT_VERSION
    || result.taskId !== task.taskId
    || result.taskType !== MOBILE_RUNTIME_PRINT_TASK_TYPE
    || (result.status !== 'success' && result.status !== 'failure')
  ) {
    throw new Error('INVALID_NATIVE_RESULT')
  }
  return result as NativeTaskResultV1
}

/**
 * Sandbox-only handoff. Production pages do not import this module.
 * The caller supplies the existing ESC/POS Uint8Array without modification.
 */
export async function submitSandboxPrintTask(
  commandStream: Uint8Array,
  printerHost: string,
  options?: {
    taskId?: string
    submitter?: NativeTaskSubmitter
  },
): Promise<NativeTaskResultV1> {
  const task = buildSandboxPrintTask(commandStream, printerHost, options?.taskId)
  const rawResult = await (options?.submitter ?? injectedSubmitter())(task)
  return parseResult(rawResult, task)
}

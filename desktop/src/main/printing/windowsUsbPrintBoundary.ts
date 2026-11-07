import { spawn } from 'node:child_process'
import { win32 } from 'node:path'
import { createInterface } from 'node:readline'
import type { EffectBoundaryResult, PrintingEffectBoundary } from './sharedPrintingCore'
import { readWindowsUsbEndpointKey, type WindowsUsbEndpoint } from './windowsUsbEndpoint'
import { WINDOWS_USB_SPOOLER_SCRIPT } from './windowsUsbSpoolerScript'
import { logger } from '../logger'

const MAX_BYTES = 3 * 1024 * 1024
const PROBE_TIMEOUT_MS = 5_000
const SUBMISSION_TIMEOUT_MS = 10_000
const ENCODED_SCRIPT = Buffer.from(WINDOWS_USB_SPOOLER_SCRIPT, 'utf16le').toString('base64')

interface UsbPrintWorker {
  ready(): Promise<boolean>
  submit(): Promise<number | null>
  close(): void
}

type OpenWorker = (endpoint: WindowsUsbEndpoint, bytes?: Uint8Array) => UsbPrintWorker

function openWindowsWorker(endpoint: WindowsUsbEndpoint, bytes?: Uint8Array): UsbPrintWorker {
  const root = process.env.SystemRoot
  if (process.platform !== 'win32' || root?.toLowerCase() !== 'c:\\windows') throw new Error('USB_SPOOLER_UNAVAILABLE')
  const system = win32.join(root, 'System32')
  const powershell = win32.join(system, 'WindowsPowerShell', 'v1.0')
  const exe = win32.join(powershell, 'powershell.exe')
  const child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_SCRIPT],
    {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
      cwd: system,
      env: {
        SystemRoot: root,
        WINDIR: root,
        PATH: system,
        PSModulePath: win32.join(powershell, 'Modules'),
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        USERPROFILE: process.env.USERPROFILE,
        LOCALAPPDATA: process.env.LOCALAPPDATA,
      },
    })
  const reader = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const iterator = reader[Symbol.asyncIterator]()
  let failed!: (value: null) => void
  const failure = new Promise<null>((resolve) => { failed = resolve })
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    failed(null)
    reader.close()
    child.stdin.destroy()
    child.kill()
  }
  const timer = setTimeout(close, bytes ? SUBMISSION_TIMEOUT_MS : PROBE_TIMEOUT_MS)
  child.once('error', close)
  child.stdin.once('error', close)
  child.stdout.once('error', close)
  const next = () => Promise.race([iterator.next().then((line) => line.done ? null : line.value), failure])
  child.stdin.write(JSON.stringify(bytes
    ? { endpoint, mode: 'print', payload: Buffer.from(bytes).toString('base64') }
    : { endpoint, mode: 'probe' }) + '\n')
  return {
    async ready() { return await next() === 'READY' },
    async submit() {
      if (closed || !bytes) return null
      child.stdin.end('GO\n')
      const match = /^SPOOLED:([1-9][0-9]{0,9})$/.exec(await next() ?? '')
      const id = match ? Number(match[1]) : 0
      return id > 0 && id <= 0xffffffff ? id : null
    },
    close,
  }
}

function notCrossed(errorCode: string): EffectBoundaryResult {
  return { outcome: 'NOT_CROSSED', zeroBytesSent: true, errorCode }
}

export class WindowsUsbPrintBoundary implements PrintingEffectBoundary<Uint8Array> {
  public constructor(private readonly openWorker: OpenWorker = openWindowsWorker) {}

  public async isReady(endpointKey: string): Promise<boolean> {
    const endpoint = readWindowsUsbEndpointKey(endpointKey)
    if (!endpoint) return false
    let worker: UsbPrintWorker | undefined
    try {
      worker = this.openWorker(endpoint)
      return await worker.ready()
    } catch {
      return false
    } finally {
      worker?.close()
    }
  }

  public async cross(input: Parameters<PrintingEffectBoundary<Uint8Array>['cross']>[0]): Promise<EffectBoundaryResult> {
    const endpoint = readWindowsUsbEndpointKey(input.endpointKey)
    if (!endpoint || input.payload.byteLength === 0 || input.payload.byteLength > MAX_BYTES) {
      return notCrossed('USB_BOUNDARY_INPUT_INVALID')
    }

    let worker: UsbPrintWorker | undefined
    let submissionStarted = false
    try {
      worker = this.openWorker(endpoint, input.payload)
      if (!await worker.ready()) return notCrossed('USB_QUEUE_NOT_READY')
      const admission = await input.validateExecution()
      if (!admission.ok) return notCrossed(admission.error.code)
      if (!(Date.parse(input.identity.expiresAt) > Date.now())) return notCrossed('USB_JOB_EXPIRED')
      submissionStarted = true
      const spoolerJobId = await worker.submit()
      if (spoolerJobId === null || !Number.isInteger(spoolerJobId) || spoolerJobId <= 0 || spoolerJobId > 0xffffffff) {
        return { outcome: 'UNKNOWN', reason: 'USB_SPOOLER_RESULT_UNKNOWN' }
      }
      logger.info('v3-print-usb.spooled', { executionId: input.executionPermit.executionId, spoolerJobId })
      return { outcome: 'CROSSED', spoolerJobId, rawDocumentCommitted: true }
    } catch {
      return submissionStarted
        ? { outcome: 'UNKNOWN', reason: 'USB_SPOOLER_RESULT_UNKNOWN' }
        : notCrossed('USB_PRE_SUBMIT_FAILED')
    } finally {
      worker?.close()
    }
  }
}

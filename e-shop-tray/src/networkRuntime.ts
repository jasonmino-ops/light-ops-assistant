import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import type { CloudRelayClient } from './cloudRelayClient'
import type { ExecutionJournal } from './executionJournal'
import { NETWORK_MAX_BYTES, parseNetworkRequest, type NetworkRequest } from './networkContract'
import { resolveNetworkEndpoint, type NetworkNode, type NetworkPrinterConfig } from './networkNodeConfig'
import { NetworkDeliveryError, type NetworkRawTcpTransport } from './printing/networkRawTcpTransport'
import type { RelayPoller } from './relayPoller'
import type { RelayEventRecorder } from './resultLog'

type RelayClientPort = Pick<CloudRelayClient, 'receive' | 'markExecuting' | 'reportResult'>
type NetworkStrategy = NonNullable<ConstructorParameters<typeof RelayPoller>[0]['network']>
type Nodes = { read(): Promise<NetworkPrinterConfig> }
export type NetworkEndpointValidator = (endpoint: NetworkNode) => unknown | Promise<unknown>
type Guards = { assertIdentity(): Promise<void>; nodes: Nodes; validateEndpoint: NetworkEndpointValidator }

/** One explicit activation boundary; journal initialization must never race
 * an active claim. Repeated clicks cannot reload an executing journal. */
export async function activateNetworkPrinting(options: {
  isEnabled(): boolean; stopAndWait(): Promise<void>; validate(): Promise<void>;
  persistEnabled(): Promise<void>; start(): void
}): Promise<void> {
  if (options.isEnabled()) throw new Error('ADDON_ALREADY_ENABLED')
  await options.stopAndWait()
  await options.validate()
  await options.persistEnabled()
  options.start()
}

/** Explicit local TEST uses the same byte transport, not the cloud mailbox.
 * A durable intent exists before this function; restart never repeats it. */
export async function submitLocalNetworkTest(options: {
  verify(): Promise<void>; deliver(): Promise<unknown>;
  finish(outcome: 'SUBMITTED' | 'NOT_CROSSED' | 'UNKNOWN'): Promise<void>
}): Promise<void> {
  let invoked = false
  try {
    await options.verify()
    invoked = true
    await options.deliver()
  } catch (error) {
    const notCrossed = !invoked || (error instanceof NetworkDeliveryError && error.effectBoundary === 'NOT_CROSSED')
    await options.finish(notCrossed ? 'NOT_CROSSED' : 'UNKNOWN')
    throw error
  }
  await options.finish('SUBMITTED')
}

/** The existing receive guard, shared with the commercial entry. ACK recovery stays independent. */
export function createGuardedNetworkClient(options: Guards & {
  journal: Pick<ExecutionJournal, 'records'>; client: RelayClientPort
}): RelayClientPort {
  return {
    async receive() {
      await options.assertIdentity()
      const config = await options.nodes.read()
      await options.validateEndpoint(config.endpoint)
      // A reported/quarantined/lost ACK must never erase an uncertain physical effect.
      if (options.journal.records().some(record => record.effectBoundary === 'CROSSING_UNKNOWN')) {
        throw new Error('NETWORK_UNCERTAIN_EFFECT_REQUIRES_REVIEW')
      }
      return options.client.receive()
    },
    markExecuting: options.client.markExecuting.bind(options.client),
    reportResult: options.client.reportResult.bind(options.client),
  }
}

async function preDelivery<T>(operation: () => Promise<T> | T, code: string): Promise<T> {
  try { return await operation() }
  catch (cause) {
    // No transport has been called. Preserve a safe diagnostic code without claiming uncertainty.
    const message = cause instanceof Error && /^NETWORK_[A-Z0-9_]+$/.test(cause.message) ? cause.message : code
    throw new NetworkDeliveryError(message, 'NOT_CROSSED')
  }
}

/** Extracted from the reviewed Network entry; it supplies the existing RelayPoller's strategy. */
export function createNetworkStrategy(options: Guards & {
  identity: { storeCode: string }
  render(request: NetworkRequest): Promise<Uint8Array>
  recorder: RelayEventRecorder
  transport: Pick<NetworkRawTcpTransport, 'deliver'>
}): NetworkStrategy {
  return {
    async prepare(job) {
      await options.assertIdentity()
      if (job.schemaVersion !== 2 || !job.network) throw new Error('NETWORK_JOB_REQUIRED')
      const request = parseNetworkRequest(job.network)
      const config = await options.nodes.read()
      if (request.order.storeCode !== options.identity.storeCode) throw new Error('NETWORK_STORE_MISMATCH')
      const mode = config.mode
      const endpoint = Object.freeze({ ...resolveNetworkEndpoint(config, request) })
      await options.validateEndpoint(endpoint)
      const rendered = await options.render(request)
      if (!(rendered instanceof Uint8Array) || !rendered.byteLength || rendered.byteLength > NETWORK_MAX_BYTES) {
        throw new Error('NETWORK_RENDER_SIZE')
      }
      const bytes = Uint8Array.from(rendered)
      try {
        await options.recorder.record({ event: `NETWORK_PREPARED_${request.role}`, jobId: job.id,
          commandBytes: bytes.byteLength, ...{ orderNo: job.orderNo, role: request.role, mode: request.mode,
            bytesSha256: createHash('sha256').update(bytes).digest('hex') } })
      } catch {
        // Ordinary diagnostics are best-effort. The existing poller owns mandatory journal durability.
      }
      return async () => {
        await preDelivery(() => options.assertIdentity(), 'NETWORK_IDENTITY_UNAVAILABLE')
        const latest = await preDelivery(() => options.nodes.read(), 'NETWORK_CONFIG_UNAVAILABLE')
        if (latest.mode !== mode || latest.endpoint.host !== endpoint.host || latest.endpoint.port !== endpoint.port) {
          throw new NetworkDeliveryError('NETWORK_CONFIG_CHANGED', 'NOT_CROSSED')
        }
        const selected = await preDelivery(() => options.validateEndpoint(endpoint), 'NETWORK_ENDPOINT_REVALIDATION_FAILED')
        if (selected && typeof selected === 'object' && 'localAddress' in selected && typeof selected.localAddress === 'string') {
          return options.transport.deliver(bytes, endpoint, selected.localAddress)
        }
        return options.transport.deliver(bytes, endpoint)
      }
    },
    failure(error) {
      return error instanceof NetworkDeliveryError ? { resultCode: error.code, effectBoundary: error.effectBoundary }
        : { resultCode: 'NETWORK_EXECUTION_FAILED', effectBoundary: 'CROSSING_UNKNOWN' }
    },
  }
}

export type NetworkRenderer = { render(request: NetworkRequest): Promise<Uint8Array>; dispose(): void }

/** One sandboxed local DOM adapter; the receipt templates, bitmap renderer and encoder stay shared. */
export function createNetworkRenderer(options: {
  electron: Pick<typeof import('electron'), 'BrowserWindow' | 'ipcMain'>
  distDirectory: string
}): NetworkRenderer {
  const { BrowserWindow: Window, ipcMain } = options.electron
  let window: BrowserWindow | null = null
  let busy = false, disposed = false
  let cancel: (() => void) | null = null
  const destroy = () => {
    if (window && !window.isDestroyed()) window.destroy()
    window = null
  }
  return {
    async render(value) {
      if (disposed) throw new Error('NETWORK_RENDER_DISPOSED')
      if (busy) throw new Error('NETWORK_RENDER_BUSY')
      busy = true
      try {
        const request = parseNetworkRequest(value)
        const needsLoad = !window || window.isDestroyed()
        if (needsLoad) {
          window = new Window({ show: false, webPreferences: { sandbox: true, contextIsolation: true,
            nodeIntegration: false, backgroundThrottling: false, partition: 'network-print-render',
            preload: path.join(options.distDirectory, 'network-render.cjs') } })
          const web = window.webContents
          web.setWindowOpenHandler(() => ({ action: 'deny' }))
          web.on('will-navigate', event => event.preventDefault())
          web.on('will-attach-webview', event => event.preventDefault())
          web.session.setPermissionRequestHandler((_web, _permission, callback) => callback(false))
          web.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
            (_details, callback) => callback({ cancel: true }))
        }
        const active = window!
        const renderId = randomUUID()
        return await new Promise<Uint8Array>((resolve, reject) => {
          let finished = false
          const finish = (bytes?: Uint8Array) => {
            if (finished) return
            finished = true
            clearTimeout(timer)
            ipcMain.off('network:rendered', onResult)
            active.off('closed', failed)
            active.webContents.off('render-process-gone', failed)
            cancel = null
            if (bytes) resolve(bytes)
            else { destroy(); reject(new Error('NETWORK_RENDER_FAILED')) }
          }
          const failed = () => finish()
          const onResult = (event: IpcMainEvent, value: { renderId?: unknown; bytes?: unknown }) => {
            if (event.sender !== active.webContents || event.senderFrame !== active.webContents.mainFrame
              || value?.renderId !== renderId) return
            const bytes = value.bytes
            if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > NETWORK_MAX_BYTES) finish()
            else finish(Uint8Array.from(bytes))
          }
          // Bound loadFile and the renderer reply together; failed/crashed windows are never reused.
          const timer = setTimeout(failed, 12_000)
          cancel = failed
          ipcMain.on('network:rendered', onResult)
          active.once('closed', failed)
          active.webContents.once('render-process-gone', failed)
          const loaded = needsLoad ? active.loadFile(path.join(options.distDirectory, 'network-render.html')) : Promise.resolve()
          loaded.then(() => {
            if (!finished) active.webContents.send('network:render', { renderId, request })
          }).catch(failed)
        })
      } catch (error) {
        destroy()
        throw error
      } finally { busy = false }
    },
    dispose() { disposed = true; cancel?.(); destroy() },
  }
}

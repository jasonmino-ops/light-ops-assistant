import fs from 'node:fs'
import http from 'node:http'
import { pathToFileURL } from 'node:url'

const maxReply = 4 * 1024 * 1024 + 16_384
export function rendererInput(claim) {
  return Object.fromEntries(['tenantId', 'storeId', 'orderNo', 'role', 'schemaVersion', 'snapshotJson', 'snapshotHash', 'profileId', 'deadlineAt'].map(key => [key, claim[key]]))
}
export function replyIdentity(claim) {
  return Object.fromEntries(['intentId', 'tenantId', 'storeId', 'orderNo', 'role', 'schemaVersion', 'snapshotHash', 'profileId', 'revision', 'token'].map(key => [key, claim[key]]))
}
export function socketCall(socketPath, method, route, body, timeout = 25_000) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, method, path: route, headers: { 'Content-Type': 'application/json' } }, response => {
      const chunks = []; let length = 0
      response.on('data', chunk => { length += chunk.length; if (length > maxReply) request.destroy(Error('RENDER_REPLY_LIMIT')); else chunks.push(chunk) })
      response.once('error', reject)
      response.once('end', () => {
        try { const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (response.statusCode !== 200) reject(Error(result.error ?? 'RENDER_UNAVAILABLE')); else resolve(result) } catch (error) { reject(error) }
      })
    })
    const timer = setTimeout(() => request.destroy(Error('RENDER_TIMEOUT')), timeout)
    request.once('close', () => clearTimeout(timer)); request.once('error', reject)
    request.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
export function createApiTransport(endpoint, token, fetcher = fetch) {
  const url = new URL(endpoint)
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== '/api/customer-order-renderer') throw Error('H5_RENDER_API_HTTPS_REQUIRED')
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw Error('H5_RENDER_CREDENTIAL_INVALID')
  return async (action, result) => {
    const response = await fetcher(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 1, action, ...(result ? { result } : {}) }) })
    if (!response.ok) { await response.body?.cancel(); throw Error('H5_RENDER_API_UNAVAILABLE') }
    const reader = response.body.getReader(); const chunks = []; let length = 0
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 160 * 1024) throw Error('H5_RENDER_API_REPLY_LIMIT'); chunks.push(value) }
    } finally { await reader.cancel().catch(() => {}) }
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed.protocol !== 1 || typeof parsed.kind !== 'string') throw Error('H5_RENDER_API_PROTOCOL')
    return parsed
  }
}
export async function controllerStep({ api, renderer, state, now = Date.now }) {
  if (state.pending) {
    if (Date.parse(state.pending.leaseExpiresAt) <= now()) { state.pending = null; return { kind: 'LATE_DROPPED' } }
    const result = await api(state.pending.action, state.pending.result)
    if (['SEALED', 'ALREADY_SEALED', 'WAITING', 'MANUAL_REVIEW', 'EXPIRED', 'TERMINAL', 'STALE', 'NOT_FOUND', 'CONFLICT', 'NOT_RELEASED', 'INVALID', 'INVALID_BYTES'].includes(result.kind)) state.pending = null
    else throw Error('H5_RENDER_UNEXPECTED_RESULT')
    return result
  }
  const health = await renderer('health')
  if (!health.ready || health.busy) return { kind: 'HOST_NOT_READY' }
  const response = await api('claim')
  if (response.kind !== 'CLAIMED') return response
  const claim = response.claim
  const identity = replyIdentity(claim)
  if (claim.profileId !== health.profileId) {
    state.pending = { action: 'failure', result: { ...identity, code: 'RENDER_SELF_CHECK_FAILED' }, leaseExpiresAt: claim.leaseExpiresAt }
    return { kind: 'REPORT_PENDING' }
  }
  try {
    const rendered = await renderer('render', rendererInput(claim))
    state.pending = { action: 'result', result: { ...identity, payloadBase64: rendered.payloadBase64, byteLength: rendered.byteLength, payloadHash: rendered.payloadHash, rendererVersion: rendered.rendererVersion }, leaseExpiresAt: claim.leaseExpiresAt }
  } catch (error) {
    state.pending = { action: 'failure', result: { ...identity, code: error?.message === 'RENDER_TIMEOUT' ? 'RENDER_TIMEOUT' : 'RENDER_FAILED' }, leaseExpiresAt: claim.leaseExpiresAt }
  }
  return { kind: 'REPORT_PENDING' }
}
export async function startController({ api, renderer, port = 9461, interval = 2000 }) {
  const state = { pending: null }; let stopping = false; let timer; let failures = 0
  const health = { alive: true, rendererReady: false, dispatchReady: false, lastSuccessAt: null }
  const server = http.createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(health))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  const loop = async () => {
    let delay = interval
    try {
      const result = await controllerStep({ api, renderer, state })
      health.rendererReady = result.kind !== 'HOST_NOT_READY'; health.dispatchReady = true; health.lastSuccessAt = new Date().toISOString(); failures = 0
      if (['REPORT_PENDING', 'SEALED', 'JOB'].includes(result.kind)) delay = 10
    } catch { health.dispatchReady = false; failures += 1; delay = Math.min(30_000, interval * 2 ** Math.min(failures, 4)) }
    if (!stopping) timer = setTimeout(loop, delay)
  }
  loop()
  return { address: server.address(), close: async () => { stopping = true; clearTimeout(timer); await new Promise(resolve => server.close(resolve)) } }
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.getuid?.() === 0) throw Error('CONTROLLER_ROOT_FORBIDDEN')
  const credentialPath = process.env.CREDENTIALS_DIRECTORY + '/worker-token'
  const token = fs.readFileSync(credentialPath, 'utf8').trim()
  const api = createApiTransport(process.env.H5_RENDER_API_URL, token)
  const controller = await startController({ api, renderer: (action, input) => socketCall('/run/es-h5-renderer/renderer.sock', action === 'health' ? 'GET' : 'POST', '/' + action, input) })
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.close().then(() => process.exit(0)))
}

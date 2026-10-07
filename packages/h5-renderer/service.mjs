import http from 'node:http'
import fs from 'node:fs'
import { createRenderer, LIMITS } from './module.mjs'
import { pathToFileURL } from 'node:url'

export async function startRenderService({ socketPath, inheritedFd, rendererFactory = createRenderer, exit = code => process.exit(code) }) {
  if (process.getuid?.() === 0) throw Error('RENDER_ROOT_FORBIDDEN')
  if (!inheritedFd && (!socketPath?.startsWith('/') || fs.existsSync(socketPath))) throw Error('RENDER_SOCKET_NOT_FRESH')
  let busy = false
  let closing = false
  const renderer = await rendererFactory()
  const sockets = new Set()
  const server = http.createServer(async (request, response) => {
    const reply = (status, body) => { if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(body)) } }
    if (request.url === '/health' && request.method === 'GET') return reply(200, { ready: !closing, busy, profileId: renderer.profileId })
    if (request.url !== '/render' || request.method !== 'POST') return reply(404, { error: 'NOT_FOUND' })
    if (closing || busy) return reply(503, { error: 'RENDER_BUSY' })
    busy = true
    let timer
    let workStarted = false
    try {
      const chunks = []; let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > LIMITS.input + 8192) throw Error('RENDER_INPUT_LIMIT')
        chunks.push(chunk)
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const deadline = Math.min(LIMITS.deadlineMs, Date.parse(input.deadlineAt) - Date.now())
      if (!Number.isFinite(deadline) || deadline <= 0) throw Error('RENDER_EXPIRED')
      workStarted = true
      const result = await Promise.race([
        renderer.render(input),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('RENDER_TIMEOUT')), deadline) }),
      ])
      if (Buffer.byteLength(JSON.stringify(result)) > 4 * 1024 * 1024 + 8192) throw Error('RENDER_OUTPUT_LIMIT')
      reply(200, { ok: true, ...result })
    } catch (error) {
      const code = error?.message === 'RENDER_TIMEOUT' ? 'RENDER_TIMEOUT' : 'RENDER_FAILED'
      reply(workStarted ? 503 : 400, { error: code })
      if (workStarted) {
        closing = true
        server.close()
        setTimeout(() => exit(1), 250).unref()
        renderer.close().catch(() => {})
      }
    } finally { clearTimeout(timer); busy = false }
  })
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.timeout = 25_000
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(inheritedFd ? { fd: inheritedFd } : { path: socketPath }, resolve)
  })
  if (!inheritedFd) fs.chmodSync(socketPath, 0o660)
  return { profileId: renderer.profileId, close: async () => {
    closing = true
    for (const socket of sockets) socket.destroy()
    await Promise.all([new Promise(resolve => server.close(resolve)), renderer.close()])
    if (!inheritedFd && fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
  } }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.env.H5_RENDER_TOKEN || process.env.DATABASE_URL || process.env.DIRECT_URL || process.env.H5_RENDER_WORKER_CONFIG) throw Error('RENDER_CREDENTIAL_ENV_FORBIDDEN')
  const inheritedFd = process.env.LISTEN_PID === String(process.pid) && process.env.LISTEN_FDS === '1' ? 3 : undefined
  const service = await startRenderService({ socketPath: '/run/es-h5-renderer/renderer.sock', inheritedFd })
  console.log(JSON.stringify({ event: 'renderer_ready', profileId: service.profileId }))
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    setTimeout(() => process.exit(1), 4000).unref()
    service.close().then(() => process.exit(0)).catch(() => process.exit(1))
  })
}

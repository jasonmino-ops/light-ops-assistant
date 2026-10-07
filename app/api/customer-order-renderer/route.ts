import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRenderWorker, configuredRenderWorker, renderRequestAllowed, H5_RENDER_MAX_BODY, H5_RENDER_PROTOCOL,
  claimCustomerOrderRender, sealCustomerOrderRender, failCustomerOrderRender } from '@/lib/customer-order-render-dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  // No cookie, DEV header, Desktop token or CRON_SECRET is accepted here.
  const worker = authenticateRenderWorker(req.headers.get('authorization'), configuredRenderWorker())
  if (!worker) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 })
  if (!renderRequestAllowed(worker.workerId)) return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429 })
  if (!req.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'JSON_REQUIRED' }, { status: 415 })
  let body: any
  try {
    if (Number(req.headers.get('content-length')) > H5_RENDER_MAX_BODY) throw new Error('BODY_LIMIT')
    const reader = req.body?.getReader()
    if (!reader) throw new Error('EMPTY_BODY')
    const parts: Uint8Array[] = []; let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.length
        if (length > H5_RENDER_MAX_BODY) throw new Error('BODY_LIMIT')
        parts.push(value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    body = JSON.parse(Buffer.concat(parts).toString('utf8'))
    if (!body || body.protocol !== H5_RENDER_PROTOCOL || !['claim', 'result', 'failure'].includes(body.action)) throw new Error('INVALID_PROTOCOL')
    if (body.action === 'claim' && Object.keys(body).some((k) => !['protocol', 'action'].includes(k))) throw new Error('INVALID_CLAIM')
    if (body.action !== 'claim' && (!body.result || typeof body.result !== 'object' || Array.isArray(body.result))) throw new Error('INVALID_RESULT')
  } catch { return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 }) }
  try {
    const result = body.action === 'claim' ? await claimCustomerOrderRender(prisma as any, worker)
      : body.action === 'result' ? await sealCustomerOrderRender(prisma as any, worker, body.result)
      : await failCustomerOrderRender(prisma as any, worker, body.result)
    return NextResponse.json({ protocol: H5_RENDER_PROTOCOL, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    // Do not echo snapshots, tokens, credentials or database exception text.
    return NextResponse.json({ error: 'RENDER_DISPATCH_UNAVAILABLE' }, { status: 503 })
  }
}

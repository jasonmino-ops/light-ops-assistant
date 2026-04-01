import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * GET /api/health
 * Diagnostic endpoint — check DB connectivity, env vars, and auth context.
 * Safe to call publicly; never returns secrets.
 */
export async function GET(req: NextRequest) {
  const urlSet = !!process.env.DATABASE_URL

  // Auth context check (no MISSING_CONTEXT error — just diagnostic)
  const ctx = getContext(req)
  const authInfo = ctx
    ? { authed: true, userId: ctx.userId, role: ctx.role, storeId: ctx.storeId }
    : { authed: false, hasCookie: !!req.cookies.get('auth-session')?.value }

  const envInfo = {
    hasAuthSecret: !!process.env.AUTH_SECRET,
    hasBotToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasTenantId: !!process.env.TENANT_ID,
    tenantId: process.env.TENANT_ID ?? '(unset → seed-tenant-001)',
    nodeEnv: process.env.NODE_ENV,
  }

  if (!urlSet) {
    return NextResponse.json(
      { ok: false, reason: 'DATABASE_URL not configured', auth: authInfo, env: envInfo },
      { status: 503 },
    )
  }

  try {
    const productCount = await prisma.product.count()
    const tenantCount = await prisma.tenant.count()
    const userCount = await prisma.user.count()
    const boundUserCount = await prisma.user.count({ where: { telegramId: { not: null } } })

    return NextResponse.json({
      ok: true,
      db: { productCount, tenantCount, userCount, boundUserCount },
      auth: authInfo,
      env: envInfo,
    })
  } catch (e) {
    const msg = String(e).replace(/postgres(ql)?:\/\/[^@]+@/gi, 'postgres://***@')
    return NextResponse.json(
      { ok: false, reason: 'DB connection failed', detail: msg, auth: authInfo, env: envInfo },
      { status: 503 },
    )
  }
}

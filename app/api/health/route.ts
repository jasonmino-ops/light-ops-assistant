import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/health
 * Diagnostic endpoint — check DB connectivity and product count.
 * Safe to call publicly; never returns credentials.
 */
export async function GET() {
  const urlSet = !!process.env.DATABASE_URL

  if (!urlSet) {
    return NextResponse.json(
      { ok: false, reason: 'DATABASE_URL not configured in environment' },
      { status: 503 },
    )
  }

  try {
    const productCount = await prisma.product.count()
    const tenantCount = await prisma.tenant.count()
    return NextResponse.json({ ok: true, productCount, tenantCount })
  } catch (e) {
    // Strip any credentials from the error message before returning
    const msg = String(e).replace(/postgres(ql)?:\/\/[^@]+@/gi, 'postgres://***@')
    return NextResponse.json(
      { ok: false, reason: 'DB connection failed', detail: msg },
      { status: 503 },
    )
  }
}

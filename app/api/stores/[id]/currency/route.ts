import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { isSupportedCurrencyCode, normalizeCurrencyCode } from '@/lib/currency'

/**
 * PATCH /api/stores/:id/currency — OWNER only
 * Updates one store's display currency. It does not convert stored amounts.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { id } = await params
  let body: { currencyCode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  if (!isSupportedCurrencyCode(body.currencyCode)) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'currencyCode must be USD or XAF' },
      { status: 400 },
    )
  }
  const currencyCode = normalizeCurrencyCode(body.currencyCode)

  const store = await prisma.store.findFirst({
    where: { id, tenantId: ctx.tenantId },
    select: { id: true },
  })
  if (!store) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const updated = await prisma.store.update({
    where: { id },
    data: { currencyCode },
    select: { id: true, name: true, currencyCode: true },
  })

  return NextResponse.json(updated)
}

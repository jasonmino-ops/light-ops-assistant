import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

/**
 * PATCH /api/stores/:id/checkout-mode  — OWNER only
 * Updates the checkoutMode for a store.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  }

  const { id } = await params

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_BODY' }, { status: 400 })
  }

  const { checkoutMode } = body as { checkoutMode?: string }
  if (checkoutMode !== 'DIRECT_PAYMENT' && checkoutMode !== 'DEFERRED_PAYMENT') {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', message: 'checkoutMode must be DIRECT_PAYMENT or DEFERRED_PAYMENT' },
      { status: 400 },
    )
  }

  const store = await prisma.store.findFirst({
    where: { id, tenantId: ctx.tenantId },
  })
  if (!store) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  const updated = await prisma.store.update({
    where: { id },
    data: { checkoutMode },
    select: { id: true, name: true, checkoutMode: true },
  })

  return NextResponse.json(updated)
}

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext } from '@/lib/ops-auth'
import {
  computeRenewal,
  ensureMigratedSubscriptionForTenant,
  serializeSubscription,
  serializeSubscriptionEvent,
  validateRenewalInput,
  type RenewalInput,
} from '@/lib/subscription'

type RenewalReplayLookup =
  | { kind: 'miss' }
  | { kind: 'conflict' }
  | { kind: 'replay'; subscription: NonNullable<Awaited<ReturnType<typeof prisma.tenantSubscription.findUnique>>>; event: NonNullable<Awaited<ReturnType<typeof prisma.subscriptionEvent.findUnique>>> }

type RenewalDb = Prisma.TransactionClient | typeof prisma

function isIdempotencyKeyP2002(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const target = error.meta?.target
  if (Array.isArray(target)) return target.includes('idempotencyKey')
  return typeof target === 'string' && target.includes('idempotencyKey')
}

async function findIdempotentReplay(
  db: RenewalDb,
  tenantId: string,
  idempotencyKey: string,
): Promise<RenewalReplayLookup> {
  const event = await db.subscriptionEvent.findUnique({
    where: { idempotencyKey },
  })
  if (!event) return { kind: 'miss' }
  if (event.tenantId !== tenantId) return { kind: 'conflict' }

  const subscription = await db.tenantSubscription.findUnique({
    where: { id: event.subscriptionId },
  })
  if (!subscription || subscription.tenantId !== tenantId) return { kind: 'conflict' }

  return { kind: 'replay', subscription, event }
}

function renewalSuccessResponse(
  result: {
    subscription: NonNullable<Awaited<ReturnType<typeof prisma.tenantSubscription.findUnique>>>
    event: NonNullable<Awaited<ReturnType<typeof prisma.subscriptionEvent.findUnique>>>
    idempotentReplay: boolean
  },
) {
  return NextResponse.json({
    success: true,
    subscription: serializeSubscription(result.subscription),
    event: serializeSubscriptionEvent(result.event),
    duplicate: result.idempotentReplay,
    idempotentReplay: result.idempotentReplay,
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (ops.role === 'BD') return NextResponse.json({ error: 'FORBIDDEN', message: 'BD 角色无续费权限' }, { status: 403 })

  const { tenantId } = await params
  let body: RenewalInput
  try {
    const raw = await req.json()
    body = {
      months: Number(raw?.months),
      amount: raw?.amount == null ? null : String(raw.amount),
      currency: raw?.currency == null ? null : String(raw.currency),
      paymentReference: raw?.paymentReference == null ? null : String(raw.paymentReference),
      note: raw?.note == null ? null : String(raw.note),
      idempotencyKey: raw?.idempotencyKey == null ? '' : String(raw.idempotencyKey).trim(),
    }
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  const validated = validateRenewalInput(body)
  if (!validated.ok) return NextResponse.json({ error: validated.error, message: validated.message }, { status: 400 })

  try {
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      })
      if (!tenant) return { error: 'NOT_FOUND' as const }

      const initialReplay = await findIdempotentReplay(tx, tenantId, body.idempotencyKey)
      if (initialReplay.kind === 'conflict') return { error: 'IDEMPOTENCY_KEY_CONFLICT' as const }
      if (initialReplay.kind === 'replay') return { ...initialReplay, idempotentReplay: true }

      await ensureMigratedSubscriptionForTenant(tx, tenantId)
      await tx.$queryRaw`SELECT "id" FROM "TenantSubscription" WHERE "tenantId" = ${tenantId} FOR UPDATE`

      const lockedReplay = await findIdempotentReplay(tx, tenantId, body.idempotencyKey)
      if (lockedReplay.kind === 'conflict') return { error: 'IDEMPOTENCY_KEY_CONFLICT' as const }
      if (lockedReplay.kind === 'replay') return { ...lockedReplay, idempotentReplay: true }

      const subscription = await tx.tenantSubscription.findUniqueOrThrow({ where: { tenantId } })
      const now = new Date()
      const renewal = computeRenewal(subscription, body.months, now)

      const updated = await tx.tenantSubscription.update({
        where: { id: subscription.id },
        data: {
          status: renewal.nextStatus,
          currentPeriodStartedAt: renewal.currentPeriodStartedAt,
          currentPeriodEndsAt: renewal.nextPeriodEndsAt,
        },
      })

      const event = await tx.subscriptionEvent.create({
        data: {
          tenantId,
          subscriptionId: updated.id,
          eventType: renewal.eventType,
          previousStatus: renewal.previousStatus,
          nextStatus: renewal.nextStatus,
          previousPeriodEndsAt: renewal.previousPeriodEndsAt,
          nextPeriodEndsAt: renewal.nextPeriodEndsAt,
          monthsAdded: body.months,
          amount: validated.amount,
          currency: validated.currency,
          paymentReference: validated.paymentReference,
          note: validated.note,
          operatorId: ops.userId,
          idempotencyKey: body.idempotencyKey,
        },
      })

      return { subscription: updated, event, idempotentReplay: false }
    })

    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : 409
      return NextResponse.json({ error: result.error }, { status })
    }

    return renewalSuccessResponse(result)
  } catch (error) {
    if (isIdempotencyKeyP2002(error)) {
      const replay = await findIdempotentReplay(prisma, tenantId, body.idempotencyKey)
      if (replay.kind === 'replay') {
        return renewalSuccessResponse({ ...replay, idempotentReplay: true })
      }
      return NextResponse.json({ error: 'IDEMPOTENCY_KEY_CONFLICT' }, { status: 409 })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      console.error('[subscription renew] unique constraint failed:', error)
      return NextResponse.json({ error: 'UNIQUE_CONSTRAINT_FAILED' }, { status: 409 })
    }
    console.error('[subscription renew] failed:', error)
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 })
  }
}

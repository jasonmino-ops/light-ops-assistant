import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

export const SUBSCRIPTION_STATUS = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const

export const SUBSCRIPTION_EVENT = {
  TRIAL_STARTED: 'TRIAL_STARTED',
  TRIAL_ADJUSTED: 'TRIAL_ADJUSTED',
  ACTIVATED: 'ACTIVATED',
  RENEWED: 'RENEWED',
  PERIOD_ADJUSTED: 'PERIOD_ADJUSTED',
  MIGRATED: 'MIGRATED',
} as const

type SubscriptionDb = Prisma.TransactionClient | PrismaClient

type SubscriptionRow = {
  id: string
  tenantId: string
  status: string
  trialStartedAt: Date | null
  trialEndsAt: Date | null
  currentPeriodStartedAt: Date | null
  currentPeriodEndsAt: Date | null
}

export type RenewalInput = {
  months: number
  amount?: string | null
  currency?: string | null
  paymentReference?: string | null
  note?: string | null
  idempotencyKey: string
}

export type RenewalCalculation = {
  previousStatus: string
  nextStatus: string
  previousPeriodEndsAt: Date | null
  nextPeriodEndsAt: Date
  currentPeriodStartedAt: Date
  eventType: string
}

function lastDayOfMonthUtc(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export function addNaturalMonthsClamped(date: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 1) throw new Error('months must be a positive integer')
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const targetMonth = month + months
  const targetYear = year + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const clampedDay = Math.min(day, lastDayOfMonthUtc(targetYear, normalizedMonth))
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    clampedDay,
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  ))
}

export function computeRenewal(
  subscription: SubscriptionRow,
  months: number,
  confirmedAt: Date,
): RenewalCalculation {
  const previousPeriodEndsAt = subscription.currentPeriodEndsAt

  if (subscription.status === SUBSCRIPTION_STATUS.TRIAL) {
    const trialEndsAt = subscription.trialEndsAt
    const baseTime = trialEndsAt && trialEndsAt.getTime() > confirmedAt.getTime()
      ? trialEndsAt
      : confirmedAt
    return {
      previousStatus: subscription.status,
      nextStatus: SUBSCRIPTION_STATUS.ACTIVE,
      previousPeriodEndsAt,
      currentPeriodStartedAt: confirmedAt,
      nextPeriodEndsAt: addNaturalMonthsClamped(baseTime, months),
      eventType: SUBSCRIPTION_EVENT.ACTIVATED,
    }
  }

  const existingEnd = subscription.currentPeriodEndsAt
  const baseTime = existingEnd && existingEnd.getTime() > confirmedAt.getTime()
    ? existingEnd
    : confirmedAt

  return {
    previousStatus: subscription.status,
    nextStatus: SUBSCRIPTION_STATUS.ACTIVE,
    previousPeriodEndsAt,
    currentPeriodStartedAt: subscription.currentPeriodStartedAt ?? confirmedAt,
    nextPeriodEndsAt: addNaturalMonthsClamped(baseTime, months),
    eventType: SUBSCRIPTION_EVENT.RENEWED,
  }
}

export function validateRenewalInput(input: RenewalInput): {
  ok: true
  amount: Prisma.Decimal | null
  currency: string | null
  paymentReference: string | null
  note: string | null
} | {
  ok: false
  error: string
  message?: string
} {
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 12) {
    return { ok: false, error: 'INVALID_MONTHS', message: 'months must be an integer from 1 to 12' }
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 120) {
    return { ok: false, error: 'INVALID_IDEMPOTENCY_KEY' }
  }

  const amountText = input.amount == null ? '' : String(input.amount).trim()
  if (amountText && !/^\d{1,10}(\.\d{1,2})?$/.test(amountText)) {
    return { ok: false, error: 'INVALID_AMOUNT', message: 'amount must be a decimal with up to 2 places' }
  }

  const currency = input.currency == null ? '' : String(input.currency).trim().toUpperCase()
  if (currency && !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'INVALID_CURRENCY' }

  const paymentReference = input.paymentReference == null ? '' : String(input.paymentReference).trim()
  if (paymentReference.length > 120) return { ok: false, error: 'PAYMENT_REFERENCE_TOO_LONG' }

  const note = input.note == null ? '' : String(input.note).trim()
  if (note.length > 500) return { ok: false, error: 'NOTE_TOO_LONG' }

  return {
    ok: true,
    amount: amountText ? new Prisma.Decimal(amountText) : null,
    currency: currency || null,
    paymentReference: paymentReference || null,
    note: note || null,
  }
}

export async function createTrialSubscriptionForTenant(
  tx: SubscriptionDb,
  tenant: { id: string; createdAt: Date },
  operatorId: string,
) {
  const trialStartedAt = tenant.createdAt
  const trialEndsAt = addNaturalMonthsClamped(trialStartedAt, 1)
  const subscription = await tx.tenantSubscription.create({
    data: {
      tenantId: tenant.id,
      status: SUBSCRIPTION_STATUS.TRIAL,
      trialStartedAt,
      trialEndsAt,
    },
  })
  await tx.subscriptionEvent.create({
    data: {
      tenantId: tenant.id,
      subscriptionId: subscription.id,
      eventType: SUBSCRIPTION_EVENT.TRIAL_STARTED,
      nextStatus: SUBSCRIPTION_STATUS.TRIAL,
      nextPeriodEndsAt: trialEndsAt,
      operatorId,
      idempotencyKey: `trial-started:${tenant.id}`,
    },
  })
  return subscription
}

export async function ensureMigratedSubscriptionForTenant(
  tx: SubscriptionDb,
  tenantId: string,
  operatorId = 'system:lazy-migration',
) {
  const existing = await tx.tenantSubscription.findUnique({ where: { tenantId } })
  if (existing) return existing

  const subscription = await tx.tenantSubscription.create({
    data: {
      tenantId,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    },
  })
  await tx.subscriptionEvent.create({
    data: {
      tenantId,
      subscriptionId: subscription.id,
      eventType: SUBSCRIPTION_EVENT.MIGRATED,
      nextStatus: SUBSCRIPTION_STATUS.ACTIVE,
      operatorId,
      idempotencyKey: `lazy-migrated:${tenantId}`,
    },
  })
  return subscription
}

export function serializeSubscription(subscription: SubscriptionRow) {
  return {
    id: subscription.id,
    tenantId: subscription.tenantId,
    status: subscription.status,
    trialStartedAt: subscription.trialStartedAt?.toISOString() ?? null,
    trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
    currentPeriodStartedAt: subscription.currentPeriodStartedAt?.toISOString() ?? null,
    currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null,
  }
}

export function serializeSubscriptionEvent(event: {
  id: string
  eventType: string
  previousStatus: string | null
  nextStatus: string | null
  previousPeriodEndsAt: Date | null
  nextPeriodEndsAt: Date | null
  monthsAdded: number | null
  amount: Prisma.Decimal | null
  currency: string | null
  paymentReference: string | null
  note: string | null
  operatorId: string
  idempotencyKey: string
  createdAt: Date
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    previousStatus: event.previousStatus,
    nextStatus: event.nextStatus,
    previousPeriodEndsAt: event.previousPeriodEndsAt?.toISOString() ?? null,
    nextPeriodEndsAt: event.nextPeriodEndsAt?.toISOString() ?? null,
    monthsAdded: event.monthsAdded,
    amount: event.amount?.toString() ?? null,
    currency: event.currency,
    paymentReference: event.paymentReference,
    note: event.note,
    operatorId: event.operatorId,
    idempotencyKey: event.idempotencyKey,
    createdAt: event.createdAt.toISOString(),
  }
}

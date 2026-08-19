export const SUBSCRIPTION_REMINDER_DAYS = 15
export const SUBSCRIPTION_GRACE_DAYS = 3

const DAY_MS = 24 * 60 * 60 * 1000
const REMINDER_WINDOW_MS = SUBSCRIPTION_REMINDER_DAYS * DAY_MS
const GRACE_WINDOW_MS = SUBSCRIPTION_GRACE_DAYS * DAY_MS

export type SubscriptionReminderDisplayState = 'NORMAL' | 'REMIND' | 'GRACE' | 'EXPIRED'

export type SubscriptionReminderInput = {
  status: string | null
  trialEndsAt: Date | string | null
  currentPeriodEndsAt: Date | string | null
}

export type SubscriptionReminderResult = {
  storedStatus: string | null
  displayState: SubscriptionReminderDisplayState
  expiry: string | null
  graceEndsAt: string | null
}

function normal(storedStatus: string | null): SubscriptionReminderResult {
  return {
    storedStatus,
    displayState: 'NORMAL',
    expiry: null,
    graceEndsAt: null,
  }
}

function toValidDate(value: Date | string | null): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Computes the runtime reminder used by OWNER /home and Ops. It never changes
 * the stored subscription status or writes to the database.
 */
export function computeSubscriptionReminder(
  subscription: SubscriptionReminderInput | null,
  now = new Date(),
): SubscriptionReminderResult {
  if (!subscription) return normal(null)

  const storedStatus = subscription.status
  if (storedStatus === 'EXPIRED' || storedStatus === 'CANCELLED') {
    return {
      storedStatus,
      displayState: 'EXPIRED',
      expiry: null,
      graceEndsAt: null,
    }
  }

  const expiryValue = storedStatus === 'TRIAL'
    ? subscription.trialEndsAt
    : storedStatus === 'ACTIVE'
      ? subscription.currentPeriodEndsAt
      : null
  const expiry = toValidDate(expiryValue)

  // Historical ACTIVE subscriptions without an end date remain unrestricted
  // and do not show any reminder.
  if (!expiry) return normal(storedStatus)

  const expiryMs = expiry.getTime()
  const nowMs = now.getTime()
  const graceEndsAt = new Date(expiryMs + GRACE_WINDOW_MS)

  if (nowMs < expiryMs) {
    return {
      storedStatus,
      displayState: expiryMs - nowMs <= REMINDER_WINDOW_MS ? 'REMIND' : 'NORMAL',
      expiry: expiry.toISOString(),
      graceEndsAt: graceEndsAt.toISOString(),
    }
  }

  return {
    storedStatus,
    displayState: nowMs < graceEndsAt.getTime() ? 'GRACE' : 'EXPIRED',
    expiry: expiry.toISOString(),
    graceEndsAt: graceEndsAt.toISOString(),
  }
}

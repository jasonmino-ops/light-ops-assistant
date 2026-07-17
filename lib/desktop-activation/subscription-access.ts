import type { Prisma, PrismaClient } from '@prisma/client'
import { ensureMigratedSubscriptionForTenant, SUBSCRIPTION_STATUS } from '@/lib/subscription'

export type DesktopSubscriptionAccessState = 'ALLOWED' | 'BLOCKED'

export type DesktopSubscriptionAccess = {
  accessState: DesktopSubscriptionAccessState
  status: string
  warning: string | null
}

type DesktopSubscriptionDb = Prisma.TransactionClient | PrismaClient

export function computeDesktopSubscriptionAccess(status: string): DesktopSubscriptionAccess {
  if (status === SUBSCRIPTION_STATUS.TRIAL || status === SUBSCRIPTION_STATUS.ACTIVE) {
    return { accessState: 'ALLOWED', status, warning: null }
  }
  if (status === SUBSCRIPTION_STATUS.EXPIRED || status === SUBSCRIPTION_STATUS.CANCELLED) {
    return { accessState: 'BLOCKED', status, warning: null }
  }
  return { accessState: 'BLOCKED', status, warning: null }
}

export async function resolveDesktopSubscriptionAccess(
  db: DesktopSubscriptionDb,
  tenantId: string,
): Promise<DesktopSubscriptionAccess> {
  const subscription = await ensureMigratedSubscriptionForTenant(db, tenantId, 'system:desktop-activation')
  return computeDesktopSubscriptionAccess(subscription.status)
}

export function isDesktopSubscriptionAllowed(access: DesktopSubscriptionAccess) {
  return access.accessState === 'ALLOWED'
}

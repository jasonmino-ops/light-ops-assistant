import {
  computeSubscriptionReminder,
  type SubscriptionReminderInput,
  type SubscriptionReminderResult,
} from './subscription-reminder'

type TenantSubscriptionRecord = SubscriptionReminderInput & {
  tenantId: string
}

export type OpsTenantWithSubscriptionReminder<T extends { id: string }> = T & {
  subscriptionReminder: SubscriptionReminderResult
}

export function attachOpsSubscriptionReminders<T extends { id: string }>(
  tenants: readonly T[],
  subscriptions: readonly TenantSubscriptionRecord[],
  now = new Date(),
): OpsTenantWithSubscriptionReminder<T>[] {
  const subscriptionByTenant = new Map<string, TenantSubscriptionRecord>()
  for (const subscription of subscriptions) {
    subscriptionByTenant.set(subscription.tenantId, subscription)
  }

  return tenants.map((tenant) => ({
    ...tenant,
    subscriptionReminder: computeSubscriptionReminder(
      subscriptionByTenant.get(tenant.id) ?? null,
      now,
    ),
  }))
}

export function getOpsRenewalDueTenants<T extends { id: string; subscriptionReminder: SubscriptionReminderResult }>(
  tenants: readonly T[],
): T[] {
  const uniqueDueTenants = new Map<string, T>()
  for (const tenant of tenants) {
    if (tenant.subscriptionReminder.displayState === 'NORMAL') continue
    if (!uniqueDueTenants.has(tenant.id)) uniqueDueTenants.set(tenant.id, tenant)
  }
  return Array.from(uniqueDueTenants.values())
}

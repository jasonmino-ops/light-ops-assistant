import type { NetworkMode, NetworkRole } from '../../e-shop-tray/src/networkContract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Fail-closed confirmation for the cashier-facing enqueue result. */
export function parseConfirmedCashierNetworkRoles(
  value: unknown,
  expectedMode: NetworkMode,
): NetworkRole[] | null {
  if (!isRecord(value)
    || value.profile !== 'network-v2'
    || value.state !== 'QUEUED'
    || value.mode !== expectedMode
    || !Array.isArray(value.jobs)) return null

  if (value.kitchenJobSuppressed !== undefined
    && typeof value.kitchenJobSuppressed !== 'boolean') return null

  const roles: NetworkRole[] = []
  for (const job of value.jobs) {
    if (!isRecord(job) || (job.role !== 'FRONT' && job.role !== 'KITCHEN')) return null
    roles.push(job.role)
  }

  if (expectedMode === 'FRONT_ONLY' && value.kitchenJobSuppressed === true) return null
  const expectedRoles: NetworkRole[] = expectedMode === 'SHARED_PRINTER'
    && value.kitchenJobSuppressed === true
    ? ['FRONT']
    : expectedMode === 'SHARED_PRINTER'
      ? ['FRONT', 'KITCHEN']
      : ['FRONT']

  return roles.length === expectedRoles.length
    && roles.every((role, index) => role === expectedRoles[index])
    ? roles
    : null
}

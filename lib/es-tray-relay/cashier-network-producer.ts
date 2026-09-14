import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { NETWORK_PROFILE, parseNetworkRequest, type NetworkMode, type NetworkSnapshot } from '../../e-shop-tray/src/networkContract'
import { readRelayTimingConfig } from './config'
import { enqueueRelayPrintJob, type RelayStoreScope } from './service'

/** Caller MUST pass its sale transaction. No network I/O or post-commit enqueue. */
export async function enqueueCashierNetworkJobs(
  tx: Prisma.TransactionClient,
  scope: RelayStoreScope,
  snapshot: NetworkSnapshot,
  mode: NetworkMode,
  kitchenItems?: NetworkSnapshot['items'],
) {
  if (mode !== 'FRONT_ONLY' && mode !== 'SHARED_PRINTER') throw new Error('NETWORK_INVALID_MODE')
  const jobs: { role: 'FRONT' | 'KITCHEN'; jobId: string }[] = []
  // Undefined preserves the original producer behavior for existing callers.
  // An explicit empty array is the durable business decision to suppress KITCHEN.
  const routedKitchenItems = mode === 'SHARED_PRINTER' ? (kitchenItems ?? snapshot.items) : null
  const kitchenJobSuppressed = mode === 'SHARED_PRINTER' && routedKitchenItems!.length === 0
  const roles = mode === 'FRONT_ONLY' || kitchenJobSuppressed
    ? ['FRONT'] as const
    : ['FRONT', 'KITCHEN'] as const
  for (const role of roles) {
    const key = createHash('sha256').update(`cashier-network-v2:${snapshot.orderNo}:${role}`).digest('hex')
    const roleSnapshot = role === 'KITCHEN'
      ? { ...snapshot, items: routedKitchenItems! }
      : snapshot
    const request = parseNetworkRequest({
      profile: NETWORK_PROFILE, requestId: `network:${key}`, mode, role, rendererVersion: 1, order: roleSnapshot,
    })
    const result = await enqueueRelayPrintJob(scope, request, readRelayTimingConfig(), new Date(), tx)
    if (role === 'FRONT' && mode === 'SHARED_PRINTER') {
      if (result.created) {
        if (kitchenJobSuppressed) {
          await tx.eshopTrayPrintJob.update({
            where: { id: result.job.id },
            data: { kitchenJobSuppressed: true },
          })
        }
      } else {
        const existing = await tx.eshopTrayPrintJob.findUniqueOrThrow({
          where: { id: result.job.id },
          select: { kitchenJobSuppressed: true },
        })
        if (existing.kitchenJobSuppressed !== kitchenJobSuppressed) {
          throw new Error('NETWORK_KITCHEN_ROUTING_CONFLICT')
        }
      }
    }
    jobs.push({ role, jobId: result.job.id })
  }
  return {
    profile: NETWORK_PROFILE,
    mode,
    state: 'QUEUED' as const,
    kitchenJobSuppressed,
    jobs,
  }
}

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
) {
  if (mode !== 'FRONT_ONLY' && mode !== 'SHARED_PRINTER') throw new Error('NETWORK_INVALID_MODE')
  const jobs: { role: 'FRONT' | 'KITCHEN'; jobId: string }[] = []
  const roles = mode === 'FRONT_ONLY' ? ['FRONT'] as const : ['FRONT', 'KITCHEN'] as const
  for (const role of roles) {
    const key = createHash('sha256').update(`cashier-network-v2:${snapshot.orderNo}:${role}`).digest('hex')
    const request = parseNetworkRequest({
      profile: NETWORK_PROFILE, requestId: `network:${key}`, mode, role, rendererVersion: 1, order: snapshot,
    })
    const result = await enqueueRelayPrintJob(scope, request, readRelayTimingConfig(), new Date(), tx)
    jobs.push({ role, jobId: result.job.id })
  }
  return { profile: NETWORK_PROFILE, mode, state: 'QUEUED' as const, jobs }
}

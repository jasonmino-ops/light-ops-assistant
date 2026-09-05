import type { NextRequest } from 'next/server'
import type { RequestContext } from '@/lib/context'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { relayError, relayJson } from './http'

type RelayConfigScope = Pick<RequestContext, 'tenantId' | 'storeId'>

export type RelayConfigRouteDependencies = {
  getRequestContext(req: NextRequest): Promise<RequestContext | null>
  isActiveStoreScope(scope: RelayConfigScope): Promise<boolean>
}

const productionDependencies: RelayConfigRouteDependencies = {
  getRequestContext: getContext,
  async isActiveStoreScope({ tenantId, storeId }) {
    const store = await prisma.store.findFirst({
      where: {
        id: storeId,
        tenantId,
        status: 'ACTIVE',
        tenant: { status: 'ACTIVE' },
      },
      select: { id: true },
    })
    return Boolean(store)
  },
}

/**
 * Desktop 0.4.7 compatibility gate for the Production Relay.
 *
 * `enabled` means only that the authenticated OWNER's current tenant/store is
 * eligible to submit relay jobs. It does not report Tray presence, queue
 * health, printer connectivity, or physical-print status.
 */
export async function handleRelayConfigRequest(
  req: NextRequest,
  dependencies: RelayConfigRouteDependencies = productionDependencies,
) {
  try {
    const context = await dependencies.getRequestContext(req)
    if (!context) return relayError('LOGIN_REQUIRED', 401)
    if (context.role !== 'OWNER') return relayError('OWNER_REQUIRED', 403)

    const enabled = await dependencies.isActiveStoreScope({
      tenantId: context.tenantId,
      storeId: context.storeId,
    })
    return relayJson({
      fieldOnly: true,
      productionContract: true,
      enabled,
    })
  } catch {
    console.error('[es-tray-relay] config gate unavailable')
    return relayError('ES_TRAY_02_SERVER_ERROR', 500)
  }
}

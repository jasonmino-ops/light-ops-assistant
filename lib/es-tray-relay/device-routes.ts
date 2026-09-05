import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { parsePrintRequest, type EshopTrayPrintRequest } from './contract'
import { readRelayTimingConfig, type RelayTimingConfig } from './config'
import {
  authenticateDeviceRelayPrincipal,
  type DeviceRelayAuthResult,
  type DeviceRelayContext,
} from './device-auth'
import { relayError, relayJson, withRelayApiError } from './http'
import { enqueueRelayPrintJob, type RelayStoreScope } from './service'

type DeviceRelayEnqueue = (
  scope: RelayStoreScope,
  request: EshopTrayPrintRequest,
  timing: RelayTimingConfig,
) => Promise<{
  created: boolean
  job: { id: string; schemaVersion: number } & Record<string, unknown>
}>

export type DeviceRelayRouteDependencies = {
  authenticate(req: NextRequest): Promise<DeviceRelayAuthResult>
  orderExists(scope: Pick<DeviceRelayContext, 'tenantId' | 'storeId'>, orderNo: string): Promise<boolean>
  enqueue: DeviceRelayEnqueue
}

const productionDependencies: DeviceRelayRouteDependencies = {
  authenticate: authenticateDeviceRelayPrincipal,
  async orderExists({ tenantId, storeId }, orderNo) {
    const [sale, customerOrder] = await Promise.all([
      prisma.saleRecord.findFirst({
        where: { tenantId, storeId, orderNo },
        select: { id: true },
      }),
      prisma.customerOrder.findFirst({
        where: { tenantId, storeId, orderNo },
        select: { id: true },
      }),
    ])
    return Boolean(sale || customerOrder)
  },
  enqueue: enqueueRelayPrintJob,
}

/**
 * Device-only Relay capability gate.
 *
 * `enabled` reports only that the delegated Browser POS session still maps to
 * an eligible ComputerBinding and active tenant/store. It does not report
 * Tray presence, queue health, printer connectivity, or physical output.
 */
export async function handleDeviceRelayConfigRequest(
  req: NextRequest,
  dependencies: Pick<DeviceRelayRouteDependencies, 'authenticate'> = productionDependencies,
) {
  return withRelayApiError(async () => {
    const auth = await dependencies.authenticate(req)
    if (!auth.ok) return relayError(auth.error, auth.status)

    return relayJson({
      fieldOnly: true,
      productionContract: true,
      enabled: auth.context.enabled,
    })
  })
}

/** Device-scoped enqueue; tenant, store, and binding are never client inputs. */
export async function handleDeviceRelayEnqueueRequest(
  req: NextRequest,
  dependencies: DeviceRelayRouteDependencies = productionDependencies,
) {
  return withRelayApiError(async () => {
    const auth = await dependencies.authenticate(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    if (!auth.context.enabled) {
      return relayError('DEVICE_RELAY_UNAVAILABLE', 403, {
        reason: auth.context.unavailableReason,
      })
    }

    const request = parsePrintRequest(await req.json())
    const scope = {
      tenantId: auth.context.tenantId,
      storeId: auth.context.storeId,
    }
    if (!await dependencies.orderExists(scope, request.orderNo)) {
      return relayError('ORDER_NOT_FOUND', 404)
    }

    const result = await dependencies.enqueue(scope, request, readRelayTimingConfig())

    return relayJson({
      fieldOnly: true,
      jobId: result.job.id,
      requestId: request.requestId,
      status: 'PENDING_RECEIVE',
      productionContract: true,
      schemaVersion: result.job.schemaVersion,
      created: result.created,
      job: result.job,
    }, { status: 202 })
  })
}

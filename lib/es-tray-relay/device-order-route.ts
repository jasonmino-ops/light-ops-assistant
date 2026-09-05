import type { NextRequest } from 'next/server'
import {
  authenticateDeviceRelayPrincipal,
  type DeviceRelayAuthResult,
  type DeviceRelayContext,
} from './device-auth'
import { readDeviceRelayOrderDetail } from './device-order-detail'
import { relayError, relayJson, withRelayApiError } from './http'

export type DeviceOrderRouteDependencies = {
  authenticate(req: NextRequest): Promise<DeviceRelayAuthResult>
  readOrder(
    scope: Pick<DeviceRelayContext, 'tenantId' | 'storeId'>,
    orderNo: string,
  ): Promise<unknown | null>
}

const productionDependencies: DeviceOrderRouteDependencies = {
  authenticate: authenticateDeviceRelayPrincipal,
  readOrder: readDeviceRelayOrderDetail,
}

export async function handleDeviceRelayOrderDetailRequest(
  req: NextRequest,
  orderNo: string,
  dependencies: DeviceOrderRouteDependencies = productionDependencies,
) {
  return withRelayApiError(async () => {
    const auth = await dependencies.authenticate(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    if (!auth.context.enabled) {
      return relayError('DEVICE_RELAY_UNAVAILABLE', 403, {
        reason: auth.context.unavailableReason,
      })
    }

    const normalizedOrderNo = orderNo.trim()
    if (!normalizedOrderNo) return relayError('ORDER_NOT_FOUND', 404)
    const detail = await dependencies.readOrder({
      tenantId: auth.context.tenantId,
      storeId: auth.context.storeId,
    }, normalizedOrderNo)
    if (!detail) return relayError('ORDER_NOT_FOUND', 404)
    return relayJson(detail)
  })
}

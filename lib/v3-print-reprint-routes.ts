import type { NextRequest } from 'next/server'
import { getContext, type RequestContext } from '@/lib/context'
import {
  authenticateDeviceRelayRecoveryPrincipal,
  type DeviceRelayAuthResult,
} from '@/lib/es-tray-relay/device-auth'
import { relayError, relayJson } from '@/lib/es-tray-relay/http'
import {
  enqueueV3ManualReprint,
  parseV3ReprintRequest,
  readV3ReprintAvailability,
  V3ReprintError,
  type V3ReprintActor,
  type V3ReprintRequest,
} from '@/lib/v3-print-reprint'

type Scope = { tenantId: string; storeId: string }
type ReprintResult = Awaited<ReturnType<typeof enqueueV3ManualReprint>>

export type V3ReprintRouteDependencies = {
  accountContext(req: NextRequest): Promise<RequestContext | null>
  deviceContext(req: NextRequest): Promise<DeviceRelayAuthResult>
  availability(scope: Scope): Promise<{ enabled: boolean; kitchenEnabled: boolean; legacyAllowed: boolean }>
  enqueue(scope: Scope, actor: V3ReprintActor, request: V3ReprintRequest): Promise<ReprintResult>
}

const productionDependencies: V3ReprintRouteDependencies = {
  accountContext: getContext,
  deviceContext: authenticateDeviceRelayRecoveryPrincipal,
  availability: readV3ReprintAvailability,
  enqueue: enqueueV3ManualReprint,
}

async function run(handler: () => Promise<Response>) {
  try {
    return await handler()
  } catch (error) {
    if (error instanceof V3ReprintError) return relayError(error.code, error.status)
    if (error instanceof SyntaxError) return relayError('V3_REPRINT_REQUEST_INVALID', 400)
    console.error('[v3-reprint] request failed')
    return relayError('V3_REPRINT_SERVER_ERROR', 500)
  }
}

function accepted(result: ReprintResult) {
  return relayJson({
    schemaVersion: 3,
    source: 'CLOUD_REMOTE_REPRINT',
    status: 'PENDING_RECEIVE',
    audited: true,
    ...result,
  }, { status: 202 })
}

export async function handleAccountV3ReprintRequest(
  req: NextRequest,
  dependencies: V3ReprintRouteDependencies = productionDependencies,
) {
  return run(async () => {
    const context = await dependencies.accountContext(req)
    if (!context) return relayError('LOGIN_REQUIRED', 401)
    const scope = { tenantId: context.tenantId, storeId: context.storeId }
    if (req.method === 'GET') return relayJson(await dependencies.availability(scope))
    if (req.method !== 'POST') return relayError('METHOD_NOT_ALLOWED', 405)
    const request = parseV3ReprintRequest(await req.json())
    const result = await dependencies.enqueue(scope, {
      kind: 'ACCOUNT', userId: context.userId, role: context.role,
    }, request)
    return accepted(result)
  })
}

export async function handleDeviceV3ReprintRequest(
  req: NextRequest,
  dependencies: V3ReprintRouteDependencies = productionDependencies,
) {
  return run(async () => {
    const auth = await dependencies.deviceContext(req)
    if (!auth.ok) return relayError(auth.error, auth.status)
    if (!auth.context.enabled) return relayError('DEVICE_RELAY_UNAVAILABLE', 403, {
      reason: auth.context.unavailableReason,
    })
    const scope = { tenantId: auth.context.tenantId, storeId: auth.context.storeId }
    if (req.method === 'GET') return relayJson(await dependencies.availability(scope))
    if (req.method !== 'POST') return relayError('METHOD_NOT_ALLOWED', 405)
    const request = parseV3ReprintRequest(await req.json())
    const actor = auth.context.principal === 'DESKTOP_POS_DEVICE'
      ? {
        kind: 'DESKTOP_DEVICE' as const,
        browserPosDeviceId: auth.context.browserPosDeviceId,
        desktopDeviceId: auth.context.desktopDeviceId,
      }
      : {
        kind: 'DESKTOP_DEVICE' as const,
        browserPosDeviceId: auth.context.browserPosDeviceId,
        computerBindingId: auth.context.computerBindingId,
      }
    const result = await dependencies.enqueue(scope, actor, request)
    return accepted(result)
  })
}

import type { NextRequest } from 'next/server'
import type { ComputerBinding } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateAgent } from '@/lib/computer-client/service'
import { ES_TRAY_CLIENT_VERSION, ES_TRAY_CLIENT_VERSION_HEADER } from './config'
import { NETWORK_PROFILE, NETWORK_CLIENT_VERSION } from '../../e-shop-tray/src/networkContract'

export type RelayAgentContext = {
  binding: ComputerBinding
  tenantId: string
  storeId: string
  storeCode: string
  schemaVersion: 1 | 2
}

export type RelayAgentAuthResult =
  | { ok: true; context: RelayAgentContext }
  | { ok: false; status: number; error: string }

export async function authenticateRelayAgent(req: NextRequest): Promise<RelayAgentAuthResult> {
  const auth = await authenticateAgent(req, 'device')
  if (!auth.ok) return auth

  // Tray 0.1.2 understands neither claim tokens nor terminal ACK. It must not
  // be allowed to consume a production job and exhaust safe claim attempts.
  const profile = req.headers.get('x-es-tray-profile')
  const schemaVersion = profile === NETWORK_PROFILE ? 2 : 1
  if ((profile !== null && profile !== NETWORK_PROFILE)
    || req.headers.get(ES_TRAY_CLIENT_VERSION_HEADER) !== (schemaVersion === 2 ? NETWORK_CLIENT_VERSION : ES_TRAY_CLIENT_VERSION)) {
    return { ok: false, status: 426, error: 'ES_TRAY_02_CLIENT_UPGRADE_REQUIRED' }
  }

  const binding = auth.binding
  if (binding.status !== 'APPROVED' || !binding.boundAt || binding.disabledAt) {
    return { ok: false, status: 403, error: 'COMPUTER_BINDING_NOT_ACTIVE' }
  }

  const store = await prisma.store.findFirst({
    where: {
      id: binding.storeId,
      tenantId: binding.tenantId,
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    },
    select: { id: true, tenantId: true, code: true },
  })
  if (!store) {
    return { ok: false, status: 403, error: 'COMPUTER_BINDING_STORE_UNAVAILABLE' }
  }

  return {
    ok: true,
    context: { binding, tenantId: store.tenantId, storeId: store.id, storeCode: store.code, schemaVersion },
  }
}

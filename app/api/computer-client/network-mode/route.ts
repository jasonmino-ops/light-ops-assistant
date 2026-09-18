import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authorizeDesktopPosRequest, unauthorizedPosResponse } from '@/lib/desktop-pos-auth'
import { noStoreJson } from '@/lib/desktop-activation/http'
import { isDesktopNetworkPrintEnabled, isDesktopPosRequest, resolveDesktopNetworkMode } from '@/lib/desktop-network-print'

export const runtime = 'nodejs'

/** Returns the RC10 observation for Desktop preflight; never configures RC10. */
export async function GET(req: NextRequest) {
  if (!isDesktopPosRequest(req)) return noStoreJson({ enabled: false, mode: null })

  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim() ?? ''
  if (!storeCode) return noStoreJson({ error: 'MISSING_STORE_CODE' }, { status: 400 })

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return noStoreJson({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const posAuth = await authorizeDesktopPosRequest(req, {
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
  }, { allowStoreCodeFallback: false })
  if (!posAuth) return unauthorizedPosResponse()

  const mode = await resolveDesktopNetworkMode({ tenantId: store.tenantId, storeId: store.id })
  return noStoreJson({
    enabled: isDesktopNetworkPrintEnabled() && mode !== null,
    mode,
  })
}

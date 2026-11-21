import { prisma } from '@/lib/prisma'
import { parseNetworkMode, type NetworkMode } from '@/e-shop-tray/src/networkContract'

/** RC10's 2s polling plus 30s startup recovery is the one freshness rule. */
export const DESKTOP_NETWORK_PRINT_STALE_AFTER_MS = 32_000

export function isDesktopNetworkPrintEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.DESKTOP_NETWORK_PRINT_ENABLED === '1'
}

export function isDesktopPosRequest(req: { headers: Headers }) {
  return req.headers.get('x-lightops-client') === 'desktop-pos'
}

export function isFreshDesktopNetworkMode(
  mode: unknown,
  observedAt: Date | null | undefined,
  now = new Date(),
): mode is NetworkMode {
  if (!observedAt) return false
  let parsedMode: NetworkMode
  try {
    parsedMode = parseNetworkMode(mode)
  } catch {
    return false
  }
  const age = now.getTime() - observedAt.getTime()
  return age >= 0 && age <= DESKTOP_NETWORK_PRINT_STALE_AFTER_MS && parsedMode === mode
}

type DesktopNetworkModeScope = { tenantId: string; storeId: string }

function eligibleBindingWhere(scope: DesktopNetworkModeScope, now: Date) {
  return {
    tenantId: scope.tenantId,
    storeId: scope.storeId,
    status: 'APPROVED' as const,
    boundAt: { not: null },
    disabledAt: null,
    credentialStatus: 'ACTIVE' as const,
    OR: [
      { credentialExpiresAt: null },
      { credentialExpiresAt: { gt: now } },
    ],
  }
}

/** RC10 remains authoritative; this only records an authenticated observation. */
export async function recordDesktopNetworkModeObservation(input: DesktopNetworkModeScope & {
  bindingId: string
  mode: NetworkMode
  observedAt?: Date
}) {
  const observedAt = input.observedAt ?? new Date()
  const result = await prisma.computerBinding.updateMany({
    where: { ...eligibleBindingWhere(input, observedAt), id: input.bindingId },
    data: { lastNetworkMode: input.mode, lastNetworkModeAt: observedAt },
  })
  return result.count === 1
}

/** Resolve one exact active binding and never guess a mode. */
export async function resolveDesktopNetworkMode(
  scope: DesktopNetworkModeScope,
  now = new Date(),
): Promise<NetworkMode | null> {
  if (!isDesktopNetworkPrintEnabled()) return null

  const bindings = await prisma.computerBinding.findMany({
    where: eligibleBindingWhere(scope, now),
    select: { lastNetworkMode: true, lastNetworkModeAt: true },
  })
  if (bindings.length !== 1) return null

  const binding = bindings[0]
  return isFreshDesktopNetworkMode(binding.lastNetworkMode, binding.lastNetworkModeAt, now)
    ? binding.lastNetworkMode
    : null
}

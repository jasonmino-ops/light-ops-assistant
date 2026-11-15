import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { LegacyInventoryProvider } from '@/app/components/MerchantInventoryEntry'
import { nativeInventoryAvailable } from '@/lib/native-inventory/rollout'
import { verifySession } from '@/lib/session'

export default async function ProductsLayout({ children }: { children: ReactNode }) {
  if (!nativeInventoryAvailable()) return <LegacyInventoryProvider enabled>{children}</LegacyInventoryProvider>

  const token = (await cookies()).get('auth-session')?.value
  const session = token ? verifySession(token) : null
  const pilotStoreId = process.env.INVENTORY_PROFIT_PILOT_STORE_ID?.trim()
  const legacyPilot = Boolean(pilotStoreId && session?.storeId === pilotStoreId)

  return <LegacyInventoryProvider enabled={legacyPilot}>{children}</LegacyInventoryProvider>
}

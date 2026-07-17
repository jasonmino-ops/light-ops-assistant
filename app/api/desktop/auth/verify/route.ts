import { NextRequest } from 'next/server'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { noStoreJson } from '@/lib/desktop-activation/http'

export async function POST(req: NextRequest) {
  const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
  if (!auth.ok) {
    return noStoreJson({
      ok: false,
      error: auth.error,
      ...(auth.device ? { device: auth.device } : {}),
      ...(auth.store ? { store: auth.store } : {}),
      ...(auth.subscription ? { subscription: auth.subscription } : {}),
    }, { status: auth.status })
  }

  return noStoreJson({
    ok: true,
    device: auth.device,
    store: auth.store,
    subscription: auth.context.subscription,
  })
}

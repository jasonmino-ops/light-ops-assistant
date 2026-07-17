import { NextRequest } from 'next/server'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { noStoreJson } from '@/lib/desktop-activation/http'

export async function GET(req: NextRequest) {
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
    device: auth.device,
    store: auth.store,
    subscription: auth.context.subscription,
  })
}

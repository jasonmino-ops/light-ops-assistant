import { NextRequest } from 'next/server'
import { getDesktopDeviceContext, serializePublicDesktopDeviceIdentity } from '@/lib/desktop-activation/auth'
import { minimalDesktopSubscription, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'

export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!auth.ok) {
      return noStoreJson({
        ok: false,
        error: auth.error,
        ...(auth.subscription ? { subscription: minimalDesktopSubscription(auth.subscription) } : {}),
      }, { status: auth.status })
    }

    return noStoreJson({
      device: serializePublicDesktopDeviceIdentity(auth.device, auth.store),
      subscription: minimalDesktopSubscription(auth.context.subscription),
    })
  })
}

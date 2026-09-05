import type { NextRequest } from 'next/server'
import { handleDeviceRelayConfigRequest } from '@/lib/es-tray-relay/device-routes'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return handleDeviceRelayConfigRequest(req)
}

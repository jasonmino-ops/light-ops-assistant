import type { NextRequest } from 'next/server'
import { handleDeviceRelayEnqueueRequest } from '@/lib/es-tray-relay/device-routes'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  return handleDeviceRelayEnqueueRequest(req)
}

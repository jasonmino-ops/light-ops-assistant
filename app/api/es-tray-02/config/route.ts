import { NextRequest } from 'next/server'
import { handleRelayConfigRequest } from '@/lib/es-tray-relay/config-route'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return handleRelayConfigRequest(req)
}

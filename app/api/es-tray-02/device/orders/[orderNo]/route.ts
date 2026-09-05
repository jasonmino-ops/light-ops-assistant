import type { NextRequest } from 'next/server'
import { handleDeviceRelayOrderDetailRequest } from '@/lib/es-tray-relay/device-order-route'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderNo: string }> },
) {
  const { orderNo } = await params
  return handleDeviceRelayOrderDetailRequest(req, orderNo)
}

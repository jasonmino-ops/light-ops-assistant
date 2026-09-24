import type { NextRequest } from 'next/server'
import { handleDeviceV3ReprintRequest } from '@/lib/v3-print-reprint-routes'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return handleDeviceV3ReprintRequest(req)
}

export async function POST(req: NextRequest) {
  return handleDeviceV3ReprintRequest(req)
}

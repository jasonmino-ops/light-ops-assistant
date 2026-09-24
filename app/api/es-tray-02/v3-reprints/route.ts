import type { NextRequest } from 'next/server'
import { handleAccountV3ReprintRequest } from '@/lib/v3-print-reprint-routes'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return handleAccountV3ReprintRequest(req)
}

export async function POST(req: NextRequest) {
  return handleAccountV3ReprintRequest(req)
}

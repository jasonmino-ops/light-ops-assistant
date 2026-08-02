import { type NextRequest } from 'next/server'
import { handleQzSignRequest } from '@/lib/qz-signing-route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return handleQzSignRequest(req)
}

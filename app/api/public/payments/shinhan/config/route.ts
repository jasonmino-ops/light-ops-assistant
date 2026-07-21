import { NextRequest, NextResponse } from 'next/server'
import { getShinhanPaymentAvailability } from '@/lib/payments/shinhan-config'

export function GET(_req: NextRequest) {
  const availability = getShinhanPaymentAvailability()

  return NextResponse.json({
    enabled: availability.enabled,
    frozen: availability.frozen,
  })
}

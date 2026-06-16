import { NextResponse } from 'next/server'
import { getShinhanPaymentConfig, isShinhanConfigured } from '@/lib/payments/shinhan-config'

export function GET() {
  const cfg = getShinhanPaymentConfig()

  return NextResponse.json({
    enabled: isShinhanConfigured(cfg),
    mockMode: cfg.mockMode,
  })
}

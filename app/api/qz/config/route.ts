import { NextResponse } from 'next/server'
import {
  QzSigningConfigError,
  readQzPublicSigningConfig,
} from '@/lib/qz-signing-config'

export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export async function GET() {
  try {
    const config = readQzPublicSigningConfig()
    return NextResponse.json({
      certificate: config.certificate,
      signatureAlgorithm: config.signatureAlgorithm,
      certificateVersion: config.certificateVersion,
      enabled: config.mode !== 'disabled',
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const code = error instanceof QzSigningConfigError
      ? error.code
      : 'QZ_SIGNING_CONFIG_INVALID'
    return NextResponse.json({ error: code }, {
      status: 503,
      headers: NO_STORE_HEADERS,
    })
  }
}

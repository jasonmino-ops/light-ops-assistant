import { NextRequest, NextResponse } from 'next/server'
import {
  QZ_CERTIFICATE_VERSION_HEADER,
  QzSigningConfigError,
  isQzSigningStoreAllowed,
  readQzActiveSigningConfig,
} from '@/lib/qz-signing-config'
import {
  QzSigningRequestError,
  assertQzCertificateVersion,
  assertQzDigestText,
  assertQzSignContentType,
  assertQzSignOrigin,
  finishQzSignAudit,
  reserveQzSignRateLimit,
  signQzDigestWithKms,
  verifyQzSigningSession,
} from '@/lib/qz-signing-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS })
}

function requestErrorStatus(code: QzSigningRequestError['code']): number {
  if (code === 'QZ_SIGN_ORIGIN_FORBIDDEN' || code === 'QZ_SIGN_STORE_FORBIDDEN') return 403
  if (code === 'QZ_SIGN_SESSION_UNAUTHORIZED') return 401
  if (code === 'QZ_SIGN_RATE_LIMITED') return 429
  if (
    code === 'QZ_SIGN_CONTENT_TYPE_INVALID' ||
    code === 'QZ_SIGN_INPUT_INVALID' ||
    code === 'QZ_SIGN_VERSION_MISMATCH'
  ) return 400
  return 503
}

export async function POST(req: NextRequest) {
  let config
  try {
    config = readQzActiveSigningConfig()
  } catch (error) {
    const code = error instanceof QzSigningConfigError
      ? error.code
      : 'QZ_SIGNING_CONFIG_INVALID'
    return errorResponse(code, code === 'QZ_SIGNING_DISABLED' ? 403 : 503)
  }

  try {
    assertQzSignOrigin(req, config)
    assertQzSignContentType(req)
    assertQzCertificateVersion(req, config)
    const digestText = assertQzDigestText(await req.text())
    const session = await verifyQzSigningSession(req)
    if (!session) throw new QzSigningRequestError('QZ_SIGN_SESSION_UNAUTHORIZED')
    if (!isQzSigningStoreAllowed(config, session.storeCode)) {
      throw new QzSigningRequestError('QZ_SIGN_STORE_FORBIDDEN')
    }

    const attemptId = await reserveQzSignRateLimit(session, config.certificateVersion)
    let signature: string
    try {
      signature = await signQzDigestWithKms(config, digestText)
    } catch {
      await finishQzSignAudit(attemptId, 'FAILED', 'QZ_SIGN_KMS_FAILED')
      throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED')
    }
    await finishQzSignAudit(attemptId, 'SUCCESS')

    return new NextResponse(signature, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'X-QZ-Certificate-Version': config.certificateVersion,
      },
    })
  } catch (error) {
    if (error instanceof QzSigningRequestError) {
      return errorResponse(error.code, requestErrorStatus(error.code))
    }
    return errorResponse('QZ_SIGNING_UNAVAILABLE', 503)
  }
}

import { NextRequest, NextResponse } from 'next/server'
import {
  QzSigningConfigError,
  isQzSigningStoreAllowed,
  readQzActiveSigningConfig,
  type QzActiveSigningConfig,
  type QzCertificateKeyPair,
} from '@/lib/qz-signing-config'
import {
  QzSigningRequestError,
  assertQzCertificateVersion,
  assertQzDigestText,
  assertQzSignContentType,
  assertQzSignOrigin,
  finishQzSignAudit,
  qzRequestIpHash,
  reserveQzSignRateLimit,
  signQzDigestWithKms,
  verifyQzSigningSession,
  type QzSigningSession,
} from '@/lib/qz-signing-server'

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

function errorResponse(error: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ error }, { status, headers: { ...NO_STORE_HEADERS, ...headers } })
}

function requestErrorStatus(code: QzSigningRequestError['code']): number {
  if (code === 'QZ_SIGN_ORIGIN_FORBIDDEN' || code === 'QZ_SIGN_STORE_FORBIDDEN') return 403
  if (code === 'QZ_SIGN_SESSION_UNAUTHORIZED') return 401
  if (code === 'QZ_SIGN_RATE_LIMITED') return 429
  if (code === 'QZ_SIGN_VERSION_MISMATCH') return 409
  if (
    code === 'QZ_SIGN_CONTENT_TYPE_INVALID' ||
    code === 'QZ_SIGN_INPUT_INVALID' ||
    code === 'QZ_SIGN_REQUEST_METADATA_INVALID'
  ) return 400
  return 503
}

export type QzSignRouteDependencies = {
  readConfig: () => QzActiveSigningConfig
  verifySession: (req: NextRequest) => Promise<QzSigningSession | null>
  reserveAttempt: (
    session: QzSigningSession,
    certificateVersion: string,
    ipHash: string,
  ) => Promise<string>
  sign: (
    config: QzActiveSigningConfig,
    pair: QzCertificateKeyPair,
    digestText: string,
  ) => Promise<string>
  finishAudit: (
    attemptId: string,
    result: 'SUCCESS' | 'FAILED',
    errorCode?: 'QZ_SIGN_KMS_FAILED' | 'QZ_SIGN_STORE_FORBIDDEN',
  ) => Promise<void>
}

const DEFAULT_DEPENDENCIES: QzSignRouteDependencies = {
  readConfig: readQzActiveSigningConfig,
  verifySession: verifyQzSigningSession,
  reserveAttempt: reserveQzSignRateLimit,
  sign: signQzDigestWithKms,
  finishAudit: finishQzSignAudit,
}

export async function handleQzSignRequest(
  req: NextRequest,
  dependencies: QzSignRouteDependencies = DEFAULT_DEPENDENCIES,
) {
  let config: QzActiveSigningConfig
  try {
    config = dependencies.readConfig()
  } catch (error) {
    const code = error instanceof QzSigningConfigError
      ? error.code
      : 'QZ_SIGNING_CONFIG_INVALID'
    return errorResponse(code, code === 'QZ_SIGNING_DISABLED' ? 403 : 503)
  }

  try {
    assertQzSignOrigin(req, config)
    assertQzSignContentType(req)
    const pair = assertQzCertificateVersion(req, config)
    const digestText = assertQzDigestText(await req.text())
    const session = await dependencies.verifySession(req)
    if (!session) throw new QzSigningRequestError('QZ_SIGN_SESSION_UNAUTHORIZED')
    const ipHash = qzRequestIpHash(req)
    const attemptId = await dependencies.reserveAttempt(session, pair.certificateVersion, ipHash)
    if (!isQzSigningStoreAllowed(config, session.storeCode)) {
      await dependencies.finishAudit(attemptId, 'FAILED', 'QZ_SIGN_STORE_FORBIDDEN')
      throw new QzSigningRequestError('QZ_SIGN_STORE_FORBIDDEN')
    }

    let signature: string
    try {
      signature = await dependencies.sign(config, pair, digestText)
    } catch {
      await dependencies.finishAudit(attemptId, 'FAILED', 'QZ_SIGN_KMS_FAILED')
      throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED')
    }
    await dependencies.finishAudit(attemptId, 'SUCCESS')

    return new NextResponse(signature, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'X-QZ-Certificate-Version': pair.certificateVersion,
      },
    })
  } catch (error) {
    if (error instanceof QzSigningRequestError) {
      const versionHeaders = error.code === 'QZ_SIGN_VERSION_MISMATCH'
        ? { 'X-QZ-Current-Certificate-Version': config.certificateVersion }
        : undefined
      return errorResponse(error.code, requestErrorStatus(error.code), versionHeaders)
    }
    return errorResponse('QZ_SIGNING_UNAVAILABLE', 503)
  }
}

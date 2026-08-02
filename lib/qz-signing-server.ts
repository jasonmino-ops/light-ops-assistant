import { KMSClient, SignCommand, type SignCommandOutput } from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { Prisma } from '@prisma/client'
import type { NextRequest } from 'next/server'
import {
  getPosAuthHeaders,
  verifyPosDeviceRequest,
  verifyPosDeviceToken,
} from '@/lib/desktop-pos-auth'
import { prisma } from '@/lib/prisma'
import {
  QZ_CERTIFICATE_VERSION_HEADER,
  QZ_KMS_MESSAGE_TYPE,
  QZ_KMS_SIGNING_ALGORITHM,
  QZ_SIGN_RATE_LIMIT_MAX,
  QZ_SIGN_RATE_LIMIT_WINDOW_MS,
  type QzActiveSigningConfig,
} from '@/lib/qz-signing-config'

export type QzSigningSession = {
  tenantId: string
  storeId: string
  storeCode: string
  browserPosSessionId: string
}

export class QzSigningRequestError extends Error {
  constructor(public readonly code:
    | 'QZ_SIGN_ORIGIN_FORBIDDEN'
    | 'QZ_SIGN_CONTENT_TYPE_INVALID'
    | 'QZ_SIGN_INPUT_INVALID'
    | 'QZ_SIGN_VERSION_MISMATCH'
    | 'QZ_SIGN_SESSION_UNAUTHORIZED'
    | 'QZ_SIGN_STORE_FORBIDDEN'
    | 'QZ_SIGN_RATE_LIMITED'
    | 'QZ_SIGN_AUDIT_FAILED'
    | 'QZ_SIGN_KMS_FAILED') {
    super(code)
    this.name = 'QzSigningRequestError'
  }
}

export function assertQzSignOrigin(req: NextRequest, config: QzActiveSigningConfig): void {
  const origin = req.headers.get('origin')?.trim() ?? ''
  const fetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase() ?? ''
  if (origin !== config.allowedOrigin || fetchSite !== 'same-origin') {
    throw new QzSigningRequestError('QZ_SIGN_ORIGIN_FORBIDDEN')
  }
}

export function assertQzSignContentType(req: NextRequest): void {
  const contentType = req.headers.get('content-type')?.trim().toLowerCase() ?? ''
  if (!/^text\/plain(?:\s*;\s*charset=utf-8)?$/.test(contentType)) {
    throw new QzSigningRequestError('QZ_SIGN_CONTENT_TYPE_INVALID')
  }
}

export function assertQzCertificateVersion(req: NextRequest, config: QzActiveSigningConfig): void {
  const version = req.headers.get(QZ_CERTIFICATE_VERSION_HEADER)?.trim() ?? ''
  if (version !== config.certificateVersion) {
    throw new QzSigningRequestError('QZ_SIGN_VERSION_MISMATCH')
  }
}

export function assertQzDigestText(value: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new QzSigningRequestError('QZ_SIGN_INPUT_INVALID')
  }
  return value
}

export async function verifyQzSigningSession(req: NextRequest): Promise<QzSigningSession | null> {
  const { token, deviceId } = getPosAuthHeaders(req)
  if (!token || !deviceId) return null
  const payload = verifyPosDeviceToken(token)
  if (!payload?.browserPosSessionId || payload.deviceId !== deviceId) return null
  const verified = await verifyPosDeviceRequest(req, {
    tenantId: payload.tenantId,
    storeId: payload.storeId,
    storeCode: payload.storeCode,
  })
  if (!verified?.browserPosSessionId) return null
  return {
    tenantId: verified.tenantId,
    storeId: verified.storeId,
    storeCode: verified.storeCode,
    browserPosSessionId: verified.browserPosSessionId,
  }
}

export async function reserveQzSignRateLimit(
  session: QzSigningSession,
  certificateVersion: string,
  now = new Date(),
): Promise<string> {
  try {
    return await prisma.$transaction(async (tx) => {
      const recentAttempts = await tx.operationLog.count({
        where: {
          tenantId: session.tenantId,
          storeId: session.storeId,
          actionType: 'QZ_SIGN',
          targetType: 'BrowserPosDevice',
          targetId: session.browserPosSessionId,
          createdAt: { gte: new Date(now.getTime() - QZ_SIGN_RATE_LIMIT_WINDOW_MS) },
        },
      })
      if (recentAttempts >= QZ_SIGN_RATE_LIMIT_MAX) {
        throw new QzSigningRequestError('QZ_SIGN_RATE_LIMITED')
      }
      const attempt = await tx.operationLog.create({
        data: {
          tenantId: session.tenantId,
          storeId: session.storeId,
          userId: null,
          actionType: 'QZ_SIGN',
          targetType: 'BrowserPosDevice',
          targetId: session.browserPosSessionId,
          status: 'FAILED',
          message: 'QZ_SIGN_STARTED',
          payloadSnapshot: { certificateVersion },
        },
        select: { id: true },
      })
      return attempt.id
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
  } catch (error) {
    if (error instanceof QzSigningRequestError) throw error
    throw new QzSigningRequestError('QZ_SIGN_AUDIT_FAILED')
  }
}

export async function finishQzSignAudit(
  attemptId: string,
  result: 'SUCCESS' | 'FAILED',
  errorCode?: 'QZ_SIGN_KMS_FAILED',
): Promise<void> {
  try {
    await prisma.operationLog.update({
      where: { id: attemptId },
      data: {
        status: result,
        message: result === 'SUCCESS' ? null : (errorCode ?? 'QZ_SIGN_KMS_FAILED'),
      },
    })
  } catch {
    throw new QzSigningRequestError('QZ_SIGN_AUDIT_FAILED')
  }
}

export type QzKmsClient = {
  send(command: SignCommand): Promise<SignCommandOutput>
}

let cachedKmsClient: { cacheKey: string; client: KMSClient } | null = null

function getKmsClient(config: QzActiveSigningConfig): KMSClient {
  const cacheKey = `${config.awsRegion}|${config.awsRoleArn}`
  if (cachedKmsClient?.cacheKey === cacheKey) return cachedKmsClient.client
  const client = new KMSClient({
    region: config.awsRegion,
    credentials: awsCredentialsProvider({
      roleArn: config.awsRoleArn,
      roleSessionName: 'eshop-qz-sign',
      clientConfig: { region: config.awsRegion },
    }),
  })
  cachedKmsClient = { cacheKey, client }
  return client
}

export function qzKmsSignCommand(config: QzActiveSigningConfig, digestText: string): SignCommand {
  return new SignCommand({
    KeyId: config.kmsKeyArn,
    Message: Buffer.from(assertQzDigestText(digestText), 'utf8'),
    MessageType: QZ_KMS_MESSAGE_TYPE,
    SigningAlgorithm: QZ_KMS_SIGNING_ALGORITHM,
  })
}

export async function signQzDigestWithKms(
  config: QzActiveSigningConfig,
  digestText: string,
  client: QzKmsClient = getKmsClient(config),
): Promise<string> {
  let output: SignCommandOutput
  try {
    output = await client.send(qzKmsSignCommand(config, digestText))
  } catch {
    throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED')
  }
  if (
    output.KeyId !== config.kmsKeyArn ||
    output.SigningAlgorithm !== QZ_KMS_SIGNING_ALGORITHM ||
    !output.Signature ||
    output.Signature.byteLength === 0
  ) {
    throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED')
  }
  return Buffer.from(output.Signature).toString('base64')
}

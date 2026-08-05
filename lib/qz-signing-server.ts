import { createHash, verify as verifySignature } from 'node:crypto'
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
  QZ_SIGN_DEVICE_RATE_LIMIT_MAX,
  QZ_KMS_MESSAGE_TYPE,
  QZ_KMS_SIGNING_ALGORITHM,
  QZ_SIGN_IP_RATE_LIMIT_MAX,
  QZ_SIGN_RATE_LIMIT_MAX,
  QZ_SIGN_RATE_LIMIT_WINDOW_MS,
  QZ_SIGN_STORE_RATE_LIMIT_MAX,
  QZ_CERTIFICATE_VERSION_HEADER,
  getQzSigningPair,
  type QzActiveSigningConfig,
  type QzCertificateKeyPair,
} from '@/lib/qz-signing-config'

export type QzSigningSession = {
  tenantId: string
  storeId: string
  storeCode: string
  sessionFingerprint: string
  deviceId: string
}

export class QzSigningRequestError extends Error {
  constructor(public readonly code:
    | 'QZ_SIGN_ORIGIN_FORBIDDEN'
    | 'QZ_SIGN_CONTENT_TYPE_INVALID'
    | 'QZ_SIGN_INPUT_INVALID'
    | 'QZ_SIGN_VERSION_MISMATCH'
    | 'QZ_SIGN_SESSION_UNAUTHORIZED'
    | 'QZ_SIGN_STORE_FORBIDDEN'
    | 'QZ_SIGN_REQUEST_METADATA_INVALID'
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

export function assertQzCertificateVersion(
  req: NextRequest,
  config: QzActiveSigningConfig,
): QzCertificateKeyPair {
  const version = req.headers.get(QZ_CERTIFICATE_VERSION_HEADER)?.trim() ?? ''
  const pair = getQzSigningPair(config, version)
  if (!pair) throw new QzSigningRequestError('QZ_SIGN_VERSION_MISMATCH')
  return pair
}

export function assertQzDigestText(value: string): string {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new QzSigningRequestError('QZ_SIGN_INPUT_INVALID')
  }
  return value
}

export function qzRequestIpHash(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? ''
  if (!forwarded || forwarded.length > 64 || !/^[0-9a-fA-F:.]+$/.test(forwarded)) {
    throw new QzSigningRequestError('QZ_SIGN_REQUEST_METADATA_INVALID')
  }
  return hashAuditValue(`ip:${forwarded}`)
}

export async function verifyQzSigningSession(req: NextRequest): Promise<QzSigningSession | null> {
  const { token, deviceId } = getPosAuthHeaders(req)
  if (!token || !deviceId) return null
  const payload = verifyPosDeviceToken(token)
  if (!payload || payload.deviceId !== deviceId) return null
  const verified = await verifyPosDeviceRequest(req, {
    tenantId: payload.tenantId,
    storeId: payload.storeId,
    storeCode: payload.storeCode,
  })
  if (!verified) return null
  return {
    tenantId: verified.tenantId,
    storeId: verified.storeId,
    storeCode: verified.storeCode,
    sessionFingerprint: hashAuditValue(`session-token:${token}`),
    deviceId,
  }
}

function hashAuditValue(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function auditDimensions(session: QzSigningSession, ipHash: string) {
  return {
    storeHash: hashAuditValue(`store:${session.tenantId}:${session.storeId}`),
    sessionHash: hashAuditValue(`session:${session.tenantId}:${session.storeId}:${session.sessionFingerprint}`),
    deviceHash: hashAuditValue(`device:${session.tenantId}:${session.storeId}:${session.deviceId}`),
    ipHash,
  }
}

function auditEnvironment(): 'production' | 'preview' | 'development' | 'unknown' {
  const value = process.env.VERCEL_ENV ?? process.env.NODE_ENV
  if (value === 'production' || value === 'preview' || value === 'development') return value
  return 'unknown'
}

export async function reserveQzSignRateLimit(
  session: QzSigningSession,
  certificateVersion: string,
  ipHash: string,
  now = new Date(),
): Promise<string> {
  const dimensions = auditDimensions(session, ipHash)
  const targetId = `qz-session:${dimensions.sessionHash.slice(0, 32)}`
  const since = new Date(now.getTime() - QZ_SIGN_RATE_LIMIT_WINDOW_MS)
  try {
    return await prisma.$transaction(async (tx) => {
      const common = { actionType: 'QZ_SIGN', createdAt: { gte: since } }
      const [sessionAttempts, deviceAttempts, ipAttempts, storeAttempts] = await Promise.all([
        tx.operationLog.count({ where: { ...common, tenantId: session.tenantId, targetId } }),
        tx.operationLog.count({ where: {
          ...common,
          tenantId: session.tenantId,
          payloadSnapshot: { path: ['deviceHash'], equals: dimensions.deviceHash },
        } }),
        tx.operationLog.count({ where: {
          ...common,
          payloadSnapshot: { path: ['ipHash'], equals: dimensions.ipHash },
        } }),
        tx.operationLog.count({ where: {
          ...common,
          tenantId: session.tenantId,
          payloadSnapshot: { path: ['storeHash'], equals: dimensions.storeHash },
        } }),
      ])
      if (
        sessionAttempts >= QZ_SIGN_RATE_LIMIT_MAX ||
        deviceAttempts >= QZ_SIGN_DEVICE_RATE_LIMIT_MAX ||
        ipAttempts >= QZ_SIGN_IP_RATE_LIMIT_MAX ||
        storeAttempts >= QZ_SIGN_STORE_RATE_LIMIT_MAX
      ) {
        throw new QzSigningRequestError('QZ_SIGN_RATE_LIMITED')
      }
      const attempt = await tx.operationLog.create({
        data: {
          tenantId: session.tenantId,
          storeId: null,
          userId: null,
          actionType: 'QZ_SIGN',
          targetType: 'PosDeviceSession',
          targetId,
          status: 'FAILED',
          message: 'QZ_SIGN_STARTED',
          payloadSnapshot: {
            certificateVersion,
            environment: auditEnvironment(),
            storeHash: dimensions.storeHash,
            deviceHash: dimensions.deviceHash,
            ipHash: dimensions.ipHash,
          },
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
  errorCode?: 'QZ_SIGN_KMS_FAILED' | 'QZ_SIGN_STORE_FORBIDDEN',
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

export function qzKmsSignCommand(pair: QzCertificateKeyPair, digestText: string): SignCommand {
  return new SignCommand({
    KeyId: pair.kmsKeyArn,
    Message: Buffer.from(assertQzDigestText(digestText), 'utf8'),
    MessageType: QZ_KMS_MESSAGE_TYPE,
    SigningAlgorithm: QZ_KMS_SIGNING_ALGORITHM,
  })
}

export async function signQzDigestWithKms(
  config: QzActiveSigningConfig,
  pair: QzCertificateKeyPair,
  digestText: string,
  client: QzKmsClient = getKmsClient(config),
): Promise<string> {
  let output: SignCommandOutput
  try {
    output = await client.send(qzKmsSignCommand(pair, digestText))
  } catch {
    throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED')
  }
  const signature = output.Signature ? Buffer.from(output.Signature) : null
  if (
    output.KeyId !== pair.kmsKeyArn ||
    output.SigningAlgorithm !== QZ_KMS_SIGNING_ALGORITHM ||
    !signature ||
    signature.byteLength === 0 ||
    !verifySignature('RSA-SHA512', Buffer.from(digestText, 'utf8'), pair.certificatePublicKey, signature)
  ) {
    throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED')
  }
  return signature.toString('base64')
}

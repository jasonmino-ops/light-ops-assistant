import { X509Certificate, type KeyObject } from 'node:crypto'

export const QZ_SIGNATURE_ALGORITHM = 'SHA512' as const
export const QZ_KMS_SIGNING_ALGORITHM = 'RSASSA_PKCS1_V1_5_SHA_512' as const
export const QZ_KMS_MESSAGE_TYPE = 'RAW' as const
export const QZ_CERTIFICATE_VERSION_HEADER = 'x-qz-certificate-version'
export const QZ_SIGN_RATE_LIMIT_MAX = 120
export const QZ_SIGN_DEVICE_RATE_LIMIT_MAX = 180
export const QZ_SIGN_IP_RATE_LIMIT_MAX = 240
export const QZ_SIGN_STORE_RATE_LIMIT_MAX = 600
export const QZ_SIGN_RATE_LIMIT_WINDOW_MS = 60_000

export type QzSigningMode = 'disabled' | 'canary' | 'general'
export type QzSigningEnv = Readonly<Record<string, string | undefined>>

export type QzCertificateKeyPair = {
  certificateVersion: string
  certificate: string
  certificateSha256: string
  kmsKeyArn: string
  signingEnabled: boolean
  certificatePublicKey: KeyObject
}

export type QzPublicSigningConfig = {
  mode: QzSigningMode
  certificate: string
  certificateVersion: string
  signatureAlgorithm: typeof QZ_SIGNATURE_ALGORITHM
  canaryStoreCodes: ReadonlySet<string>
  activePair: QzCertificateKeyPair
  versionPairs: ReadonlyMap<string, QzCertificateKeyPair>
}

export type QzActiveSigningConfig = QzPublicSigningConfig & {
  mode: 'canary' | 'general'
  allowedOrigin: string
  awsRegion: string
  awsRoleArn: string
}

export class QzSigningConfigError extends Error {
  constructor(public readonly code: 'QZ_SIGNING_DISABLED' | 'QZ_SIGNING_CONFIG_INVALID') {
    super(code)
    this.name = 'QzSigningConfigError'
  }
}

function invalidConfig(): never {
  throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
}

function required(env: QzSigningEnv, key: string): string {
  const value = env[key]?.trim() ?? ''
  if (!value) invalidConfig()
  return value
}

function parseMode(value: string | undefined): QzSigningMode {
  if (value === 'disabled' || value === 'canary' || value === 'general') return value
  return invalidConfig()
}

function parseCertificateVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(value)) invalidConfig()
  return value
}

function parseCertificateSha256(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{64}$/.test(value)) invalidConfig()
  return value.toLowerCase()
}

function parseKmsKeyArn(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^arn:(?:aws|aws-us-gov|aws-cn):kms:[a-z0-9-]+:\d{12}:key\/[A-Za-z0-9-]{1,128}$/.test(value)
  ) {
    invalidConfig()
  }
  return value
}

function parseCertificate(value: unknown, expectedSha256: string, now: Date): {
  certificate: string
  certificatePublicKey: KeyObject
} {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32_768) invalidConfig()
  const certificate = value.trim()
  const blocks = certificate.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  if (!blocks || blocks.length === 0 || blocks.length > 4) invalidConfig()
  if (certificate.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim()) {
    invalidConfig()
  }

  let chain: X509Certificate[]
  try {
    chain = blocks.map((block) => new X509Certificate(block))
  } catch {
    return invalidConfig()
  }
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) invalidConfig()
  for (const parsed of chain) {
    const notBefore = Date.parse(parsed.validFrom)
    const notAfter = Date.parse(parsed.validTo)
    if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter) || nowMs < notBefore || nowMs >= notAfter) {
      invalidConfig()
    }
  }

  const leaf = chain[0]
  const fingerprint = leaf.fingerprint256.replaceAll(':', '').toLowerCase()
  const keyDetails = leaf.publicKey.asymmetricKeyDetails
  if (
    fingerprint !== expectedSha256 ||
    leaf.ca ||
    leaf.subject === leaf.issuer ||
    leaf.publicKey.asymmetricKeyType !== 'rsa' ||
    keyDetails?.modulusLength !== 2048
  ) {
    invalidConfig()
  }

  for (let index = 0; index < chain.length - 1; index += 1) {
    const child = chain[index]
    const issuer = chain[index + 1]
    if (!child.checkIssued(issuer) || !child.verify(issuer.publicKey)) invalidConfig()
  }
  return { certificate, certificatePublicKey: leaf.publicKey }
}

type RawVersionPair = {
  certificateVersion?: unknown
  certificate?: unknown
  certificateSha256?: unknown
  kmsKeyArn?: unknown
  signingEnabled?: unknown
}

function parseVersionPairs(raw: string, activeVersion: string, now: Date): {
  activePair: QzCertificateKeyPair
  versionPairs: ReadonlyMap<string, QzCertificateKeyPair>
} {
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    return invalidConfig()
  }
  if (!Array.isArray(values) || values.length === 0 || values.length > 3) invalidConfig()

  const pairs = new Map<string, QzCertificateKeyPair>()
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidConfig()
    const rawPair = value as RawVersionPair
    const allowedKeys = new Set([
      'certificateVersion',
      'certificate',
      'certificateSha256',
      'kmsKeyArn',
      'signingEnabled',
    ])
    if (Object.keys(rawPair).some((key) => !allowedKeys.has(key))) invalidConfig()
    const certificateVersion = parseCertificateVersion(rawPair.certificateVersion)
    if (pairs.has(certificateVersion) || typeof rawPair.signingEnabled !== 'boolean') invalidConfig()
    const certificateSha256 = parseCertificateSha256(rawPair.certificateSha256)
    const parsedCertificate = parseCertificate(rawPair.certificate, certificateSha256, now)
    pairs.set(certificateVersion, {
      certificateVersion,
      ...parsedCertificate,
      certificateSha256,
      kmsKeyArn: parseKmsKeyArn(rawPair.kmsKeyArn),
      signingEnabled: rawPair.signingEnabled,
    })
  }

  const activePair = pairs.get(activeVersion)
  if (!activePair || !activePair.signingEnabled) invalidConfig()
  return { activePair, versionPairs: pairs }
}

function parseCanaryStoreCodes(env: QzSigningEnv, mode: QzSigningMode): ReadonlySet<string> {
  const raw = env.QZ_SIGNING_CANARY_STORE_CODES?.trim() ?? ''
  const values = raw ? raw.split(',').map((value) => value.trim()).filter(Boolean) : []
  if (values.some((value) => !/^[A-Za-z0-9_-]{1,64}$/.test(value))) invalidConfig()
  if (mode === 'canary' && values.length === 0) invalidConfig()
  if (mode === 'general' && values.length > 0) invalidConfig()
  return new Set(values)
}

function parseExactOrigin(value: string): string {
  try {
    const parsed = new URL(value)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      parsed.origin !== value
    ) {
      throw new Error('invalid origin')
    }
    return parsed.origin
  } catch {
    return invalidConfig()
  }
}

function parseAwsRegion(value: string): string {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value)) invalidConfig()
  return value
}

function parseAwsRoleArn(value: string): string {
  if (!/^arn:(?:aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/.test(value)) {
    invalidConfig()
  }
  return value
}

function assertKmsRegions(pairs: ReadonlyMap<string, QzCertificateKeyPair>, region: string): void {
  for (const pair of pairs.values()) {
    const arnRegion = pair.kmsKeyArn.split(':')[3]
    if (arnRegion !== region) invalidConfig()
  }
}

export function readQzPublicSigningConfig(
  env: QzSigningEnv = process.env,
  now = new Date(),
): QzPublicSigningConfig {
  const mode = parseMode(env.QZ_SIGNING_MODE)
  const activeVersion = parseCertificateVersion(required(env, 'QZ_SIGNING_ACTIVE_VERSION'))
  const { activePair, versionPairs } = parseVersionPairs(
    required(env, 'QZ_SIGNING_VERSION_PAIRS_JSON'),
    activeVersion,
    now,
  )
  return {
    mode,
    certificate: activePair.certificate,
    certificateVersion: activePair.certificateVersion,
    signatureAlgorithm: QZ_SIGNATURE_ALGORITHM,
    canaryStoreCodes: parseCanaryStoreCodes(env, mode),
    activePair,
    versionPairs,
  }
}

export function readQzActiveSigningConfig(
  env: QzSigningEnv = process.env,
  now = new Date(),
): QzActiveSigningConfig {
  const publicConfig = readQzPublicSigningConfig(env, now)
  if (publicConfig.mode === 'disabled') {
    throw new QzSigningConfigError('QZ_SIGNING_DISABLED')
  }
  const awsRegion = parseAwsRegion(required(env, 'QZ_SIGNING_AWS_REGION'))
  assertKmsRegions(publicConfig.versionPairs, awsRegion)
  return {
    ...publicConfig,
    mode: publicConfig.mode,
    allowedOrigin: parseExactOrigin(required(env, 'QZ_SIGNING_ORIGIN')),
    awsRegion,
    awsRoleArn: parseAwsRoleArn(required(env, 'QZ_SIGNING_AWS_ROLE_ARN')),
  }
}

export function getQzSigningPair(
  config: QzActiveSigningConfig,
  certificateVersion: string,
): QzCertificateKeyPair | null {
  const pair = config.versionPairs.get(certificateVersion)
  return pair?.signingEnabled ? pair : null
}

export function isQzSigningStoreAllowed(config: QzActiveSigningConfig, storeCode: string): boolean {
  if (config.mode === 'general') return true
  return config.canaryStoreCodes.has(storeCode)
}

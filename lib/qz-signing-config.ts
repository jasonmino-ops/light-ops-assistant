export const QZ_SIGNATURE_ALGORITHM = 'SHA512' as const
export const QZ_KMS_SIGNING_ALGORITHM = 'RSASSA_PKCS1_V1_5_SHA_512' as const
export const QZ_KMS_MESSAGE_TYPE = 'RAW' as const
export const QZ_CERTIFICATE_VERSION_HEADER = 'x-qz-certificate-version'
export const QZ_SIGN_RATE_LIMIT_MAX = 120
export const QZ_SIGN_RATE_LIMIT_WINDOW_MS = 60_000

export type QzSigningMode = 'disabled' | 'canary' | 'general'
export type QzSigningEnv = Readonly<Record<string, string | undefined>>

export type QzPublicSigningConfig = {
  mode: QzSigningMode
  certificate: string
  certificateVersion: string
  signatureAlgorithm: typeof QZ_SIGNATURE_ALGORITHM
  canaryStoreCodes: ReadonlySet<string>
}

export type QzActiveSigningConfig = QzPublicSigningConfig & {
  mode: 'canary' | 'general'
  allowedOrigin: string
  awsRegion: string
  awsRoleArn: string
  kmsKeyArn: string
}

export class QzSigningConfigError extends Error {
  constructor(public readonly code: 'QZ_SIGNING_DISABLED' | 'QZ_SIGNING_CONFIG_INVALID') {
    super(code)
    this.name = 'QzSigningConfigError'
  }
}

function required(env: QzSigningEnv, key: string): string {
  const value = env[key]?.trim() ?? ''
  if (!value) throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  return value
}

function parseMode(value: string | undefined): QzSigningMode {
  if (value === 'disabled' || value === 'canary' || value === 'general') return value
  throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
}

function parseCertificate(value: string): string {
  if (
    value.length > 32_768 ||
    !value.includes('-----BEGIN CERTIFICATE-----') ||
    !value.includes('-----END CERTIFICATE-----')
  ) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  return value
}

function parseCertificateVersion(value: string): string {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(value)) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  return value
}

function parseCanaryStoreCodes(env: QzSigningEnv, mode: QzSigningMode): ReadonlySet<string> {
  const raw = env.QZ_SIGNING_CANARY_STORE_CODES?.trim() ?? ''
  const values = raw
    ? raw.split(',').map((value) => value.trim()).filter(Boolean)
    : []
  if (values.some((value) => !/^[A-Za-z0-9_-]{1,64}$/.test(value))) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  if (mode === 'canary' && values.length === 0) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  if (mode === 'general' && values.length > 0) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
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
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
}

function parseAwsRegion(value: string): string {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(value)) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  return value
}

function parseAwsRoleArn(value: string): string {
  if (!/^arn:(?:aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[A-Za-z0-9+=,.@_\/-]{1,512}$/.test(value)) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  return value
}

function parseKmsKeyArn(value: string, region: string): string {
  const match = value.match(/^arn:(?:aws|aws-us-gov|aws-cn):kms:([a-z0-9-]+):\d{12}:key\/[A-Za-z0-9-]{1,128}$/)
  if (!match || match[1] !== region) {
    throw new QzSigningConfigError('QZ_SIGNING_CONFIG_INVALID')
  }
  return value
}

export function readQzPublicSigningConfig(
  env: QzSigningEnv = process.env,
): QzPublicSigningConfig {
  const mode = parseMode(env.QZ_SIGNING_MODE)
  return {
    mode,
    certificate: parseCertificate(required(env, 'QZ_SIGNING_PUBLIC_CERTIFICATE')),
    certificateVersion: parseCertificateVersion(required(env, 'QZ_SIGNING_CERTIFICATE_VERSION')),
    signatureAlgorithm: QZ_SIGNATURE_ALGORITHM,
    canaryStoreCodes: parseCanaryStoreCodes(env, mode),
  }
}

export function readQzActiveSigningConfig(
  env: QzSigningEnv = process.env,
): QzActiveSigningConfig {
  const publicConfig = readQzPublicSigningConfig(env)
  if (publicConfig.mode === 'disabled') {
    throw new QzSigningConfigError('QZ_SIGNING_DISABLED')
  }
  const awsRegion = parseAwsRegion(required(env, 'QZ_SIGNING_AWS_REGION'))
  return {
    ...publicConfig,
    mode: publicConfig.mode,
    allowedOrigin: parseExactOrigin(required(env, 'QZ_SIGNING_ORIGIN')),
    awsRegion,
    awsRoleArn: parseAwsRoleArn(required(env, 'QZ_SIGNING_AWS_ROLE_ARN')),
    kmsKeyArn: parseKmsKeyArn(required(env, 'QZ_SIGNING_KMS_KEY_ARN'), awsRegion),
  }
}

export function isQzSigningStoreAllowed(config: QzActiveSigningConfig, storeCode: string): boolean {
  if (config.mode === 'general') return true
  return config.canaryStoreCodes.has(storeCode)
}

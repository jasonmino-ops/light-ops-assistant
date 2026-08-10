import assert from 'node:assert/strict'
import { createHash, X509Certificate } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { GET as getQzConfig } from '../app/api/qz/config/route'
import {
  QZ_KMS_MESSAGE_TYPE,
  QZ_KMS_SIGNING_ALGORITHM,
  QZ_SIGNATURE_ALGORITHM,
  readQzActiveSigningConfig,
  readQzPublicSigningConfig,
  type QzSigningEnv,
} from '../lib/qz-signing-config'
import { qzKmsSignCommand } from '../lib/qz-signing-server'
import { loadCertificatePackage } from '../tools/certificate-manager/src/core/certPackage'

const trustDir = new URL('../tools/e-shop-setup/assets/production-trust/', import.meta.url)
const certificatePackageDir = new URL('certificate-package/', trustDir)
const rootPath = new URL('certificate-package/eshop-root-ca.crt', trustDir)
const leafPath = new URL(
  'qz-signing/E-Shop-QZ-Production-Signing-KMS-69436da5-20260810.crt.pem',
  trustDir,
)
const chainPath = new URL(
  'qz-signing/E-Shop-QZ-Production-Chain-69436da5-20260810.pem',
  trustDir,
)
const switchCandidatePath = new URL('qz-signing/production-switch-candidate.json', trustDir)
const EXPECTED_KMS_PUBLIC_KEY_SHA256 = '74e78cfb8538a74c019a239c7421464685b23deee5261072ded431c18f20a65a'
const EXPECTED_KMS_KEY_ARN = 'arn:aws:kms:us-east-1:019141478288:key/69436da5-aaf6-4419-a47d-f119833035cc'
const EXPECTED_VERSION = 'production-leaf-20260810-69436da5'
const FORBIDDEN_IDENTITY = /\b(?:TEST|DEV|STAGING)\b|DO NOT USE IN PRODUCTION/i

type SwitchCandidate = {
  schema: 'eshop.qz-production-trust-candidate/v1'
  activeVersion: string
  signatureAlgorithm: string
  kmsSigningAlgorithm: string
  versionPairs: Array<{
    certificateVersion: string
    certificate: string
    certificateSha256: string
    kmsKeyArn: string
    signingEnabled: boolean
  }>
}

const rootPem = readFileSync(rootPath, 'utf8')
const leafPem = readFileSync(leafPath, 'utf8')
const chainPem = readFileSync(chainPath, 'utf8')
const root = new X509Certificate(rootPem)
const leaf = new X509Certificate(leafPem)
const candidate = JSON.parse(readFileSync(switchCandidatePath, 'utf8')) as SwitchCandidate

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function utcDurationDays(certificate: X509Certificate): number {
  return (Date.parse(certificate.validTo) - Date.parse(certificate.validFrom)) / 86_400_000
}

function signingEnv(): QzSigningEnv {
  return {
    QZ_SIGNING_MODE: 'general',
    QZ_SIGNING_ACTIVE_VERSION: candidate.activeVersion,
    QZ_SIGNING_VERSION_PAIRS_JSON: JSON.stringify(candidate.versionPairs),
    QZ_SIGNING_CANARY_STORE_CODES: '',
    QZ_SIGNING_ORIGIN: 'https://elifekh.com',
    QZ_SIGNING_AWS_REGION: 'us-east-1',
    QZ_SIGNING_AWS_ROLE_ARN: 'arn:aws:iam::019141478288:role/EshopQzSigningProduction',
  }
}

async function withProcessEnv<T>(values: QzSigningEnv, run: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await run()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function allFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) result.push(...allFiles(path))
    else result.push(path)
  }
  return result
}

async function testProductionRootIdentityAndPackage(): Promise<void> {
  assert.equal(root.subject, 'C=KH\nO=E-Shop\nCN=E-Shop Production Root CA')
  assert.equal(root.issuer, root.subject)
  assert.equal(root.ca, true)
  assert.equal(root.verify(root.publicKey), true)
  assert.equal(root.publicKey.asymmetricKeyType, 'rsa')
  assert.equal(root.publicKey.asymmetricKeyDetails?.modulusLength, 2048)
  assert.equal(utcDurationDays(root), 1826)
  assert.doesNotMatch(`${root.subject}\n${root.issuer}`, FORBIDDEN_IDENTITY)

  const certificatePackage = loadCertificatePackage(certificatePackageDir.pathname)
  assert.equal(certificatePackage.manifest.certificateId, 'eshop-production-root-ca')
  assert.equal(certificatePackage.manifest.displayName, 'E-Shop Production Root CA')
  assert.equal(certificatePackage.manifest.rootFingerprint, root.fingerprint256)
  assert.equal(certificatePackage.manifest.minimumQzVersion, '2.2.5')
  assert.equal(certificatePackage.pem.trim(), rootPem.trim())
}

async function testProductionLeafMatchesRootAndFrozenKmsIdentity(): Promise<void> {
  assert.match(leaf.subject, /CN=E-Shop QZ Production Signing/)
  assert.equal(leaf.issuer, root.subject)
  assert.equal(leaf.ca, false)
  assert.equal(leaf.checkIssued(root), true)
  assert.equal(leaf.verify(root.publicKey), true)
  assert.equal(leaf.publicKey.asymmetricKeyType, 'rsa')
  assert.equal(leaf.publicKey.asymmetricKeyDetails?.modulusLength, 2048)
  assert.equal(utcDurationDays(leaf), 365)
  assert.equal(
    sha256(leaf.publicKey.export({ type: 'spki', format: 'der' })),
    EXPECTED_KMS_PUBLIC_KEY_SHA256,
  )
  assert.doesNotMatch(`${leaf.subject}\n${leaf.issuer}`, FORBIDDEN_IDENTITY)
}

async function testPublicChainAndSwitchCandidate(): Promise<void> {
  const blocks = chainPem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)
  assert.equal(blocks?.length, 2)
  assert.equal(blocks?.[0]?.trim(), leafPem.trim())
  assert.equal(blocks?.[1]?.trim(), rootPem.trim())
  assert.equal(candidate.schema, 'eshop.qz-production-trust-candidate/v1')
  assert.equal(candidate.activeVersion, EXPECTED_VERSION)
  assert.equal(candidate.signatureAlgorithm, QZ_SIGNATURE_ALGORITHM)
  assert.equal(candidate.kmsSigningAlgorithm, QZ_KMS_SIGNING_ALGORITHM)
  assert.equal(candidate.versionPairs.length, 1)
  assert.equal(candidate.versionPairs[0]?.certificate, chainPem)
  assert.equal(candidate.versionPairs[0]?.certificateSha256, leaf.fingerprint256.replaceAll(':', '').toLowerCase())
  assert.equal(candidate.versionPairs[0]?.kmsKeyArn, EXPECTED_KMS_KEY_ARN)
  assert.equal(candidate.versionPairs[0]?.signingEnabled, true)
}

async function testExistingConfigAndSignContractsAcceptProductionIdentity(): Promise<void> {
  const now = new Date('2026-08-10T11:00:00.000Z')
  const publicConfig = readQzPublicSigningConfig(signingEnv(), now)
  assert.equal(publicConfig.certificateVersion, EXPECTED_VERSION)
  assert.equal(publicConfig.certificate.trim(), chainPem.trim())
  assert.equal(publicConfig.signatureAlgorithm, 'SHA512')
  assert.equal(publicConfig.mode, 'general')

  const activeConfig = readQzActiveSigningConfig(signingEnv(), now)
  const command = qzKmsSignCommand(activeConfig.activePair, 'a'.repeat(64)).input
  assert.equal(command.KeyId, EXPECTED_KMS_KEY_ARN)
  assert.equal(command.SigningAlgorithm, QZ_KMS_SIGNING_ALGORITHM)
  assert.equal(command.MessageType, QZ_KMS_MESSAGE_TYPE)
}

async function testQzConfigRoutePublishesProductionChain(): Promise<void> {
  await withProcessEnv(signingEnv(), async () => {
    const response = await getQzConfig()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
    const body = await response.json() as Record<string, unknown>
    assert.equal((body.certificate as string).trim(), chainPem.trim())
    assert.equal(body.certificateVersion, EXPECTED_VERSION)
    assert.equal(body.signatureAlgorithm, 'SHA512')
    assert.equal(body.enabled, true)
  })
}

async function testPublicArtifactBoundaryContainsNoPrivateOrTestMaterial(): Promise<void> {
  const files = allFiles(trustDir.pathname)
  assert.ok(files.length >= 5)
  for (const file of files) {
    assert.doesNotMatch(file, /\.(?:key|p12|pfx|jks)$/i)
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/)
    assert.doesNotMatch(text, FORBIDDEN_IDENTITY)
  }
}

async function main(): Promise<void> {
  await testProductionRootIdentityAndPackage()
  await testProductionLeafMatchesRootAndFrozenKmsIdentity()
  await testPublicChainAndSwitchCandidate()
  await testExistingConfigAndSignContractsAcceptProductionIdentity()
  await testQzConfigRoutePublishesProductionChain()
  await testPublicArtifactBoundaryContainsNoPrivateOrTestMaterial()
  console.log('E-Shop V1 Production Trust Identity tests passed (6/6)')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

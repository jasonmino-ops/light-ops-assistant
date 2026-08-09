import assert from 'node:assert/strict'
import { X509Certificate } from 'node:crypto'
import type { SignCommandOutput } from '@aws-sdk/client-kms'
import { NextRequest } from 'next/server'
import { GET as getQzConfig } from '../app/api/qz/config/route'
import { POST as postQzSign } from '../app/api/qz/sign/route'
import {
  QZ_KMS_MESSAGE_TYPE,
  QZ_KMS_SIGNING_ALGORITHM,
  QzSigningConfigError,
  getQzSigningPair,
  isQzSigningStoreAllowed,
  readQzActiveSigningConfig,
  readQzPublicSigningConfig,
} from '../lib/qz-signing-config'
import { handleQzSignRequest, type QzSignRouteDependencies } from '../lib/qz-signing-route'
import {
  QzSigningRequestError,
  assertQzCertificateVersion,
  assertQzDigestText,
  assertQzSignContentType,
  assertQzSignOrigin,
  qzKmsSignCommand,
  signQzDigestWithKms,
  type QzSigningSession,
} from '../lib/qz-signing-server'

const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDeDCCAmCgAwIBAgIUfHmE66Se2HHXdQa2t5MY+esj47QwDQYJKoZIhvcNAQEL
BQAwNzEaMBgGA1UEAwwRRS1TaG9wIFFaIFRlc3QgQ0ExGTAXBgNVBAoMEEUtU2hv
cCBUZXN0IE9ubHkwHhcNMjYwODAyMTYwNTI2WhcNMzYwNzMwMTYwNTI2WjA+MSEw
HwYDVQQDDBhFLVNob3AgUVogVGVzdCBQdWJsaXNoZXIxGTAXBgNVBAoMEEUtU2hv
cCBUZXN0IE9ubHkwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCkq9kQ
bXaDBZEkXKN93I+VpUfyef1UEh8eeOo91V8Fj+DIig3MSwMK1Vxg/RbtNG52UBvm
LpPblAcXmhx/2ER5GY7Jd65ixzuJ1AUiaiboBwi25U7Uu0cwCA2ezGnIZS5ICgrE
t1iBvpfl1NT/ZQgmkMLXrgD2osHy7ETHh7ZaXWD482iT1/Zq05s6xWHsIr2luFiY
L5K4b3z43QFiezdzCECNFZhmweSkXXsh/jwKyHGWQbmVZcx+SeMXnYe85s/dCoEd
Tsc+ZaWR3ErXDxvESz1d0UB29YgBQ1BsrXC6/q7vi3L9Ul+pH+YftzGAwCp9PxZK
SD4qKIRjrohEpJzNAgMBAAGjdTBzMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQD
AgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMDMB0GA1UdDgQWBBT4gV6Q7BidhcH4BJiN
8isY/2DLhjAfBgNVHSMEGDAWgBSLJysbyqrlRWk3YqRVkDh/T++trTANBgkqhkiG
9w0BAQsFAAOCAQEAQcP19qrt3gCAv/gZIKxJSJU6q0dQW4Boap/O+qHRC98gE5I9
EC1dR2isu1e8nzAqPEXDD9o5YbRAZmAne6I6CgH0zKi1ysxQY2PlliNdNO+5hvpS
AUh1XQADr1J8Kvs4RZRpUx2bim1tVgy1J/iFLXJBB5jCZmk5SZAsVvlMLSffiFxX
ayc7Z3gX4QOw0PifdsBefeQFjo5N6a1hJ5JgefoX4K+mQdTy2VQMIPbBQJsSUra8
R+6tW1vW7kKHK8JmbnOVf59k0/rFYtuB98kafbEDSg7B3DXnwNGw7rhGwvx51JOp
qKKXTo/Pu5xDq+K5VIHubfm2XPnGj7+pRtsfFA==
-----END CERTIFICATE-----`
const SELF_SIGNED_CA_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDTzCCAjegAwIBAgIUenE2btD5MKffNsY7Cf6bsbIvzUIwDQYJKoZIhvcNAQEL
BQAwNzEaMBgGA1UEAwwRRS1TaG9wIFFaIFRlc3QgQ0ExGTAXBgNVBAoMEEUtU2hv
cCBUZXN0IE9ubHkwHhcNMjYwODAyMTYwNTI2WhcNMzYwNzMwMTYwNTI2WjA3MRow
GAYDVQQDDBFFLVNob3AgUVogVGVzdCBDQTEZMBcGA1UECgwQRS1TaG9wIFRlc3Qg
T25seTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAJNliSyACfRB8HsL
EJXWPyRoZlj21b6J6fsGne4KhmdCUufT5gMiW5OM1uB89B4D7nRMI9u9QoCtTOFM
ywXpzTJSKIs1mqcGUy32Ez8eexe7oHMkI04fIE8AbslWS8A8U1YuitHqpR47wWhF
9PsCrSK9PQgskM0OVWSHdNj59Ym2bov39fuEbK03xVXo5JzSopcwq4h58X7eANAx
5/1bssnURSWc9DkGRNJ+pM5SOAYfDA+9fUMBoT2GjeG5ctUNo4gS3rXYdPcmv6JI
f9bTsZ3JHRMJ4IEcna42tTtF0z5EVf7rv8J4Tqm0XkKDFDR9O0wOAh5DSSbP1JSI
aXEsCCkCAwEAAaNTMFEwHQYDVR0OBBYEFIsnKxvKquVFaTdipFWQOH9P762tMB8G
A1UdIwQYMBaAFIsnKxvKquVFaTdipFWQOH9P762tMA8GA1UdEwEB/wQFMAMBAf8w
DQYJKoZIhvcNAQELBQADggEBAIqaeaEdoCXf3Aaqvg7VFdNBJGp3xfaO5Mw9S4hi
SdUVF3/K/pLZCxD3Qv13LumZ8isFvFI5NG1zRr+lZmAmblLDqWFu39zfdIhG6plS
fs4TmOvtcgsHsGHYntbfDZrQ8Lfw1DJB9aQNQuRgToZ6nexh3H+s4Y0RSp32RoyE
ZHtlQphLkyOKaYwo4KnxMdDd1Dyg4rdgai7wknI9aBIDpwOj4vBc48JGFC50LNUZ
r4mHTx8EwL1JyJFbhCXyzIOK/epA3mh9ZCLBbpJqpfJ1q4Wbx/MgEvxefoUjKbMj
yM/YsxURMU1CqlsBewBuS8hFz+Erl8OfLH9b0MOHDze5AdU=
-----END CERTIFICATE-----`
const SELF_SIGNED_LEAF_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIDkTCCAnmgAwIBAgIUectCnvsVZuAbFzewhtWFEQJ3IewwDQYJKoZIhvcNAQEL
BQAwRzEqMCgGA1UEAwwhU2lnbmluZyBBUEkgU2VsZi1TaWduZWQgTGVhZiBUZXN0
MRkwFwYDVQQKDBBFLVNob3AgVGVzdCBPbmx5MB4XDTI2MDgwNDIwMjYxOVoXDTM2
MDgwMTIwMjYxOVowRzEqMCgGA1UEAwwhU2lnbmluZyBBUEkgU2VsZi1TaWduZWQg
TGVhZiBUZXN0MRkwFwYDVQQKDBBFLVNob3AgVGVzdCBPbmx5MIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEApC9+XhFf2DTpQf2vYK7duhcNp4uL1YY4Qgvf
e94QtKEoOwJ6nN9fOtKe7ilAGnijoOVWXNsSremqNdl8MzzrfoCnhDHzdDFKs8xZ
yDnj64FyM2HsjvCSRBbHUbpqGzga5Fij6rZnpwnll9SxJtvUiNrGz3ek/CaxzswG
l58dLH7ktCaklKV6il2Hhq9UnBpUmyhyVeAvaNErzJcAK7HaqYVKuEJe5V2z6E6Z
cZ7vrL5DTOj8MfXPCzz1rkPFleAEgYNjLUVzLtQWH3FkLUu1whyIi6apC+ISUkeh
3eQfMIuU5ORHYj2EH0r33rbw5udEG1c4JH1KcKF8qq9gMaCwLQIDAQABo3UwczAd
BgNVHQ4EFgQUZnOvd8EPps0sK+JupiIgt/OeUPUwHwYDVR0jBBgwFoAUZnOvd8EP
ps0sK+JupiIgt/OeUPUwDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYD
VR0lBAwwCgYIKwYBBQUHAwMwDQYJKoZIhvcNAQELBQADggEBACRNtesny6fU3vbY
p1+DKyG6hIG+2gphX+Hqm+pD6K8MtFIv/1SRCXmoe8PYeYlpRqmYYAHHg+8qHluJ
vV7vhH+IvBJd2pLiFK7nC5wCi9LacjzRdFJAwJqwpadU27opEXT1Bcoax5volZ7c
qlkt9shz98EEws2CCufVe40p8GPCMaVC2QDxyNzKHUNm7uG9ZwfwQf6s9DZlOhP1
wKtqOKFkeTi5hA+vnbxWeDFiuRvJNdUdfM9rEpe0gFF/buEI0SXTATXTuHdXX74I
9aVXkFYv8JM8vyQEs3Xa4FZMaJkCNFukXgehAxl4YefaDAnJW/nW+W7AMxogdmS0
pv70ihA=
-----END CERTIFICATE-----`
const RSA_3072_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIID+DCCAuCgAwIBAgIUfHmE66Se2HHXdQa2t5MY+esj47UwDQYJKoZIhvcNAQEL
BQAwNzEaMBgGA1UEAwwRRS1TaG9wIFFaIFRlc3QgQ0ExGTAXBgNVBAoMEEUtU2hv
cCBUZXN0IE9ubHkwHhcNMjYwODAyMTcwMTIyWhcNMzYwNzMwMTcwMTIyWjA+MSEw
HwYDVQQDDBhFLVNob3AgUVogUlNBMzA3MiBSZWplY3QxGTAXBgNVBAoMEEUtU2hv
cCBUZXN0IE9ubHkwggGiMA0GCSqGSIb3DQEBAQUAA4IBjwAwggGKAoIBgQCqWnom
oGrAkmFyXSfjmKy6HgFDaUE1lm9S4gPX4to9yzrVI1CawcXqNur928leUAanoE3L
fZdM4VHFaJ7/aGpvwaqELjNMldDxXi0WyfoDkCqZzNd6vP7g6EgFb0IEWNkVbbyn
nSIpqCQ3VL2FogJn6UHzv7Ziktss83dCyrCFnljqdOO9RizvcN/SDnBDXwZ3D55i
8lw0XEDSeCd/1FbmEyduXAiEtvMBeqDOGIZko49hSz+qh11bWLk42ingY3NjRQ2R
hs9E6uevudMAy5PUHBkbW2/WcZan3azpKc7e81Jk+aIttq2dBIP5ZtiuOULNindD
BlFlYpTNlu8M/vluY76J73frNMZeOg2MKK1/IWS6RbUXxheEAkMZvy2FkzHnE8gW
pXPCHm51a6tNvlybtp164xaxn7V0iLELNpM3ZKmNJnKqZjU6GCYNDxgtobtOisHe
TC1oFdoQD/dYXK16Q+ciKyyI5LjIofd/SxoURbxcIUxnO8+YvHCcIioGiGkCAwEA
AaN1MHMwDAYDVR0TAQH/BAIwADAOBgNVHQ8BAf8EBAMCB4AwEwYDVR0lBAwwCgYI
KwYBBQUHAwMwHQYDVR0OBBYEFOZ2ehpq4jM6a1tsiR9Gk40wtqEyMB8GA1UdIwQY
MBaAFIsnKxvKquVFaTdipFWQOH9P762tMA0GCSqGSIb3DQEBCwUAA4IBAQBCa9MP
+v94gMocvjZOUUAeo3EiSrp/gHa3GUPhxw2XGry2koohAElGhz6P5WNY7ktkhPg1
0kZv5Gn6Ob7tKoNfgLOYnvU/t/D9UMJGi4ulsNO0fKfXm5HqiS1Xr1ATf2TKmvro
oGrTWzdfxQpNhAEKd2uaANeCLRX6gIE1E9W1hCrRMZ0w5XUJiLsLaKyiEoHWvlMO
ZmMbxFe4ziHqdz+70baQV6EWH8YoStat9l19FoDsgn0ukmSXy6kDl9FYK9ug2/jr
F44vZgOS2bLVX+9MWSXtDdcyw7E5nbnZLcxupoLicLToLSyIS6xMk2RA+t777T7e
13SRyhsVmCUY+2H1
-----END CERTIFICATE-----`
const CERTIFICATE_SHA256 = 'fcbf2715b030b26cdcaf51ac6c047bfa35fb323e5a32326f8369e0a6f135b2e2'
const SELF_SIGNED_SHA256 = '876aad5c43fed2c1c6b9caa9b32c05bddd1ae28b285333483310265aabc1e81f'
const SELF_SIGNED_LEAF_SHA256 = '29d35803cb9ba6a730be15d76ce4c1e972fb7634bff0c1af0aee92ce602caad1'
const RSA_3072_SHA256 = 'a02b47af3a8745eb0e5374377fa6a89feee34aaeae5af8252b59f937e262da9f'
const VALID_SIGNATURE = 'QV6VkZPGPxSS6DrirMforggxmRVshd9/cKjanOwFiXHajuyfFBOhCcc9dR9Xjc6xjEeznOXWfoK/M6jt2GbEIzPahA1oRKgSOFLJNIVJakkWZVtrQlCVXzvot7sd4Fg0EQcawqgA+5UxAy/YHh/PnesXGI6IgsX2Ynwiiqep8uxjAQOoiZN7R144Wf1dXb/GKFH9C10uf5u0ov11ymrZPfbKXeOzn0CGpmkJoCHZsHqQmuF0o/0wXSTXZF1GAGrmVb1D9//HeS+rf7dv97C40SUt4gPsavjO5CuQqVVPszF87r5+t5Vq3LolADCZw5QPt4RBmROpIOWBwFAYZfXmbg=='
const VERSION = 'qz-test-2026-01'
const REGION = 'us-east-1'
const ROLE_ARN = 'arn:aws:iam::123456789012:role/eshop-qz-sign-production'
const KEY_ARN = 'arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789abc'
const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

function versionPairs(overrides?: Record<string, unknown>) {
  return JSON.stringify([{
    certificateVersion: VERSION,
    certificate: CERTIFICATE,
    certificateSha256: CERTIFICATE_SHA256,
    kmsKeyArn: KEY_ARN,
    signingEnabled: true,
    ...overrides,
  }])
}

function env(mode: 'disabled' | 'canary' | 'general' = 'canary'): Record<string, string | undefined> {
  return {
    QZ_SIGNING_MODE: mode,
    QZ_SIGNING_ACTIVE_VERSION: VERSION,
    QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs(),
    QZ_SIGNING_CANARY_STORE_CODES: mode === 'canary' ? 'ST169E7000' : undefined,
    QZ_SIGNING_ORIGIN: 'https://elifekh.com',
    QZ_SIGNING_AWS_REGION: REGION,
    QZ_SIGNING_AWS_ROLE_ARN: ROLE_ARN,
  }
}

function request(headers?: Record<string, string>) {
  return new NextRequest('https://elifekh.com/api/qz/sign', {
    method: 'POST',
    headers: {
      origin: 'https://elifekh.com',
      'sec-fetch-site': 'same-origin',
      'content-type': 'text/plain; charset=utf-8',
      'x-qz-certificate-version': VERSION,
      'x-forwarded-for': '203.0.113.10',
      ...headers,
    },
    body: DIGEST,
  })
}

const ENV_KEYS = [
  'QZ_SIGNING_MODE',
  'QZ_SIGNING_ACTIVE_VERSION',
  'QZ_SIGNING_VERSION_PAIRS_JSON',
  'QZ_SIGNING_CANARY_STORE_CODES',
  'QZ_SIGNING_ORIGIN',
  'QZ_SIGNING_AWS_REGION',
  'QZ_SIGNING_AWS_ROLE_ARN',
] as const

async function withProcessEnv(values: Record<string, string | undefined>, fn: () => Promise<void>) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    for (const key of ENV_KEYS) {
      const value = values[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await fn()
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function assertInvalidConfig(values: Record<string, string | undefined>, now?: Date) {
  assert.throws(
    () => readQzPublicSigningConfig(values, now),
    (error: unknown) => error instanceof QzSigningConfigError && error.code === 'QZ_SIGNING_CONFIG_INVALID',
  )
}

async function testCertificateAndVersionPairsFailClosed() {
  const caCertificate = new X509Certificate(SELF_SIGNED_CA_CERTIFICATE)
  const selfSignedLeaf = new X509Certificate(SELF_SIGNED_LEAF_CERTIFICATE)
  const rsa3072Certificate = new X509Certificate(RSA_3072_CERTIFICATE)
  assert.equal(caCertificate.ca, true)
  assert.equal(selfSignedLeaf.ca, false)
  assert.equal(selfSignedLeaf.subject, selfSignedLeaf.issuer)
  assert.equal(rsa3072Certificate.publicKey.asymmetricKeyDetails?.modulusLength, 3072)

  assertInvalidConfig({})
  assertInvalidConfig({ ...env(), QZ_SIGNING_VERSION_PAIRS_JSON: '[]' })
  assertInvalidConfig({ ...env(), QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({ certificate: '' }) })
  assertInvalidConfig({ ...env(), QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({ certificate: 'not-a-certificate' }) })
  assertInvalidConfig({ ...env(), QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({ certificateSha256: '0'.repeat(64) }) })
  assertInvalidConfig({ ...env(), QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({ unexpected: true }) })
  assertInvalidConfig({
    ...env(),
    QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({
      certificate: SELF_SIGNED_CA_CERTIFICATE,
      certificateSha256: SELF_SIGNED_SHA256,
    }),
  })
  assertInvalidConfig({
    ...env(),
    QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({
      certificate: SELF_SIGNED_LEAF_CERTIFICATE,
      certificateSha256: SELF_SIGNED_LEAF_SHA256,
    }),
  })
  assertInvalidConfig({
    ...env(),
    QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({
      certificate: RSA_3072_CERTIFICATE,
      certificateSha256: RSA_3072_SHA256,
    }),
  })
  assertInvalidConfig(env(), new Date('2040-01-01T00:00:00.000Z'))

  const config = readQzActiveSigningConfig(env())
  assert.equal(config.activePair.certificateSha256, CERTIFICATE_SHA256)
  assert.equal(config.activePair.kmsKeyArn, KEY_ARN)
  assert.equal(getQzSigningPair(config, VERSION)?.kmsKeyArn, KEY_ARN)
  assert.equal(getQzSigningPair(config, 'unknown'), null)
  const withDisabledPrevious = readQzActiveSigningConfig({
    ...env(),
    QZ_SIGNING_VERSION_PAIRS_JSON: JSON.stringify([
      JSON.parse(versionPairs())[0],
      {
        ...JSON.parse(versionPairs())[0],
        certificateVersion: 'qz-previous-disabled',
        signingEnabled: false,
      },
    ]),
  })
  assert.equal(getQzSigningPair(withDisabledPrevious, 'qz-previous-disabled'), null)
  assert.throws(
    () => readQzActiveSigningConfig({ ...env(), QZ_SIGNING_AWS_REGION: 'ap-southeast-1' }),
    /QZ_SIGNING_CONFIG_INVALID/,
  )
}

async function testConfigModesAndCanaryFailClosed() {
  const disabled = readQzPublicSigningConfig(env('disabled'))
  assert.equal(disabled.mode, 'disabled')
  assert.throws(() => readQzActiveSigningConfig(env('disabled')), /QZ_SIGNING_DISABLED/)
  assertInvalidConfig({ ...env('canary'), QZ_SIGNING_CANARY_STORE_CODES: '' })
  assertInvalidConfig({ ...env('general'), QZ_SIGNING_CANARY_STORE_CODES: 'ST169E7000' })

  const canary = readQzActiveSigningConfig(env('canary'))
  assert.equal(isQzSigningStoreAllowed(canary, 'ST169E7000'), true)
  assert.equal(isQzSigningStoreAllowed(canary, 'ST-OTHER'), false)
  assert.equal(isQzSigningStoreAllowed(readQzActiveSigningConfig(env('general')), 'ST-OTHER'), true)
}

async function testConfigEndpointIsPublicStrictAndNoStore() {
  await withProcessEnv({}, async () => {
    const response = await getQzConfig()
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error, 'QZ_SIGNING_CONFIG_INVALID')
  })
  await withProcessEnv(env('canary'), async () => {
    const response = await getQzConfig()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') ?? '', /no-store/)
    assert.deepEqual(await response.json(), {
      certificate: CERTIFICATE,
      signatureAlgorithm: 'SHA512',
      certificateVersion: VERSION,
      enabled: true,
    })
  })
  await withProcessEnv({ ...env(), QZ_SIGNING_VERSION_PAIRS_JSON: versionPairs({ certificate: 'broken' }) }, async () => {
    const response = await getQzConfig()
    assert.equal(response.status, 503)
    assert.equal((await response.json()).error, 'QZ_SIGNING_CONFIG_INVALID')
  })
}

async function testRequestContract() {
  const config = readQzActiveSigningConfig(env())
  assert.doesNotThrow(() => assertQzSignOrigin(request(), config))
  assert.doesNotThrow(() => assertQzSignContentType(request()))
  assert.equal(assertQzCertificateVersion(request(), config).certificateVersion, VERSION)
  assert.equal(assertQzDigestText(DIGEST), DIGEST)
  assert.throws(() => assertQzSignOrigin(request({ origin: 'https://attacker.example' }), config), /QZ_SIGN_ORIGIN_FORBIDDEN/)
  assert.throws(() => assertQzSignContentType(request({ 'content-type': 'application/json' })), /QZ_SIGN_CONTENT_TYPE_INVALID/)
  assert.throws(() => assertQzCertificateVersion(request({ 'x-qz-certificate-version': 'old' }), config), /QZ_SIGN_VERSION_MISMATCH/)
  assert.throws(() => assertQzDigestText(`${DIGEST}\n`), /QZ_SIGN_INPUT_INVALID/)
}

async function testKmsPairIsCryptographicallyBound() {
  const config = readQzActiveSigningConfig(env())
  const pair = config.activePair
  const command = qzKmsSignCommand(pair, DIGEST)
  assert.equal(command.input.KeyId, KEY_ARN)
  assert.equal(command.input.MessageType, QZ_KMS_MESSAGE_TYPE)
  assert.equal(command.input.SigningAlgorithm, QZ_KMS_SIGNING_ALGORITHM)
  assert.equal(Buffer.from(command.input.Message ?? []).toString('utf8'), DIGEST)
  assert.equal(command.input.Message?.byteLength, 64)

  const signatureBytes = Buffer.from(VALID_SIGNATURE, 'base64')
  const signature = await signQzDigestWithKms(config, pair, DIGEST, {
    send: async () => ({
      KeyId: KEY_ARN,
      SigningAlgorithm: QZ_KMS_SIGNING_ALGORITHM,
      Signature: signatureBytes,
      $metadata: {},
    } satisfies SignCommandOutput),
  })
  assert.equal(signature, VALID_SIGNATURE)

  await assert.rejects(() => signQzDigestWithKms(config, pair, DIGEST, {
    send: async () => ({
      KeyId: KEY_ARN,
      SigningAlgorithm: QZ_KMS_SIGNING_ALGORITHM,
      Signature: Uint8Array.from([1, 2, 3, 4]),
      $metadata: {},
    }),
  }), /QZ_SIGN_KMS_FAILED/)
}

const VALID_SESSION: QzSigningSession = {
  tenantId: 'tenant-1',
  storeId: 'store-1',
  storeCode: 'ST169E7000',
  sessionFingerprint: 'session-fingerprint-1',
  deviceId: 'device-1',
}

function routeDependencies(overrides: Partial<QzSignRouteDependencies> = {}) {
  const calls: string[] = []
  const dependencies: QzSignRouteDependencies = {
    readConfig: () => readQzActiveSigningConfig(env()),
    verifySession: async () => VALID_SESSION,
    reserveAttempt: async () => { calls.push('reserve'); return 'audit-1' },
    sign: async () => { calls.push('sign'); return VALID_SIGNATURE },
    finishAudit: async (_id, result, errorCode) => {
      calls.push(`audit:${result}${errorCode ? `:${errorCode}` : ''}`)
    },
    ...overrides,
  }
  return { calls, dependencies }
}

async function testRuntimeSuccessAndSecurityFailures() {
  const success = routeDependencies()
  const successResponse = await handleQzSignRequest(request(), success.dependencies)
  assert.equal(successResponse.status, 200)
  assert.equal(await successResponse.text(), VALID_SIGNATURE)
  assert.deepEqual(success.calls, ['reserve', 'sign', 'audit:SUCCESS'])

  const noSession = routeDependencies({ verifySession: async () => null })
  const noSessionResponse = await handleQzSignRequest(request(), noSession.dependencies)
  assert.equal(noSessionResponse.status, 401)
  assert.deepEqual(noSession.calls, [])

  const missingIp = routeDependencies()
  const missingIpResponse = await handleQzSignRequest(request({ 'x-forwarded-for': '' }), missingIp.dependencies)
  assert.equal(missingIpResponse.status, 400)
  assert.equal((await missingIpResponse.json()).error, 'QZ_SIGN_REQUEST_METADATA_INVALID')
  assert.deepEqual(missingIp.calls, [])

  const differentLegalStore = routeDependencies({
    verifySession: async () => ({ ...VALID_SESSION, storeCode: 'ST87CC8E11' }),
  })
  const differentLegalStoreResponse = await handleQzSignRequest(request(), differentLegalStore.dependencies)
  assert.equal(differentLegalStoreResponse.status, 200)
  assert.equal(await differentLegalStoreResponse.text(), VALID_SIGNATURE)
  assert.deepEqual(differentLegalStore.calls, ['reserve', 'sign', 'audit:SUCCESS'])

  const wrongVersion = routeDependencies()
  const versionResponse = await handleQzSignRequest(
    request({ 'x-qz-certificate-version': 'unknown' }),
    wrongVersion.dependencies,
  )
  assert.equal(versionResponse.status, 409)
  assert.equal(versionResponse.headers.get('x-qz-current-certificate-version'), VERSION)
  assert.deepEqual(wrongVersion.calls, [])

  const kmsFailure = routeDependencies({
    sign: async () => { throw new QzSigningRequestError('QZ_SIGN_KMS_FAILED') },
  })
  const kmsFailureResponse = await handleQzSignRequest(request(), kmsFailure.dependencies)
  assert.equal(kmsFailureResponse.status, 503)
  assert.equal((await kmsFailureResponse.json()).error, 'QZ_SIGN_KMS_FAILED')
  assert.deepEqual(kmsFailure.calls, ['reserve', 'audit:FAILED:QZ_SIGN_KMS_FAILED'])

  const rateLimited = routeDependencies({
    reserveAttempt: async () => { throw new QzSigningRequestError('QZ_SIGN_RATE_LIMITED') },
  })
  const rateResponse = await handleQzSignRequest(request(), rateLimited.dependencies)
  assert.equal(rateResponse.status, 429)
  assert.deepEqual(rateLimited.calls, [])

  const auditReserveFailure = routeDependencies({
    reserveAttempt: async () => { throw new QzSigningRequestError('QZ_SIGN_AUDIT_FAILED') },
  })
  const auditReserveResponse = await handleQzSignRequest(request(), auditReserveFailure.dependencies)
  assert.equal(auditReserveResponse.status, 503)
  assert.equal((await auditReserveResponse.json()).error, 'QZ_SIGN_AUDIT_FAILED')
  assert.deepEqual(auditReserveFailure.calls, [], 'KMS must not run when audit reservation fails')

  const auditFinishFailure = routeDependencies({
    finishAudit: async () => { throw new QzSigningRequestError('QZ_SIGN_AUDIT_FAILED') },
  })
  const auditFinishResponse = await handleQzSignRequest(request(), auditFinishFailure.dependencies)
  assert.equal(auditFinishResponse.status, 503)
  assert.equal((await auditFinishResponse.json()).error, 'QZ_SIGN_AUDIT_FAILED')
  assert.deepEqual(auditFinishFailure.calls, ['reserve', 'sign'])
}

async function testDefaultEndpointFailsBeforeKmsWithoutSession() {
  await withProcessEnv(env('disabled'), async () => {
    const response = await postQzSign(request())
    assert.equal(response.status, 403)
  })
  await withProcessEnv(env(), async () => {
    const noSession = await postQzSign(request())
    assert.equal(noSession.status, 401)
    assert.equal((await noSession.json()).error, 'QZ_SIGN_SESSION_UNAUTHORIZED')
  })
}

async function run() {
  await testCertificateAndVersionPairsFailClosed()
  await testConfigModesAndCanaryFailClosed()
  await testConfigEndpointIsPublicStrictAndNoStore()
  await testRequestContract()
  await testKmsPairIsCryptographicallyBound()
  await testRuntimeSuccessAndSecurityFailures()
  await testDefaultEndpointFailsBeforeKmsWithoutSession()
  console.log('QZ signing runtime and contract tests passed')
}

void run().catch((error) => {
  setTimeout(() => { throw error }, 0)
})

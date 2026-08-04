import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const config = read('lib/qz-signing-config.ts')
const server = read('lib/qz-signing-server.ts')
const signingRoute = read('lib/qz-signing-route.ts')
const configRoute = read('app/api/qz/config/route.ts')
const signRoute = read('app/api/qz/sign/route.ts')
const signingProductionSource = [config, server, signingRoute, configRoute, signRoute].join('\n')

assert.match(configRoute, /certificate:\s*config\.certificate/)
assert.match(configRoute, /signatureAlgorithm:\s*config\.signatureAlgorithm/)
assert.match(configRoute, /certificateVersion:\s*config\.certificateVersion/)
assert.match(configRoute, /enabled:\s*config\.mode !== 'disabled'/)
assert.match(configRoute, /Cache-Control':\s*'no-store/)
assert.doesNotMatch(configRoute, /verifyPosDevice|getContext/, 'public config must not require a POS session')

assert.match(signRoute, /runtime\s*=\s*'nodejs'/)
assert.match(signRoute, /dynamic\s*=\s*'force-dynamic'/)
assert.match(signRoute, /handleQzSignRequest\(req\)/)

assert.match(signingRoute, /assertQzSignOrigin\(req, config\)/)
assert.match(signingRoute, /assertQzSignContentType\(req\)/)
assert.match(signingRoute, /assertQzCertificateVersion\(req, config\)/)
assert.match(signingRoute, /assertQzDigestText\(await req\.text\(\)\)/)
assert.match(signingRoute, /dependencies\.verifySession\(req\)/)
assert.match(signingRoute, /isQzSigningStoreAllowed\(config, session\.storeCode\)/)
assert.match(signingRoute, /dependencies\.reserveAttempt/)
assert.match(signingRoute, /dependencies\.sign/)
assert.match(signingRoute, /dependencies\.finishAudit/)
assert.doesNotMatch(signingRoute, /window\.print|application\/json[\s\S]*req\.json/)

assert.match(config, /'disabled' \| 'canary' \| 'general'/)
assert.match(config, /mode === 'canary' && values\.length === 0/)
assert.match(config, /mode === 'general' && values\.length > 0/)
assert.match(config, /new X509Certificate/)
assert.match(config, /fingerprint !== expectedSha256/)
assert.match(config, /versionPairs:\s*ReadonlyMap/)
assert.match(config, /signingEnabled/)

assert.match(server, /getPosAuthHeaders/)
assert.match(server, /verifyPosDeviceToken/)
assert.match(server, /verifyPosDeviceRequest/)
assert.match(server, /sessionFingerprint:\s*hashAuditValue\(`session-token:\$\{token\}`\)/)
assert.match(server, /Prisma\.TransactionIsolationLevel\.Serializable/)
assert.match(server, /actionType:\s*'QZ_SIGN'/)
assert.match(server, /deviceHash/)
assert.match(server, /ipHash/)
assert.match(server, /storeAttempts/)
assert.doesNotMatch(server, /digestText[,}]\s*\n?\s*payloadSnapshot|Signature[,:]\s*.*payloadSnapshot/)
assert.match(server, /Message:\s*Buffer\.from\(assertQzDigestText\(digestText\), 'utf8'\)/)
assert.match(server, /MessageType:\s*QZ_KMS_MESSAGE_TYPE/)
assert.match(server, /SigningAlgorithm:\s*QZ_KMS_SIGNING_ALGORITHM/)
assert.match(server, /verifySignature\('RSA-SHA512'/)
assert.match(server, /awsCredentialsProvider/)
assert.doesNotMatch(server, /fromHex|hexTo|Buffer\.from\([^)]*,\s*'hex'\)|MessageType:\s*['"]DIGEST/)

assert.doesNotMatch(signingProductionSource, /BrowserPosDevice|browserPosSessionId|ComputerBinding/)
assert.doesNotMatch(signingProductionSource, /PRIVATE KEY|private-key|\.pfx/i)
assert.doesNotMatch(signingProductionSource, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/)
assert.doesNotMatch(signingProductionSource, /qzPrinterAdapter|app\/cashier|qzEscPosBitImage|qzHtmlBitmapRenderer/)

console.log('QZ signing API static checks passed')

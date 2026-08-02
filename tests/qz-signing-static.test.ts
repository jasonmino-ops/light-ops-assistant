import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const adapter = read('lib/qzPrinterAdapter.ts')
const config = read('lib/qz-signing-config.ts')
const server = read('lib/qz-signing-server.ts')
const configRoute = read('app/api/qz/config/route.ts')
const signRoute = read('app/api/qz/sign/route.ts')

assert.match(adapter, /setSignatureAlgorithm\('SHA512'\)/)
assert.match(adapter, /setCertificatePromise[\s\S]*rejectOnFailure:\s*true/)
assert.match(adapter, /fetch\('\/api\/qz\/config'/)
assert.match(adapter, /fetch\('\/api\/qz\/sign'/)
assert.match(adapter, /'Content-Type':\s*'text\/plain; charset=utf-8'/)
assert.match(adapter, /'X-QZ-Certificate-Version':\s*securityConfig\.certificateVersion/)
assert.match(adapter, /posDeviceHeaders\(currentCashierStoreCode\(\)\)/)
assert.doesNotMatch(adapter, /resolve\(''\)/, 'blank QZ certificate/signature fallback must be removed')
assert.doesNotMatch(adapter, /window\.print/, 'QZ signing failures must not downgrade to browser printing')

assert.match(configRoute, /certificate:\s*config\.certificate/)
assert.match(configRoute, /signatureAlgorithm:\s*config\.signatureAlgorithm/)
assert.match(configRoute, /certificateVersion:\s*config\.certificateVersion/)
assert.match(configRoute, /enabled:\s*config\.mode !== 'disabled'/)
assert.match(configRoute, /Cache-Control':\s*'no-store/)
assert.doesNotMatch(configRoute, /verifyPosDevice|getContext|ComputerBinding/, 'public QZ config must not require a POS session')

assert.match(signRoute, /assertQzSignOrigin\(req, config\)/)
assert.match(signRoute, /assertQzSignContentType\(req\)/)
assert.match(signRoute, /assertQzCertificateVersion\(req, config\)/)
assert.match(signRoute, /assertQzDigestText\(await req\.text\(\)\)/)
assert.match(signRoute, /verifyQzSigningSession\(req\)/)
assert.match(signRoute, /isQzSigningStoreAllowed\(config, session\.storeCode\)/)
assert.match(signRoute, /reserveQzSignRateLimit/)
assert.match(signRoute, /signQzDigestWithKms/)
assert.match(signRoute, /finishQzSignAudit/)
assert.doesNotMatch(signRoute, /ComputerBinding|window\.print|application\/json[\s\S]*req\.json/)

assert.match(config, /'disabled' \| 'canary' \| 'general'/)
assert.match(config, /mode === 'canary' && values\.length === 0/)
assert.match(config, /mode === 'general' && values\.length > 0/)
assert.match(config, /if \(config\.mode === 'general'\) return true/)

assert.match(server, /verifyPosDeviceRequest/)
assert.match(server, /payload\?\.browserPosSessionId/)
assert.doesNotMatch(server, /computerBinding|claimSecret|deviceSecret/i)
assert.match(server, /Prisma\.TransactionIsolationLevel\.Serializable/)
assert.match(server, /actionType:\s*'QZ_SIGN'/)
assert.doesNotMatch(server, /digestText[,}]\s*\n?\s*payloadSnapshot|Signature[,:]\s*.*payloadSnapshot/)
assert.match(server, /Message:\s*Buffer\.from\(assertQzDigestText\(digestText\), 'utf8'\)/)
assert.match(server, /MessageType:\s*QZ_KMS_MESSAGE_TYPE/)
assert.match(server, /SigningAlgorithm:\s*QZ_KMS_SIGNING_ALGORITHM/)
assert.match(server, /awsCredentialsProvider/)
assert.doesNotMatch(server, /fromHex|hexTo|Buffer\.from\([^)]*,\s*'hex'\)|MessageType:\s*['"]DIGEST/)
assert.doesNotMatch(server, /PRIVATE KEY|private-key|\.pfx|\.pem/i)

console.log('QZ signing static checks passed')

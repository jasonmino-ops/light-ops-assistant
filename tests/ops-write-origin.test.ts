import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { enforceOpsWriteOrigin } from '../lib/ops-write-origin'

function request(
  url: string,
  method: string,
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, { method, headers })
}

function assertAllowed(req: NextRequest, label: string) {
  assert.equal(enforceOpsWriteOrigin(req), null, label)
}

async function assertRejected(req: NextRequest, label: string) {
  const response = enforceOpsWriteOrigin(req)
  assert.ok(response, label)
  assert.equal(response.status, 403, label)
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0', label)
  assert.equal((await response.json()).error, 'OPS_WRITE_ORIGIN_FORBIDDEN', label)
}

async function main() {
  assertAllowed(request('https://preview.example/api/ops/write', 'POST', {
  origin: 'https://preview.example',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Chrome',
  }), 'Chrome same-origin POST')

  assertAllowed(request('https://preview.example/api/ops/write', 'POST', {
  origin: 'https://preview.example',
  'sec-fetch-site': 'same-origin',
  'user-agent': 'Telegram-Android',
  }), 'Telegram WebView same-origin POST')

  assertAllowed(request('http://localhost:3000/api/ops/write', 'POST', {
  origin: 'http://localhost:3000',
  'sec-fetch-site': 'same-origin',
  }), 'localhost same-origin POST')

  assertAllowed(request('http://localhost:3000/api/ops/write', 'POST', {
  referer: 'http://localhost:3000/ops/desktop/activation',
  }), 'legacy same-origin Referer fallback')

  assertAllowed(request('https://preview.example/api/ops/write', 'POST', {
  'sec-fetch-site': 'same-origin',
  }), 'missing Origin with same-origin Fetch Metadata')

  assertAllowed(request('https://preview.example/api/ops/write', 'GET', {
  origin: 'https://foreign.example',
  'sec-fetch-site': 'cross-site',
  }), 'GET remains unaffected')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST', {
  origin: 'https://foreign.example',
  'sec-fetch-site': 'cross-site',
  }), 'foreign Origin')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST', {
  origin: 'null',
  }), 'null Origin')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST', {
  origin: 'not an origin',
  }), 'malformed Origin')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST', {
  origin: 'https://preview.example',
  'sec-fetch-site': 'cross-site',
  }), 'contradictory cross-site Fetch Metadata')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST', {
  'sec-fetch-site': 'same-site',
  }), 'same-site is not implicitly trusted')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST', {
  referer: 'https://preview.example.foreign.test/ops',
  }), 'spoofed Referer')

  await assertRejected(request('https://preview.example/api/ops/write', 'POST'), 'missing origin signals')

  console.log('ops write origin guard tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

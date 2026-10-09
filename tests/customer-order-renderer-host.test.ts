import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
// Host orchestration tests use an injected renderer, not browser/sandbox proof.
// Native sandbox/cgroup evidence is produced by the isolated Linux run.
const modulePath = '../packages/h5-renderer/module.mjs'
const controllerPath = '../packages/h5-renderer/controller.mjs'
const servicePath = '../packages/h5-renderer/service.mjs'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const profileId = sha('host-isolated-fixture')
function input() {
  const snapshotJson = JSON.stringify({ tenantId: 't', storeId: 's', orderNo: 'o', storeName: '中文 ខ្មែរ English', currencyCode: 'USD', createdAt: new Date().toISOString(), paidAt: null,
    tableNo: 'A1', remark: 'remark', totalAmount: 2, paymentStatus: 'UNPAID', paymentMethod: null,
    items: [{ productId: 'p', name: '茶', spec: null, price: 2, quantity: 1, lineAmount: 2, printKitchenTicket: true }] })
  return { tenantId: 't', storeId: 's', orderNo: 'o', role: 'KITCHEN', schemaVersion: 3, snapshotJson, snapshotHash: sha(snapshotJson), profileId, deadlineAt: new Date(Date.now() + 60_000).toISOString() }
}
test('three ticket purposes validate strictly; legacy snapshots stay paid-FRONT or kitchen only', async () => {
  const { validateRenderInput, ticketHtml } = await import(modulePath)
  const base = input(), snapshot = JSON.parse(base.snapshotJson)
  const make = (role: string, patch: any) => { const json = JSON.stringify({ ...snapshot, ...patch }); return { ...base, role, snapshotJson: json, snapshotHash: sha(json) } }
  assert.equal(validateRenderInput(base).ticketPurpose, 'KITCHEN_MAKE')
  const paid = make('FRONT', { paymentStatus: 'PAID', paymentMethod: 'QR', paidAt: new Date().toISOString() })
  assert.equal(validateRenderInput(paid).ticketPurpose, 'FRONT_PAID')
  const unpaid = make('FRONT', { ticketPurpose: 'FRONT_UNPAID' })
  assert.equal(validateRenderInput(unpaid).ticketPurpose, 'FRONT_UNPAID')
  const html = ticketHtml(unpaid, '')
  assert.match(html, /FRONT 未付款订单票/); assert.match(html, /非支付凭证/)
  assert.doesNotMatch(html, /PAID · 已收款|付款方式|Payment:/)
  assert.throws(() => validateRenderInput(make('FRONT', {})), /PAYMENT_REQUIRED/)
  for (const [role, purpose] of [['FRONT', 'KITCHEN_MAKE'], ['KITCHEN', 'FRONT_UNPAID'], ['KITCHEN', 'FRONT_PAID'], ['FRONT', 'OTHER']]) {
    assert.throws(() => validateRenderInput(make(role, { ticketPurpose: purpose })), /ROLE_PURPOSE_MISMATCH/)
  }
  for (const patch of [{ paidAt: new Date().toISOString() }, { paymentMethod: 'CASH' }, { paymentStatus: 'PAID' }]) {
    assert.throws(() => validateRenderInput(make('FRONT', { ticketPurpose: 'FRONT_UNPAID', ...patch })), /UNPAID_SNAPSHOT/)
  }
})
test('host module rejects oversized/mutated/expired input and escapes every untrusted display field', async () => {
  const { validateRenderInput, ticketHtml } = await import(modulePath)
  const original = input()
  assert.ok(validateRenderInput(original))
  assert.throws(() => validateRenderInput({ ...original, url: 'file:///etc/passwd' }), /FIELDS/)
  assert.throws(() => validateRenderInput({ ...original, snapshotHash: 'f'.repeat(64) }), /INTEGRITY/)
  assert.throws(() => validateRenderInput({ ...original, deadlineAt: new Date(0).toISOString() }), /EXPIRED/)
  for (const field of ['storeName', 'tableNo', 'remark', 'name', 'spec', 'sugar']) {
    const s = JSON.parse(original.snapshotJson)
    const value = '<script src="https://bad.invalid/x">x</script><img src="file:///etc/passwd"><style>@import url(https://bad.invalid)</style>'
    if (['name', 'spec', 'sugar'].includes(field)) s.items[0][field] = value
    else s[field] = value
    const json = JSON.stringify(s), current = { ...original, snapshotJson: json, snapshotHash: sha(json) }
    if (['storeName', 'tableNo', 'sugar'].includes(field)) {
      const target = field === 'sugar' ? s.items[0] : s
      target[field] = 'x'.repeat(129)
      const oversized = JSON.stringify(s)
      assert.throws(() => ticketHtml({ ...original, snapshotJson: oversized, snapshotHash: sha(oversized) }, ''), /FIELD_LIMIT/)
      target[field] = '<img src="file:///x">'
      const short = JSON.stringify(s)
      const html = ticketHtml({ ...original, snapshotJson: short, snapshotHash: sha(short) }, '')
      assert.ok(html.includes('&lt;img')); assert.ok(!html.includes('<img'))
    } else {
      const html = ticketHtml(current, '')
      assert.ok(html.includes('&lt;script')); assert.ok(!html.includes('<script')); assert.ok(!html.includes('<img'))
    }
  }
  const s = JSON.parse(original.snapshotJson); s.items = Array(101).fill(s.items[0])
  const json = JSON.stringify(s)
  assert.throws(() => validateRenderInput({ ...original, snapshotJson: json, snapshotHash: sha(json) }), /ITEMS_LIMIT/)
})
test('controller strips credentials and lease before rendering, retries exact result after uncertain response', async () => {
  const { controllerStep, rendererInput } = await import(controllerPath)
  const claim = { ...input(), intentId: 'i', revision: 1, token: 'secret-lease', leaseExpiresAt: new Date(Date.now()+60_000).toISOString() }
  assert.deepEqual(Object.keys(rendererInput(claim)).sort(), Object.keys(input()).sort())
  const calls: any[] = [], state: any = { pending: null }; let rendered = 0, reports = 0
  const api = async (action: string, result: any) => {
    calls.push({ action, result: structuredClone(result) })
    if (action === 'claim') return { kind: 'CLAIMED', claim }
    if (++reports === 1) throw Error('reply lost after commit')
    return { kind: 'ALREADY_SEALED' }
  }
  const renderer = async (action: string, value: any) => {
    if (action === 'health') return { ready: true, profileId }
    assert.equal(value.token, undefined); assert.equal(value.intentId, undefined); rendered++
    return { payloadBase64: 'AA==', byteLength: 1, payloadHash: '0'.repeat(64), rendererVersion: profileId }
  }
  assert.equal((await controllerStep({ api, renderer, state })).kind, 'REPORT_PENDING')
  await assert.rejects(controllerStep({ api, renderer, state }), /reply lost/)
  assert.equal((await controllerStep({ api, renderer, state })).kind, 'ALREADY_SEALED')
  assert.deepEqual(calls[1], calls[2]); assert.equal(rendered, 1); assert.equal(state.pending, null)
})
test('dead renderer does not reserve work; stale output drops without posting; controller restart depends on DB lease', async () => {
  const { controllerStep } = await import(controllerPath)
  let calls = 0
  const api = async () => { calls++; throw Error('must not call') }
  assert.equal((await controllerStep({ api, renderer: async () => ({ ready: false }), state: { pending: null } })).kind, 'HOST_NOT_READY')
  const state = { pending: { action: 'result', result: {}, leaseExpiresAt: new Date(0).toISOString() } }
  assert.equal((await controllerStep({ api, renderer: async () => {}, state })).kind, 'LATE_DROPPED')
  assert.equal(calls, 0)
})
test('API transport refuses redirects/non-HTTPS and bounds responses', async () => {
  const { createApiTransport } = await import(controllerPath)
  assert.throws(() => createApiTransport('http://localhost/api/customer-order-renderer', 'a'.repeat(43)), /HTTPS/)
  const transport = createApiTransport('https://isolated.invalid/api/customer-order-renderer', 'a'.repeat(43), async (_url: URL, options: any) => {
    assert.equal(options.redirect, 'error'); assert.ok(options.signal)
    return new Response('x'.repeat(160 * 1024 + 1))
  })
  await assert.rejects(transport('claim'), /REPLY_LIMIT/)
})
test('Unix service is serial, closes on renderer failure, and keeps independent controller health responsive', async () => {
  const { startRenderService } = await import(servicePath)
  const { socketCall, startController } = await import(controllerPath)
  const dir = await mkdtemp(join(tmpdir(), 'h5-host-test-')), socket = join(dir, 'renderer.sock')
  let release!: () => void, entered!: () => void, closed = 0, exited = 0
  const enteredPromise = new Promise<void>(done => { entered = done })
  const pending = new Promise<void>(done => { release = done })
  const service = await startRenderService({ socketPath: socket, exit: () => { exited++ }, rendererFactory: async () => ({ profileId,
    render: async () => { entered(); await pending; throw Error('injected browser failure') }, close: async () => { closed++ } }) })
  const controller = await startController({ api: async () => ({ kind: 'IDLE' }), renderer: async () => { throw Error('sandbox offline') }, port: 0, interval: 10 })
  try {
    const first = socketCall(socket, 'POST', '/render', input()).then(() => 'unexpected success', (e: Error) => e.message)
    await Promise.race([enteredPromise, new Promise((_, reject) => setTimeout(() => reject(Error('entered timeout')), 2000).unref())])
    await assert.rejects(socketCall(socket, 'POST', '/render', input()), /RENDER_BUSY/)
    const health = await fetch(`http://127.0.0.1:${controller.address.port}/health`)
    assert.equal(health.status, 200); assert.equal((await health.json()).alive, true)
    release(); assert.equal(await first, 'RENDER_FAILED')
    await new Promise(done => setTimeout(done, 300))
    assert.equal(exited, 1); assert.ok(closed >= 1)
  } finally { release(); await service.close(); await controller.close(); await rm(dir, { recursive: true }) }
})
test('host units retain distinct users, kernel sandbox, cgroup and network isolation requirements', async () => {
  const base = 'packages/h5-renderer/runtime/'
  const renderer = await readFile(base+'h5-render-sandbox.service','utf8'), controller = await readFile(base+'h5-render-controller.service','utf8')
  assert.match(renderer, /User=h5-render-sandbox/); assert.match(controller, /User=h5-render-controller/)
  assert.match(renderer, /PrivateNetwork=yes/); assert.match(renderer, /MemoryMax=2G/)
  assert.match(renderer, /KillMode=control-group/); assert.match(controller, /MemoryMax=256M/)
  assert.doesNotMatch(renderer, /LoadCredential/); assert.match(controller, /LoadCredential=/)
  assert.doesNotMatch(await readFile('packages/h5-renderer/module.mjs','utf8'), /--no-sandbox|--disable-web-security/)
})

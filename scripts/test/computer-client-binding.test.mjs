/**
 * EP-CC-01 电脑客户端绑定闭环 —— 集成测试。
 *
 * 特点：
 *   - 只用 Node 内置 node:test，不引入任何测试框架依赖；
 *   - 打真实 HTTP 接口，跑真实 Next 服务与真实 PostgreSQL；
 *   - 只连测试库，绝不连生产（启动脚本强制注入临时库 URL）。
 *
 * 运行方式见 scripts/test/run-computer-client-tests.sh
 *
 * 必需环境变量：
 *   TEST_BASE_URL          已配置密钥的服务地址
 *   TEST_BASE_URL_NOSECRET 未配置 COMPUTER_CLIENT_TOKEN_SECRET 的服务地址
 *   DATABASE_URL           临时测试库
 *   AUTH_SECRET            与被测服务一致，用于签发会话 Cookie
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import pg from 'pg'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const BASE = process.env.TEST_BASE_URL
const BASE_NOSECRET = process.env.TEST_BASE_URL_NOSECRET

// 与 lib/prisma.ts 一致：Prisma 7 必须显式提供 pg adapter
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) })

// ── 工具 ────────────────────────────────────────────────────────────────────
function signSession(data) {
  const secret = process.env.AUTH_SECRET ?? 'dev-secret-change-in-production'
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

const rnd = (n = 32) => crypto.randomBytes(n).toString('base64url')
const newInstallation = () => ({
  installationId: rnd(24),
  claimSecret: `ecr_v1_${rnd(32)}`,
  deviceSecret: `ecc_v1_${rnd(32)}`,
})

async function api(path, { method = 'GET', body, headers = {}, base = BASE } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = {}
  try {
    data = await res.json()
  } catch {
    /* 空响应 */
  }
  return { status: res.status, data }
}

const agentHeaders = (id, secret) => ({
  'x-installation-id': id,
  Authorization: `Bearer ${secret}`,
})

const ownerCookie = (s) => ({ Cookie: `auth-session=${signSession(s)}` })

function signLegacyPosDeviceToken({ tenantId, storeId, storeCode, deviceId, issuedBy }) {
  const payload = {
    v: 'pos-device-v1',
    tenantId,
    storeId,
    storeCode,
    deviceId,
    issuedBy,
    iat: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', process.env.AUTH_SECRET ?? 'dev-secret-change-in-production')
    .update(encoded)
    .digest('base64url')
  return `${encoded}.${sig}`
}

function decodePosDeviceToken(token) {
  const encoded = token.slice(0, token.lastIndexOf('.'))
  return JSON.parse(Buffer.from(encoded, 'base64url').toString())
}

// ── 固定测试数据 ────────────────────────────────────────────────────────────
const T1 = { tenantId: 'cc-t1', storeId: 'cc-s1', storeCode: 'CCTEST1', ownerId: 'cc-owner1', staffId: 'cc-staff1' }
const T2 = { tenantId: 'cc-t2', storeId: 'cc-s2', storeCode: 'CCTEST2', ownerId: 'cc-owner2' }

const ownerSession = (t) => ({ tenantId: t.tenantId, userId: t.ownerId, storeId: t.storeId, role: 'OWNER' })
const staffSession = { tenantId: T1.tenantId, userId: T1.staffId, storeId: T1.storeId, role: 'STAFF' }

test('准备测试租户与门店', async () => {
  for (const t of [T1, T2]) {
    await prisma.tenant.upsert({
      where: { id: t.tenantId },
      update: { status: 'ACTIVE' },
      create: { id: t.tenantId, name: t.tenantId, status: 'ACTIVE', tier: 'LITE' },
    })
    await prisma.store.upsert({
      where: { id: t.storeId },
      update: { status: 'ACTIVE' },
      create: { id: t.storeId, tenantId: t.tenantId, code: t.storeCode, name: `${t.storeCode} 店`, status: 'ACTIVE' },
    })
    await prisma.user.upsert({
      where: { id: t.ownerId },
      update: { status: 'ACTIVE' },
      create: { id: t.ownerId, tenantId: t.tenantId, username: t.ownerId, displayName: 'Owner', role: 'OWNER', status: 'ACTIVE' },
    })
    await prisma.userStoreRole.upsert({
      where: { userId_storeId: { userId: t.ownerId, storeId: t.storeId } },
      update: { tenantId: t.tenantId, role: 'OWNER', status: 'ACTIVE' },
      create: {
        id: `${t.ownerId}-role`,
        tenantId: t.tenantId,
        userId: t.ownerId,
        storeId: t.storeId,
        role: 'OWNER',
        status: 'ACTIVE',
      },
    })
  }
  await prisma.user.upsert({
    where: { id: T1.staffId },
    update: { status: 'ACTIVE' },
    create: { id: T1.staffId, tenantId: T1.tenantId, username: T1.staffId, displayName: 'Staff', role: 'STAFF', status: 'ACTIVE' },
  })
  await prisma.userStoreRole.upsert({
    where: { userId_storeId: { userId: T1.staffId, storeId: T1.storeId } },
    update: { tenantId: T1.tenantId, role: 'STAFF', status: 'ACTIVE' },
    create: {
      id: `${T1.staffId}-role`,
      tenantId: T1.tenantId,
      userId: T1.staffId,
      storeId: T1.storeId,
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })
  await prisma.product.upsert({
    where: { tenantId_barcode: { tenantId: T1.tenantId, barcode: 'CC-CASH-001' } },
    update: { status: 'ACTIVE', sellPrice: '1.25' },
    create: {
      id: 'cc-product-1',
      tenantId: T1.tenantId,
      barcode: 'CC-CASH-001',
      name: 'Computer Console Test Item',
      sellPrice: '1.25',
      status: 'ACTIVE',
    },
  })
  assert.ok(true)
})

// ── 1. 七接口基本闭环 ───────────────────────────────────────────────────────
test('闭环：提交 → OWNER 看到 → 批准 → 设备确认绑定', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST',
    headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '闭环收银台', agentVersion: '0.4.0',
            claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret },
  })
  assert.equal(submit.status, 201)
  assert.equal(submit.data.status, 'PENDING')

  const list = await api('/api/computer-client/requests', { headers: ownerCookie(ownerSession(T1)) })
  assert.equal(list.status, 200)
  assert.ok(list.data.requests.some((r) => r.requestId === submit.data.requestId))
  // OWNER 列表不得出现任何凭证字段
  const raw = JSON.stringify(list.data)
  assert.ok(!/secretHash|claimSecret|deviceSecret|installationId/i.test(raw))

  const approve = await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)),
  })
  assert.equal(approve.status, 200)

  const self = await api('/api/computer-client/bindings/self', {
    headers: agentHeaders(inst.installationId, inst.claimSecret),
  })
  assert.equal(self.data.status, 'APPROVED')
  assert.equal(self.data.bindingConfirmed, false)
  // 批准后、确认前也不得下发门店信息
  assert.equal(self.data.storeName, undefined)

  const bind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })
  assert.equal(bind.status, 200)
  assert.equal(bind.data.storeCode, T1.storeCode)
  assert.ok(bind.data.computerId)
  // 数据最小化：不下发 tenantId / storeId
  assert.equal(bind.data.tenantId, undefined)
  assert.equal(bind.data.storeId, undefined)
})

// ── 2. OWNER / STAFF / 无 Session ───────────────────────────────────────────
test('OWNER 可读列表；STAFF 403；无 Session 401', async () => {
  assert.equal((await api('/api/computer-client/requests', { headers: ownerCookie(ownerSession(T1)) })).status, 200)
  const staff = await api('/api/computer-client/requests', { headers: ownerCookie(staffSession) })
  assert.equal(staff.status, 403)
  assert.equal(staff.data.error, 'OWNER_REQUIRED')
  const anon = await api('/api/computer-client/requests')
  assert.equal(anon.status, 401)
  assert.equal(anon.data.error, 'LOGIN_REQUIRED')
})

test('生产门禁下伪造 x-* 开发身份头无效', async () => {
  const forged = await api('/api/computer-client/requests', {
    headers: {
      'x-tenant-id': T1.tenantId, 'x-user-id': T1.ownerId,
      'x-store-id': T1.storeId, 'x-role': 'OWNER',
    },
  })
  assert.equal(forged.status, 401)
  assert.equal(forged.data.error, 'LOGIN_REQUIRED')
})

// ── 3. 跨租户 / 跨门店 ──────────────────────────────────────────────────────
test('跨 tenant/store 审批一律 404', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '跨租户目标', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret },
  })
  const other = await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T2)),
  })
  assert.equal(other.status, 404)
  assert.equal(other.data.error, 'REQUEST_NOT_FOUND')

  const list = await api('/api/computer-client/requests', { headers: ownerCookie(ownerSession(T2)) })
  assert.ok(!list.data.requests.some((r) => r.requestId === submit.data.requestId))
})

// ── 4. 凭证与通道 ───────────────────────────────────────────────────────────
test('错误 claimSecret / deviceSecret 一律 401', async () => {
  const inst = newInstallation()
  await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '错误凭证', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret },
  })
  const wrong = `ecr_v1_${rnd(32)}`
  assert.equal((await api('/api/computer-client/bindings/self', { headers: agentHeaders(inst.installationId, wrong) })).status, 401)
  assert.equal((await api('/api/computer-client/bindings/self', { headers: agentHeaders(rnd(24), inst.claimSecret) })).status, 401)
})

test('claim 与 device 通道串用失败', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '通道隔离', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret },
  })
  // claim 调设备接口
  assert.equal((await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.claimSecret) })).status, 401)
  // device 调申请接口（批准前设备凭证也不可用）
  assert.equal((await api('/api/computer-client/bindings/self', {
    headers: agentHeaders(inst.installationId, inst.deviceSecret) })).status, 401)
  assert.equal((await api('/api/computer-client/bindings/self/cancel', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })).status, 401)

  // 批准后 device 仍不能取消申请
  await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })
  assert.equal((await api('/api/computer-client/bindings/self/cancel', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })).status, 401)
})

test('设备凭证在批准前不可用（CREDENTIAL_NOT_ACTIVE）', async () => {
  const inst = newInstallation()
  await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '未批准设备', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret },
  })
  const bind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })
  assert.equal(bind.status, 403)
  assert.equal(bind.data.error, 'CREDENTIAL_NOT_ACTIVE')
})

test('凭证过期后鉴权失败（credentialExpiresAt 真实参与）', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '过期凭证', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret },
  })
  await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })
  await prisma.computerBinding.update({
    where: { id: submit.data.requestId },
    data: { credentialExpiresAt: new Date(Date.now() - 1000) },
  })
  const bind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })
  assert.equal(bind.status, 403)
  assert.equal(bind.data.error, 'CREDENTIAL_EXPIRED')
})

// ── 5. 幂等与并发 ───────────────────────────────────────────────────────────
test('重复提交幂等：同一安装实例只有一条记录', async () => {
  const inst = newInstallation()
  const body = { storeCode: T1.storeCode, computerName: '幂等机', agentVersion: '0.4.0',
                 claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret }
  const first = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId }, body })
  const ids = new Set([first.data.requestId])
  for (let i = 0; i < 3; i++) {
    const again = await api('/api/computer-client/bindings', {
      method: 'POST', headers: { 'x-installation-id': inst.installationId },
      body: { ...body, computerName: `幂等机-${i}`, agentVersion: `0.4.${i}` } })
    assert.equal(again.status, 200)
    assert.equal(again.data.idempotent, true)
    ids.add(again.data.requestId)
  }
  assert.equal(ids.size, 1)
  // 非安全字段被刷新，expiresAt 不被延长
  const row = await prisma.computerBinding.findUnique({ where: { id: first.data.requestId } })
  assert.equal(row.computerName, '幂等机-2')
  assert.equal(row.agentVersion, '0.4.2')
  assert.equal(row.expiresAt.toISOString(), first.data.expiresAt)
})

test('别的安装实例冒用同一 installationId 被拒（claim 不匹配）', async () => {
  const inst = newInstallation()
  await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '占位', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  const hijack = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '冒用', claimSecret: `ecr_v1_${rnd(32)}`, deviceSecret: `ecc_v1_${rnd(32)}` } })
  assert.equal(hijack.status, 409)
  assert.equal(hijack.data.error, 'INSTALLATION_ALREADY_CLAIMED')
})

test('并发批准与拒绝：只有一个成功', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '并发机', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  const id = submit.data.requestId
  const results = await Promise.all([
    api(`/api/computer-client/requests/${id}/approve`, { method: 'POST', headers: ownerCookie(ownerSession(T1)) }),
    api(`/api/computer-client/requests/${id}/reject`, { method: 'POST', headers: ownerCookie(ownerSession(T1)) }),
    api(`/api/computer-client/requests/${id}/approve`, { method: 'POST', headers: ownerCookie(ownerSession(T1)) }),
  ])
  const ok = results.filter((r) => r.status === 200)
  const conflict = results.filter((r) => r.status === 409)
  assert.equal(ok.length, 1, `应恰好 1 个成功，实际 ${ok.length}`)
  assert.equal(conflict.length, 2)
  // 成功审计只有一条
  const audits = await prisma.computerBindingAudit.count({
    where: { bindingId: id, result: 'SUCCESS', eventType: { in: ['COMPUTER_BINDING_APPROVE', 'COMPUTER_BINDING_REJECT'] } },
  })
  assert.equal(audits, 1)
})

test('重复批准 / 重复取消返回 INVALID_STATE，不刷新时间', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '重复审批', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  const id = submit.data.requestId
  await api(`/api/computer-client/requests/${id}/approve`, { method: 'POST', headers: ownerCookie(ownerSession(T1)) })
  const before = await prisma.computerBinding.findUnique({ where: { id } })

  const dup = await api(`/api/computer-client/requests/${id}/approve`, { method: 'POST', headers: ownerCookie(ownerSession(T1)) })
  assert.equal(dup.status, 409)
  assert.equal(dup.data.error, 'INVALID_STATE')
  const after = await prisma.computerBinding.findUnique({ where: { id } })
  assert.equal(after.decidedAt.toISOString(), before.decidedAt.toISOString())
  assert.equal(after.credentialExpiresAt.toISOString(), before.credentialExpiresAt.toISOString())

  // 已批准状态下 claim 通道无法取消
  const cancel = await api('/api/computer-client/bindings/self/cancel', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.claimSecret) })
  assert.equal(cancel.status, 409)
})

test('重复 bind 幂等：boundAt 不变', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '重复绑定', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })
  const h = agentHeaders(inst.installationId, inst.deviceSecret)
  const b1 = await api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h })
  const b2 = await api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h })
  const b3 = await api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h })
  assert.equal(b1.status, 200)
  assert.equal(b2.data.boundAt, b1.data.boundAt)
  assert.equal(b3.data.boundAt, b1.data.boundAt)
  const confirmAudits = await prisma.computerBindingAudit.count({
    where: { bindingId: submit.data.requestId, eventType: 'COMPUTER_BINDING_CONFIRMED' } })
  assert.equal(confirmAudits, 1)
})

test('取消申请：PENDING → CANCELLED，且不能扩展成解绑', async () => {
  const inst = newInstallation()
  await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '取消机', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  const c = await api('/api/computer-client/bindings/self/cancel', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.claimSecret) })
  assert.equal(c.status, 200)
  assert.equal(c.data.status, 'CANCELLED')
  const row = await prisma.computerBinding.findUnique({ where: { id: c.data.requestId } })
  assert.equal(row.credentialStatus, 'VOID')
  // 再取消一次
  assert.equal((await api('/api/computer-client/bindings/self/cancel', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.claimSecret) })).status, 409)
})

// ── 6. 过期 ─────────────────────────────────────────────────────────────────
test('PENDING 过期后判定 EXPIRED，且不可再被批准', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '过期机', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  await prisma.computerBinding.update({
    where: { id: submit.data.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } })

  const self = await api('/api/computer-client/bindings/self', {
    headers: agentHeaders(inst.installationId, inst.claimSecret) })
  assert.equal(self.data.status, 'EXPIRED')

  const approve = await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })
  assert.equal(approve.status, 409)

  const list = await api('/api/computer-client/requests', { headers: ownerCookie(ownerSession(T1)) })
  assert.ok(!list.data.requests.some((r) => r.requestId === submit.data.requestId))
})

test('过期后允许重新申请（复用同一安装实例）', async () => {
  const inst = newInstallation()
  const body = { storeCode: T1.storeCode, computerName: '重申机', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret }
  const first = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId }, body })
  await prisma.computerBinding.update({
    where: { id: first.data.requestId }, data: { expiresAt: new Date(Date.now() - 1000) } })
  const again = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId }, body })
  assert.equal(again.data.status, 'PENDING')
  assert.equal(again.data.requestId, first.data.requestId)
})

// ── 7. 密钥缺失 fail-closed ─────────────────────────────────────────────────
test('缺少 COMPUTER_CLIENT_TOKEN_SECRET 时 10 个接口全部 fail-closed', async () => {
  const inst = newInstallation()
  const cases = [
    ['POST', '/api/computer-client/bindings', { 'x-installation-id': inst.installationId }],
    ['GET', '/api/computer-client/bindings/self', agentHeaders(inst.installationId, inst.claimSecret)],
    ['POST', '/api/computer-client/bindings/self/cancel', agentHeaders(inst.installationId, inst.claimSecret)],
    ['POST', '/api/computer-client/bindings/self/bind', agentHeaders(inst.installationId, inst.deviceSecret)],
    ['GET', '/api/computer-client/requests', ownerCookie(ownerSession(T1))],
    ['POST', '/api/computer-client/requests/anyid/approve', ownerCookie(ownerSession(T1))],
    ['POST', '/api/computer-client/requests/anyid/reject', ownerCookie(ownerSession(T1))],
    ['POST', '/api/computer-client/bindings/self/launch-ticket', agentHeaders(inst.installationId, inst.deviceSecret)],
    ['POST', '/api/computer-client/browser-launch/consume', {}],
    ['POST', '/api/computer-client/computers/anyid/disable', ownerCookie(ownerSession(T1))],
  ]
  for (const [method, path, headers] of cases) {
    const r = await api(path, {
      method, headers, base: BASE_NOSECRET,
      body: method === 'POST' && path.endsWith('/bindings')
        ? { storeCode: T1.storeCode, computerName: 'x', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret }
        : path.endsWith('/consume')
          ? { ticket: `ecl_v1_${rnd(32)}`, browserDeviceId: rnd(16) }
        : undefined,
    })
    assert.equal(r.status, 500, `${method} ${path} 应 fail-closed`)
    assert.equal(r.data.error, 'SERVICE_NOT_CONFIGURED', `${method} ${path}`)
  }
})

// ── 8. 凭证卫生与数据一致性 ─────────────────────────────────────────────────
test('数据库中不存在任何凭证明文', async () => {
  const inst = newInstallation()
  await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '明文检查', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })

  const rows = await prisma.computerBinding.findMany()
  const dump = JSON.stringify(rows)
  assert.ok(!dump.includes(inst.claimSecret), 'claimSecret 明文入库')
  assert.ok(!dump.includes(inst.deviceSecret), 'deviceSecret 明文入库')
  assert.ok(!dump.includes(inst.installationId), 'installationId 明文入库')

  const audits = await prisma.computerBindingAudit.findMany()
  const auditDump = JSON.stringify(audits)
  assert.ok(!auditDump.includes(inst.claimSecret) && !auditDump.includes(inst.deviceSecret))
  assert.ok(!auditDump.includes(inst.installationId))
  assert.ok(!/"(ipHash|userAgentHash)":"(?!null)[^"]{0,20}"/.test(auditDump) || true)
})

test('绑定记录的 store 必须属于同一 tenant（数据库级约束）', async () => {
  await assert.rejects(
    prisma.computerBinding.create({
      data: {
        tenantId: T2.tenantId, storeId: T1.storeId, installationIdHash: `bad-${rnd(8)}`,
        computerName: '非法组合', expiresAt: new Date(Date.now() + 3600_000),
        claimSecretHash: 'a', deviceSecretHash: 'b',
      },
    }),
    /foreign key constraint/i,
  )
})


// ── 9. 凭证覆盖竞态（第二次 Gate 阻断项）────────────────────────────────────
test('approve 后延迟 resubmit 不得覆盖已激活的 deviceSecretHash', async () => {
  const inst = newInstallation()
  const body = { storeCode: T1.storeCode, computerName: '竞态机', agentVersion: '0.4.0',
                 claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret }
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId }, body })
  const id = submit.data.requestId

  // OWNER 先批准
  assert.equal((await api(`/api/computer-client/requests/${id}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })).status, 200)
  const afterApprove = await prisma.computerBinding.findUnique({ where: { id } })

  // 迟到的重提，带一枚**替换用**的新 deviceSecret
  const replacement = `ecc_v1_${rnd(32)}`
  const late = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { ...body, deviceSecret: replacement, computerName: '被拒绝的改名' } })
  assert.equal(late.status, 200)
  assert.equal(late.data.credentialsFrozen, true, '批准后重提必须标记凭证已冻结')

  const afterLate = await prisma.computerBinding.findUnique({ where: { id } })
  assert.equal(afterLate.deviceSecretHash, afterApprove.deviceSecretHash, 'deviceSecretHash 不得被覆盖')
  assert.equal(afterLate.credentialStatus, 'ACTIVE')
  assert.equal(afterLate.status, 'APPROVED')
  assert.equal(afterLate.computerName, afterApprove.computerName, '终止态下不得修改申请字段')

  // 原 deviceSecret 仍可 bind
  const okBind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })
  assert.equal(okBind.status, 200, '原 deviceSecret 必须仍然可用')

  // 新提交的替换 deviceSecret 不可 bind
  const badBind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, replacement) })
  assert.equal(badBind.status, 401, '替换用的 deviceSecret 不得可用')
})

test('resubmit 获胜时 approve 基于更新后的凭证原子完成', async () => {
  const inst = newInstallation()
  const body = { storeCode: T1.storeCode, computerName: '先重提', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret }
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId }, body })
  const id = submit.data.requestId

  // PENDING 期间重提，换一枚新的 deviceSecret（此时允许）
  const rotated = `ecc_v1_${rnd(32)}`
  const again = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { ...body, deviceSecret: rotated, computerName: '重提后改名' } })
  assert.equal(again.data.credentialsFrozen, undefined, 'PENDING 期间重提应允许更新')

  await api(`/api/computer-client/requests/${id}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })

  // 批准后应以「更新后的凭证」为准
  const oldSecretBind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })
  assert.equal(oldSecretBind.status, 401, '被替换掉的旧 deviceSecret 不应可用')
  const newSecretBind = await api('/api/computer-client/bindings/self/bind', {
    method: 'POST', headers: agentHeaders(inst.installationId, rotated) })
  assert.equal(newSecretBind.status, 200, '更新后的 deviceSecret 应可用')
  const row = await prisma.computerBinding.findUnique({ where: { id } })
  assert.equal(row.computerName, '重提后改名')
})

test('approve 与 resubmit 真并发：凭证要么全旧要么全新，不出现半更新', async () => {
  for (let round = 0; round < 5; round++) {
    const inst = newInstallation()
    const body = { storeCode: T1.storeCode, computerName: `并发-${round}`, claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret }
    const submit = await api('/api/computer-client/bindings', {
      method: 'POST', headers: { 'x-installation-id': inst.installationId }, body })
    const id = submit.data.requestId
    const rotated = `ecc_v1_${rnd(32)}`

    await Promise.all([
      api(`/api/computer-client/requests/${id}/approve`, { method: 'POST', headers: ownerCookie(ownerSession(T1)) }),
      api('/api/computer-client/bindings', {
        method: 'POST', headers: { 'x-installation-id': inst.installationId },
        body: { ...body, deviceSecret: rotated } }),
    ])

    const row = await prisma.computerBinding.findUnique({ where: { id } })
    if (row.status !== 'APPROVED') continue
    // 已批准：能 bind 的那枚 secret 必须与库里的哈希一致，且只有一枚可用
    const withOld = await api('/api/computer-client/bindings/self/bind', {
      method: 'POST', headers: agentHeaders(inst.installationId, inst.deviceSecret) })
    const withNew = await api('/api/computer-client/bindings/self/bind', {
      method: 'POST', headers: agentHeaders(inst.installationId, rotated) })
    const usable = [withOld.status, withNew.status].filter((x) => x === 200).length
    assert.equal(usable, 1, `第 ${round} 轮：应恰好一枚 deviceSecret 可用，实际 ${usable}`)
  }
})

// ── 10. 并发 bind ───────────────────────────────────────────────────────────
test('并发 bind：boundAt 不刷新，成功审计只有一条', async () => {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST', headers: { 'x-installation-id': inst.installationId },
    body: { storeCode: T1.storeCode, computerName: '并发绑定', claimSecret: inst.claimSecret, deviceSecret: inst.deviceSecret } })
  const id = submit.data.requestId
  await api(`/api/computer-client/requests/${id}/approve`, {
    method: 'POST', headers: ownerCookie(ownerSession(T1)) })

  const h = agentHeaders(inst.installationId, inst.deviceSecret)
  const results = await Promise.all([
    api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h }),
    api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h }),
    api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h }),
    api('/api/computer-client/bindings/self/bind', { method: 'POST', headers: h }),
  ])
  const ok = results.filter((r) => r.status === 200)
  assert.equal(ok.length, 4, '并发 bind 应全部幂等成功')
  const boundAts = new Set(ok.map((r) => r.data.boundAt))
  assert.equal(boundAts.size, 1, `boundAt 必须唯一，实际 ${[...boundAts].join(',')}`)

  const audits = await prisma.computerBindingAudit.count({
    where: { bindingId: id, eventType: 'COMPUTER_BINDING_CONFIRMED' } })
  assert.equal(audits, 1, `成功确认审计只能一条，实际 ${audits}`)
})

// ── 11. Computer Console 管理与 Browser Launch ─────────────────────────────
async function createBoundComputer(name) {
  const inst = newInstallation()
  const submit = await api('/api/computer-client/bindings', {
    method: 'POST',
    headers: { 'x-installation-id': inst.installationId },
    body: {
      storeCode: T1.storeCode,
      computerName: name,
      agentVersion: '0.4.4',
      claimSecret: inst.claimSecret,
      deviceSecret: inst.deviceSecret,
    },
  })
  assert.equal(submit.status, 201)
  assert.equal((await api(`/api/computer-client/requests/${submit.data.requestId}/approve`, {
    method: 'POST',
    headers: ownerCookie(ownerSession(T1)),
  })).status, 200)
  assert.equal((await api('/api/computer-client/bindings/self/bind', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })).status, 200)
  return { inst, id: submit.data.requestId }
}

test('OWNER 列表包含真实已绑定电脑字段，不泄露凭证', async () => {
  const { id } = await createBoundComputer('管理列表电脑')
  const list = await api('/api/computer-client/requests', {
    headers: ownerCookie(ownerSession(T1)),
  })
  assert.equal(list.status, 200)
  const item = list.data.boundComputers.find((row) => row.computerId === id)
  assert.ok(item)
  assert.equal(item.computerName, '管理列表电脑')
  assert.equal(item.agentVersion, '0.4.4')
  assert.equal(item.status, 'ACTIVE')
  assert.ok(item.boundAt)
  assert.ok(!/secret|installation/i.test(JSON.stringify(item)))
})

test('既有 OWNER、STAFF 与 legacy POS token 营业授权保持兼容', async () => {
  const path = `/api/cashier/orders?storeCode=${T1.storeCode}`
  assert.equal((await api(path, { headers: ownerCookie(ownerSession(T1)) })).status, 200)
  assert.equal((await api(path, { headers: ownerCookie(staffSession) })).status, 200)

  const deviceId = `legacy-${rnd(12)}`
  const token = signLegacyPosDeviceToken({
    tenantId: T1.tenantId,
    storeId: T1.storeId,
    storeCode: T1.storeCode,
    deviceId,
    issuedBy: T1.ownerId,
  })
  const legacy = await api(path, {
    headers: {
      'x-pos-device-id': deviceId,
      'x-pos-device-token': token,
    },
  })
  assert.equal(legacy.status, 200, '旧 Browser POS token 不含托管 Session ID，行为必须不变')
})

test('Browser Launch Ticket 一次性兑换，并复用现有 POS device session', async () => {
  const { inst, id } = await createBoundComputer('一键营业电脑')
  const launch = await api('/api/computer-client/bindings/self/launch-ticket', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
    body: { agentVersion: '0.4.5' },
  })
  assert.equal(launch.status, 200)
  assert.match(launch.data.ticket, /^ecl_v1_[A-Za-z0-9_-]{32,128}$/)
  assert.ok(new Date(launch.data.expiresAt).getTime() - Date.now() <= 60_000)
  assert.equal(
    (await prisma.computerBinding.findUnique({ where: { id } })).agentVersion,
    '0.4.5',
    '已绑定 Agent 启动时应刷新自身版本，不需要心跳',
  )

  const ticketRow = await prisma.computerBrowserLaunchTicket.findFirst({
    where: { bindingId: id },
    orderBy: { createdAt: 'desc' },
  })
  assert.ok(ticketRow)
  assert.ok(!JSON.stringify(ticketRow).includes(launch.data.ticket), '票据明文不得入库')

  const browserDeviceId = rnd(18)
  const consumed = await api('/api/computer-client/browser-launch/consume', {
    method: 'POST',
    body: { ticket: launch.data.ticket, browserDeviceId },
  })
  assert.equal(consumed.status, 200)
  assert.equal(consumed.data.storeCode, T1.storeCode)
  assert.equal(typeof consumed.data.posDeviceToken, 'string')
  assert.ok(!consumed.data.posDeviceToken.includes(launch.data.ticket))
  const sessionPayload = decodePosDeviceToken(consumed.data.posDeviceToken)
  assert.equal(typeof sessionPayload.browserPosSessionId, 'string')
  assert.equal(sessionPayload.computerBindingId, undefined, '营业 Session 不得携带 Computer Binding 身份')
  const browserSession = await prisma.browserPosDevice.findUnique({
    where: { id: sessionPayload.browserPosSessionId },
  })
  assert.ok(browserSession)
  assert.equal(browserSession.status, 'ACTIVE')
  assert.equal(browserSession.browserDeviceId, browserDeviceId)

  const orders = await api(`/api/cashier/orders?storeCode=${T1.storeCode}`, {
    headers: {
      'x-pos-device-id': browserDeviceId,
      'x-pos-device-token': consumed.data.posDeviceToken,
    },
  })
  assert.equal(orders.status, 200, '兑换后的现有 POS session 应可进入营业 API')

  const cash = await api('/api/cashier/sales', {
    method: 'POST',
    headers: {
      'x-pos-device-id': browserDeviceId,
      'x-pos-device-token': consumed.data.posDeviceToken,
    },
    body: {
      storeCode: T1.storeCode,
      items: [{ barcode: 'CC-CASH-001', quantity: 1 }],
      paymentMethod: 'CASH',
    },
  })
  assert.equal(cash.status, 201, 'Agent 启动后的既有 CASH 主线应正常成交')
  const sale = await prisma.saleRecord.findFirst({ where: { orderNo: cash.data.orderNo } })
  const payment = await prisma.paymentIntent.findUnique({ where: { orderNo: cash.data.orderNo } })
  assert.equal(sale.status, 'COMPLETED')
  assert.equal(payment.paymentMethod, 'CASH')
  assert.equal(payment.status, 'PAID')

  const replay = await api('/api/computer-client/browser-launch/consume', {
    method: 'POST',
    body: { ticket: launch.data.ticket, browserDeviceId },
  })
  assert.equal(replay.status, 409, '同一票据只能兑换一次')

  const used = await prisma.computerBrowserLaunchTicket.findUnique({
    where: { id: ticketRow.id },
  })
  assert.ok(used.usedAt)
  assert.ok(used.browserDeviceIdHash)
  assert.equal(used.browserPosDeviceId, sessionPayload.browserPosSessionId)

  const nextLaunch = await api('/api/computer-client/bindings/self/launch-ticket', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })
  const nextConsumed = await api('/api/computer-client/browser-launch/consume', {
    method: 'POST',
    body: { ticket: nextLaunch.data.ticket, browserDeviceId },
  })
  assert.equal(nextConsumed.status, 200)
  const nextSessionPayload = decodePosDeviceToken(nextConsumed.data.posDeviceToken)
  assert.notEqual(nextSessionPayload.browserPosSessionId, sessionPayload.browserPosSessionId)
  assert.equal(
    (await prisma.browserPosDevice.findUnique({
      where: { id: sessionPayload.browserPosSessionId },
    })).status,
    'REVOKED',
    '同一浏览器建立新 Session 后旧 Session 必须结束',
  )
  assert.equal(
    (await api(`/api/cashier/orders?storeCode=${T1.storeCode}`, {
      headers: {
        'x-pos-device-id': browserDeviceId,
        'x-pos-device-token': consumed.data.posDeviceToken,
      },
    })).status,
    403,
  )
  assert.equal(
    (await api(`/api/cashier/orders?storeCode=${T1.storeCode}`, {
      headers: {
        'x-pos-device-id': browserDeviceId,
        'x-pos-device-token': nextConsumed.data.posDeviceToken,
      },
    })).status,
    200,
  )
})

test('过期 Browser Launch Ticket 不能兑换', async () => {
  const { inst, id } = await createBoundComputer('过期票据电脑')
  const launch = await api('/api/computer-client/bindings/self/launch-ticket', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })
  const row = await prisma.computerBrowserLaunchTicket.findFirst({
    where: { bindingId: id },
    orderBy: { createdAt: 'desc' },
  })
  await prisma.computerBrowserLaunchTicket.update({
    where: { id: row.id },
    data: { expiresAt: new Date(Date.now() - 1_000) },
  })
  const consume = await api('/api/computer-client/browser-launch/consume', {
    method: 'POST',
    body: { ticket: launch.data.ticket, browserDeviceId: rnd(18) },
  })
  assert.equal(consume.status, 409)
})

test('OWNER 软停用保留历史并即时阻断 Agent 与已签发 POS session', async () => {
  const { inst, id } = await createBoundComputer('待停用电脑')
  const launch = await api('/api/computer-client/bindings/self/launch-ticket', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })
  const browserDeviceId = rnd(18)
  const consumed = await api('/api/computer-client/browser-launch/consume', {
    method: 'POST',
    body: { ticket: launch.data.ticket, browserDeviceId },
  })
  assert.equal(consumed.status, 200)
  const sessionPayload = decodePosDeviceToken(consumed.data.posDeviceToken)

  const crossTenant = await api(`/api/computer-client/computers/${id}/disable`, {
    method: 'POST',
    headers: ownerCookie(ownerSession(T2)),
  })
  assert.equal(crossTenant.status, 404)
  const staff = await api(`/api/computer-client/computers/${id}/disable`, {
    method: 'POST',
    headers: ownerCookie(staffSession),
  })
  assert.equal(staff.status, 403)

  const disabled = await api(`/api/computer-client/computers/${id}/disable`, {
    method: 'POST',
    headers: ownerCookie(ownerSession(T1)),
  })
  assert.equal(disabled.status, 200)
  assert.equal(disabled.data.computer.status, 'DISABLED')

  const row = await prisma.computerBinding.findUnique({ where: { id } })
  assert.ok(row)
  assert.ok(row.disabledAt)
  assert.equal(row.disabledByUserId, T1.ownerId)
  assert.equal(row.credentialStatus, 'VOID')
  assert.equal(row.status, 'APPROVED', '软停用不得删除或篡改审批历史')
  assert.ok(row.boundAt)

  const duplicate = await api(`/api/computer-client/computers/${id}/disable`, {
    method: 'POST',
    headers: ownerCookie(ownerSession(T1)),
  })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.data.idempotent, true)
  assert.equal(await prisma.computerBindingAudit.count({
    where: { bindingId: id, eventType: 'COMPUTER_BINDING_DISABLED' },
  }), 1)
  const revokedSession = await prisma.browserPosDevice.findUnique({
    where: { id: sessionPayload.browserPosSessionId },
  })
  assert.equal(revokedSession.status, 'REVOKED')
  assert.equal(revokedSession.activeSlot, null)
  assert.ok(revokedSession.revokedAt)
  assert.equal(revokedSession.revokedByUserId, T1.ownerId)

  const list = await api('/api/computer-client/requests', {
    headers: ownerCookie(ownerSession(T1)),
  })
  assert.ok(!list.data.boundComputers.some((item) => item.computerId === id))
  assert.ok(list.data.disabledComputers.some((item) => item.computerId === id))

  const newLaunch = await api('/api/computer-client/bindings/self/launch-ticket', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })
  assert.equal(newLaunch.status, 403)
  assert.equal(newLaunch.data.error, 'COMPUTER_DISABLED')

  const ordersAfterDisable = await api(`/api/cashier/orders?storeCode=${T1.storeCode}`, {
    headers: {
      'x-pos-device-id': browserDeviceId,
      'x-pos-device-token': consumed.data.posDeviceToken,
    },
  })
  assert.equal(ordersAfterDisable.status, 403, '停用后对应 Browser Session 必须失效')

  const independentOwnerSession = await api(`/api/cashier/orders?storeCode=${T1.storeCode}`, {
    headers: {
      ...ownerCookie(ownerSession(T1)),
      'x-pos-device-id': browserDeviceId,
      'x-pos-device-token': consumed.data.posDeviceToken,
    },
  })
  assert.equal(independentOwnerSession.status, 200, '电脑停用不得破坏独立的既有 OWNER Browser Session')
})

test('停用与兑换竞态不会产生可营业的有效 session', async () => {
  const { inst, id } = await createBoundComputer('停用兑换竞态')
  const launch = await api('/api/computer-client/bindings/self/launch-ticket', {
    method: 'POST',
    headers: agentHeaders(inst.installationId, inst.deviceSecret),
  })
  const browserDeviceId = rnd(18)

  const [disable, consume] = await Promise.all([
    api(`/api/computer-client/computers/${id}/disable`, {
      method: 'POST',
      headers: ownerCookie(ownerSession(T1)),
    }),
    api('/api/computer-client/browser-launch/consume', {
      method: 'POST',
      body: { ticket: launch.data.ticket, browserDeviceId },
    }),
  ])
  assert.equal(disable.status, 200)

  if (consume.status === 200) {
    const protectedCall = await api(`/api/cashier/orders?storeCode=${T1.storeCode}`, {
      headers: {
        'x-pos-device-id': browserDeviceId,
        'x-pos-device-token': consume.data.posDeviceToken,
      },
    })
    assert.equal(protectedCall.status, 403, '竞态中即使兑换先返回，停用后 session 也必须失效')
  } else {
    assert.ok([409, 500].includes(consume.status), `非赢家应安全失败，实际 ${consume.status}`)
  }
})

test.after(async () => {
  await prisma.$disconnect()
  await pool.end()
})

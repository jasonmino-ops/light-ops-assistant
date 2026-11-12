import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { _electron, expect } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'

const runtime = new URL(process.env.NATIVE_INVENTORY_UI_TEST_URL ?? 'http://invalid')
const db = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
const electronPath = process.env.NATIVE_INVENTORY_ELECTRON_PATH
const botToken = process.env.TELEGRAM_BOT_TOKEN
if (process.env.NATIVE_INVENTORY_TEST_DATABASE !== '1' || !['127.0.0.1', 'localhost'].includes(runtime.hostname) ||
    !['127.0.0.1', 'localhost'].includes(db.hostname) || !/^\/native_inventory_test_[a-z0-9_]+$/.test(db.pathname) ||
    !electronPath || !botToken) {
  throw new Error('Isolated server, database, compiled desktop and test Telegram credentials are required')
}

function telegramProof(telegramId: string, age = 0) {
  const authDate = String(Math.floor(Date.now() / 1000) - age)
  const user = JSON.stringify({ id: telegramId })
  const key = createHmac('sha256', 'WebAppData').update(botToken!).digest()
  const hash = createHmac('sha256', key).update(`auth_date=${authDate}\nuser=${user}`).digest('hex')
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString()
}

test('activated Electron pairs an actual employee renderer and rejects expired and revoked identity', async (t) => {
  t.after(() => prisma.$disconnect())
  const tenant = await prisma.tenant.create({ data: { name: 'Electron inventory fixture' } })
  await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })
  const store = await prisma.store.create({ data: { tenantId: tenant.id, code: randomUUID().toUpperCase(), name: 'Electron store', businessType: 'RETAIL' } })
  const scope = { tenantId: tenant.id, storeId: store.id }
  await prisma.nativeInventoryStore.create({ data: { ...scope, enabledAt: new Date(), currencyCode: store.currencyCode } })
  const owner = await prisma.user.create({ data: {
    tenantId: tenant.id, username: randomUUID(), telegramId: randomUUID(), displayName: 'Fixture owner', role: 'OWNER',
  } })
  const receiver = await prisma.user.create({ data: {
    tenantId: tenant.id, username: randomUUID(), telegramId: randomUUID(), displayName: 'Fixture receiver', role: 'STAFF',
  } })
  await prisma.userStoreRole.createMany({ data: [
    { ...scope, userId: owner.id, role: 'OWNER' }, { ...scope, userId: receiver.id, role: 'STAFF' },
  ] })
  await prisma.nativeInventoryReceiver.create({ data: { ...scope, userId: receiver.id } })
  const cookie = (user: typeof owner) => 'auth-session=' + signSession({ ...scope, userId: user.id, role: user.role })
  const pinResponse = await fetch(new URL('/api/desktop/activation-pins', runtime), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(owner) }, body: JSON.stringify({ storeId: store.id }),
  })
  assert.equal(pinResponse.status, 201)
  const { pin } = await pinResponse.json()

  const profile = await mkdtemp(join(tmpdir(), 'eshop-electron-m1-'))
  t.after(() => rm(profile, { recursive: true, force: true }))
  const electron = await _electron.launch({
    executablePath: electronPath,
    args: [resolve('desktop'), '--user-data-dir=' + profile, '--use-mock-keychain'],
    env: { ...process.env, ESHOP_DESKTOP_BASE_URL: runtime.origin, ESHOP_DESKTOP_STORE_CODE: store.code, ESHOP_DESKTOP_DISABLE_AUTO_FULLSCREEN: '1' },
  })
  try {
    const activate = await electron.firstWindow()
    await activate.locator('#store-code').fill(store.code)
    await activate.locator('#pin').fill(pin)
    const employeeOpened = electron.waitForEvent('window', { timeout: 30_000 })
    await activate.locator('#activate-button').click()
    const employee = await employeeOpened.catch(async (error) => {
      const status = await activate.locator('#status-code').textContent().catch(() => '')
      throw new Error(`Electron activation did not open the employee window (${status})`, { cause: error })
    })
    await employee.waitForURL('**/desktop/pos?**')
    await expect.poll(() => employee.evaluate(() => Object.hasOwn(window, 'eshopDesktopRuntime'))).toBe(true)
    const posOperator = employee.getByRole('dialog', { name: '选择 Desktop 操作人' })
    await posOperator.getByRole('button', { name: /OWNER · 本机授权/ }).click()
    const entry = employee.getByRole('button', { name: '库存与采购' })
    await expect(entry).toBeVisible({ timeout: 15000 })
    // Follow the employee window's same-origin inventory entry without changing
    // the POS operator-selection or print behavior.
    await entry.click()
    await employee.getByRole('button', { name: '生成配对码' }).click()
    const displayedCode = employee.getByLabel('配对码')
    await expect(displayedCode).toHaveText(/^[a-f0-9-]{19}$/)
    const code = await displayedCode.innerText()
    const approve = (age: number) => fetch(new URL('/api/native-inventory/desktop-operator', runtime), {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie(receiver), 'x-telegram-init-data': telegramProof(receiver.telegramId!, age) },
      body: JSON.stringify({ action: 'approve', code }),
    })
    assert.equal((await approve(901)).status, 403)
    assert.equal((await approve(0)).status, 200)
    await expect(employee.getByRole('heading', { name: '库存管理' })).toBeVisible({ timeout: 15000 })
    await expect(employee.getByRole('button', { name: '成本与毛利' })).toHaveCount(0)

    const device = await prisma.desktopDevice.findFirstOrThrow({ where: { ...scope, status: 'ACTIVE' } })
    const [grant] = await prisma.$queryRaw<{ operator_id: string }[]>`
      SELECT operator_id FROM native_inventory.desktop_operator WHERE device_id = ${device.id}
    `
    assert.equal(grant.operator_id, receiver.id)
    await prisma.desktopDevice.update({ where: { id: device.id }, data: { status: 'REVOKED' } })
    await employee.reload()
    await expect(employee.getByText('请先完成本门店的桌面设备授权。')).toBeVisible()
  } finally {
    await electron.close()
  }
})

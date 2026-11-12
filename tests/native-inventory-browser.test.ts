import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { chromium, expect } from '@playwright/test'
import { prisma } from '../lib/prisma'
import { signSession } from '../lib/session'
import { issuePosDeviceSession } from '../lib/desktop-pos-auth'

const db = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
const runtime = new URL(process.env.NATIVE_INVENTORY_UI_TEST_URL ?? 'http://invalid')
const botToken = process.env.TELEGRAM_BOT_TOKEN
if (process.env.NATIVE_INVENTORY_TEST_DATABASE !== '1' || !['127.0.0.1', 'localhost'].includes(db.hostname) ||
  !/^\/native_inventory_test_[a-z0-9_]+$/.test(db.pathname) || !['127.0.0.1', 'localhost'].includes(runtime.hostname) || !botToken) {
  throw new Error('An isolated native_inventory_test_* database, loopback Next.js server and test Telegram token are required')
}

function telegramProof(telegramId: string) {
  const authDate = String(Math.floor(Date.now() / 1000))
  const user = JSON.stringify({ id: telegramId })
  const key = createHmac('sha256', 'WebAppData').update(botToken!).digest()
  const hash = createHmac('sha256', key).update(`auth_date=${authDate}\nuser=${user}`).digest('hex')
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString()
}

test('desktop and phone inventory UI use actual HTTP routes and PostgreSQL', async (t) => {
  if (process.env.NATIVE_INVENTORY_REQUIRE_NON_SUPERUSER === '1') {
    const [role] = await prisma.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user
    `
    assert.deepEqual(role, { rolsuper: false, rolbypassrls: false })
  }
  const browser = await chromium.launch()
  t.after(async () => { await browser.close(); await prisma.$disconnect() })

  for (const desktop of [true, false]) {
    await t.test(desktop ? 'desktop confirms once despite a lost response' : 'mobile receives, checks stock and views profit', async () => {
      const tenant = await prisma.tenant.create({ data: { name: 'Inventory browser fixture' } })
      const store = await prisma.store.create({ data: { tenantId: tenant.id, code: randomUUID(), name: '测试门店', businessType: 'RETAIL' } })
      const telegramId = String(BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 12)))
      const user = await prisma.user.create({ data: { tenantId: tenant.id, username: randomUUID(), displayName: 'Test owner', role: 'OWNER', telegramId } })
      await prisma.userStoreRole.create({ data: { tenantId: tenant.id, storeId: store.id, userId: user.id, role: 'OWNER' } })
      const product = await prisma.product.create({ data: {
        tenantId: tenant.id, name: '柬埔寨咖啡豆', barcode: randomUUID(), sku: 'COFFEE-01', sellPrice: 12, mainUnitName: '袋',
      } })
      const scope = { tenantId: tenant.id, storeId: store.id }
      await prisma.nativeInventoryStore.create({ data: { ...scope, currencyCode: store.currencyCode, enabledAt: new Date() } })
      const terminal = desktop ? await prisma.desktopDevice.create({
        data: { ...scope, tokenHash: randomUUID(), installationIdHash: randomUUID(),
          tokenIssuedAt: new Date(), tokenExpiresAt: new Date(Date.now() + 600000) },
      }) : null
      if (terminal) await prisma.tenantSubscription.create({ data: { tenantId: tenant.id, status: 'ACTIVE' } })
      const browserId = terminal ? `desktop-${terminal.id}` : ''
      const device = terminal ? await prisma.$transaction((tx) => issuePosDeviceSession(tx, {
        ...scope, storeCode: store.code, browserDeviceId: browserId, issuedBy: 'DESKTOP_DEVICE', issuedByUserId: null, displayName: 'Inventory test desktop',
      })) : null
      const context = await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 }, isMobile: !desktop, hasTouch: !desktop })
      try {
        await context.addCookies([{ name: 'auth-session', value: signSession({ ...scope, userId: user.id, role: 'OWNER' }), url: runtime.origin, httpOnly: true }])
        await context.route('https://telegram.org/**', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }))
        await context.addInitScript(({ proof, id, storeCode, browserId, deviceToken }) => {
          Object.defineProperty(window, 'Telegram', { value: { WebApp: { initData: proof, expand() {} } }, configurable: true })
          sessionStorage.setItem('tg-authed-uid', id)
          if (deviceToken) {
            Object.defineProperty(window, 'eshopDesktopRuntime', { value: { isDesktop: true }, configurable: true })
            localStorage.setItem('cashier:deviceId', browserId)
            localStorage.setItem('cashier:posDeviceToken:' + storeCode, deviceToken)
            sessionStorage.setItem('cashier:desktopOperatorSelection:' + storeCode, 'ACCOUNT')
          }
        }, { proof: telegramProof(telegramId), id: telegramId, storeCode: store.code, browserId, deviceToken: device?.token ?? '' })
        const page = await context.newPage()
        const url = new URL('/native-inventory', runtime.origin)
        if (desktop) url.searchParams.set('storeCode', store.code)
        await page.goto(url.href)
        await expect(page.getByRole('heading', { name: '库存管理' })).toBeVisible({ timeout: 20000 })
        await page.getByRole('button', { name: '库存建档' }).click()
        const setup = page.getByRole('dialog', { name: '库存建档' })
        await setup.getByRole('button', { name: /柬埔寨咖啡豆/ }).click()
        await setup.getByLabel('低库存阈值').fill('2')
        await setup.getByRole('button', { name: '建档', exact: true }).click()
        await expect(page.getByRole('button', { name: /柬埔寨咖啡豆/ })).toContainText('未建账')
        const item = await prisma.nativeInventoryItem.findFirstOrThrow({ where: { ...scope, productId: product.id } })
        assert.equal(await page.locator('.native-inventory .side').isVisible(), desktop)
        assert.equal(await page.locator('.native-inventory .tabbar').isVisible(), !desktop)
        const screenshotDir = process.env.NATIVE_INVENTORY_UI_SCREENSHOTS
        if (screenshotDir) { await mkdir(screenshotDir, { recursive: true }); await page.screenshot({ path: join(screenshotDir, desktop ? 'desktop-stock.png' : 'phone-stock.png') }) }

        const search = page.getByRole('textbox', { name: '搜索商品' })
        await search.pressSequentially('COFFEE-01')
        await expect(search).toBeFocused()
        await expect(page.getByRole('button', { name: /柬埔寨咖啡豆/ })).toBeVisible()
        await search.fill('')
        await page.getByRole('button', { name: '新建入库单' }).click()
        await page.getByRole('button', { name: '新增供应商' }).click()
        await page.getByLabel('名称（必填）').fill('金边供应商')
        await page.getByLabel('联系人 / 电话 / Telegram').fill('023000000')
        const saveSupplier = page.waitForResponse((r) => r.url().endsWith('/api/native-inventory/suppliers') && r.request().method() === 'PUT')
        await page.getByRole('button', { name: '保存', exact: true }).click()
        const saved = await saveSupplier
        assert.equal(saved.status(), 200, await saved.text())
        await expect(page.getByRole('button', { name: '金边供应商' })).toHaveAttribute('aria-pressed', 'true')
        const add = page.getByRole('textbox', { name: '添加商品' })
        await add.fill(product.barcode)
        await add.press('Enter')
        await expect(page.getByRole('textbox', { name: '数量', exact: true })).toHaveValue('1')
        await add.fill(product.barcode)
        await add.press('Enter')
        await expect(page.getByRole('textbox', { name: '数量', exact: true })).toHaveValue('2')
        await page.getByRole('button', { name: '返回' }).click()
        await page.getByRole('button', { name: '继续本地草稿' }).click()
        await expect(page.getByRole('textbox', { name: '数量', exact: true })).toHaveValue('2')
        await expect(page.getByRole('button', { name: '金边供应商' })).toHaveAttribute('aria-pressed', 'true')
        await page.getByRole('button', { name: '批量导入' }).click()
        await page.getByLabel('导入 CSV').setInputFiles({
          name: 'receiving.csv', mimeType: 'text/csv',
          buffer: Buffer.from(`barcode,quantity,unitPrice\n${product.barcode},1,4\n`),
        })
        await expect(page.getByText('导入 · 请核对数量与进货价')).toBeVisible()
        await page.getByRole('button', { name: '删除此行' }).last().click()
        await page.getByLabel('本次进货单价').fill('4')
        await page.getByRole('button', { name: '核对并入库' }).click()
        const review = page.getByRole('dialog', { name: '核对入库单' })
        await expect(review).toContainText('金边供应商')
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, desktop ? 'desktop-review.png' : 'phone-review.png') })
        let confirmRequests = 0
        const confirmationIds: string[] = []
        let committedStatus = 0
        let commitError = ''
        await page.route('**/api/native-inventory/receipt-confirmation', async (route) => {
          confirmRequests += 1
          confirmationIds.push(route.request().postDataJSON().id)
          if (!desktop) {
            if (confirmRequests === 1) await route.abort('connectionreset')
            else await route.continue()
            return
          }
          const headers = await route.request().allHeaders()
          const committed = await context.request.put(route.request().url(), {
            headers,
            data: route.request().postDataJSON(),
          })
          committedStatus = committed.status()
          if (!committed.ok()) commitError = await committed.text()
          await route.abort('connectionreset')
        })
        await review.getByRole('button', { name: '确认入库' }).click()
        if (desktop) {
          await expect(page.getByRole('heading', { name: '结果未确认' })).toBeVisible()
          assert.equal(committedStatus, 200, commitError)
          await page.reload()
          await page.getByRole('button', { name: '查看待确认入库单' }).click()
          await page.getByRole('button', { name: /RK-/ }).click()
          const lookup = page.waitForResponse((response) => response.url().includes('/api/native-inventory/receipt-result?id='))
          await page.getByRole('button', { name: '查询结果' }).click()
          assert.equal((await lookup).status(), 200)
          await expect(page.getByRole('dialog')).toContainText('已入库')
        } else {
          await expect(page.getByRole('heading', { name: '结果未确认' })).toBeVisible()
          await page.getByRole('button', { name: '查询结果' }).click()
          await expect(review).toContainText('原单仍是草稿')
          await review.getByRole('button', { name: '确认入库' }).click()
          await expect(page.getByRole('heading', { name: '已入库' })).toBeVisible()
        }
        assert.equal(confirmRequests, desktop ? 1 : 2)
        assert.equal(new Set(confirmationIds).size, 1)
        await page.getByRole('button', { name: '查看库存变化' }).click()
        await expect(page.getByRole('button', { name: /柬埔寨咖啡豆/ })).toContainText('刚入库 +2')
        const key = { tenantId_storeId_id: { ...scope, id: item.id } }
        assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '2')

        const sale = await context.request.post(new URL('/api/sales', runtime.origin).href, {
          data: { saleType: 'SALE', paymentMethod: 'CASH', items: [{ barcode: product.barcode, quantity: 1 }] },
        })
        assert.equal(sale.status(), 201, await sale.text())
        assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '1')
        await page.getByRole('button', { name: desktop ? '成本与毛利' : '毛利', exact: true }).click()
        await expect(page.getByRole('heading', { name: '成本与毛利' })).toBeVisible()
        await expect(page.locator('.g-pro').filter({ hasText: product.name })).toContainText('8.00')
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, desktop ? 'desktop-profit.png' : 'phone-profit.png') })
        await page.getByRole('button', { name: '供应商', exact: true }).click()
        await expect(page.getByRole('button', { name: /金边供应商/ })).toContainText('8.00')

        await page.getByRole('button', { name: desktop ? '库存管理' : '库存', exact: true }).click()
        await page.getByRole('button', { name: /柬埔寨咖啡豆/ }).click()
        const drawer = page.getByRole('dialog', { name: product.name })
        await expect(drawer).toContainText('销售')
        if (screenshotDir) await page.screenshot({ path: join(screenshotDir, desktop ? 'desktop-drawer.png' : 'phone-drawer.png') })
        await drawer.getByRole('button', { name: '库存调整' }).click()
        await drawer.getByLabel('调整后的实际数量').fill('3')
        await drawer.getByRole('button', { name: '盘点差异' }).click()
        await drawer.getByRole('button', { name: '确认调整' }).click()
        await expect(drawer).toBeHidden()
        assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '3')

        const inventoryHeaders = {
          'x-telegram-init-data': telegramProof(telegramId),
          ...(device ? { 'x-lightops-client': 'desktop-pos', 'x-pos-device-token': device.token, 'x-pos-device-id': browserId } : {}),
        }
        const supplier = await prisma.nativeInventorySupplier.findFirstOrThrow({ where: { ...scope, name: '金边供应商' } })
        const nextReceiptId = randomUUID()
        const draftResponse = await context.request.put(new URL('/api/native-inventory/receipts', runtime.origin).href, {
          headers: inventoryHeaders,
          data: { id: nextReceiptId, revision: 0, supplierId: supplier.id, lines: [{ itemId: item.id, unitId: 'BASE', quantity: '2', unitPrice: '4' }] },
        })
        assert.equal(draftResponse.status(), 200, await draftResponse.text())
        const [concurrentReceipt, concurrentSale] = await Promise.all([
          context.request.put(new URL('/api/native-inventory/receipt-confirmation', runtime.origin).href, {
            headers: inventoryHeaders, data: { id: nextReceiptId, revision: 1 },
          }),
          context.request.post(new URL('/api/sales', runtime.origin).href, {
            data: { saleType: 'SALE', paymentMethod: 'CASH', items: [{ barcode: product.barcode, quantity: 1 }] },
          }),
        ])
        assert.equal(concurrentReceipt.status(), 200, await concurrentReceipt.text())
        assert.equal(concurrentSale.status(), 201, await concurrentSale.text())
        assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '4')

        if (desktop) {
          const h5 = await prisma.customerOrder.create({ data: {
            ...scope, storeCode: store.code, orderNo: `H5-${randomUUID()}`,
            status: 'COMPLETED', totalAmount: '12',
            itemsJson: JSON.stringify([{ productId: product.id, name: product.name, price: 12, quantity: 1, lineAmount: 12 }]),
          } })
          const capture = () => context.request.patch(new URL(`/api/customer-orders/${h5.id}`, runtime.origin).href, {
            data: { paymentMethod: 'CASH' },
          })
          // Inject an isolated, source-scoped PostgreSQL error after checkout
          // writes have run but before the inventory movement can commit.
          await prisma.$executeRawUnsafe(
            `ALTER TABLE "NativeInventoryMovement" ADD CONSTRAINT native_inventory_m1_h5_fault CHECK ("sourceId" <> '${h5.id}:1') NOT VALID`,
          )
          try {
            const failed = await capture()
            assert.equal(failed.status(), 500)
            assert.equal((await prisma.customerOrder.findUniqueOrThrow({ where: { id: h5.id } })).paymentStatus, 'UNPAID')
            assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo: h5.orderNo } }), 0)
            assert.equal(await prisma.customerOrderFulfillmentIntent.count({ where: { ...scope, orderNo: h5.orderNo, purpose: 'FRONT_PAID' } }), 0)
            assert.equal(await prisma.nativeInventoryMovement.count({ where: { ...scope, originalId: h5.id } }), 0)
            assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '4')
          } finally {
            await prisma.$executeRaw`ALTER TABLE "NativeInventoryMovement" DROP CONSTRAINT native_inventory_m1_h5_fault`
          }
          const captures = await Promise.all([capture(), capture()])
          for (const response of captures) assert.equal(response.status(), 200, await response.text())
          assert.equal(await prisma.paymentIntent.count({ where: { ...scope, orderNo: h5.orderNo } }), 1)
          assert.equal(await prisma.customerOrderFulfillmentIntent.count({ where: { ...scope, orderNo: h5.orderNo, purpose: 'FRONT_PAID' } }), 1)
          assert.equal(await prisma.nativeInventoryMovement.count({ where: { ...scope, originalId: h5.id } }), 1)
          assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '3')

          const pos = () => context.request.post(new URL('/api/cashier/sales', runtime.origin).href, {
            headers: { ...inventoryHeaders, 'x-pos-operator-source': 'ACCOUNT' },
            data: { storeCode: store.code, paymentMethod: 'CASH', items: [{ barcode: product.barcode, quantity: 1 }] },
          })
          const existingSales = await prisma.saleRecord.count({ where: scope })
          await prisma.$executeRawUnsafe(
            `ALTER TABLE "NativeInventoryMovement" ADD CONSTRAINT native_inventory_m1_pos_fault CHECK ("itemId" <> '${item.id}' OR "type" <> 'SALE') NOT VALID`,
          )
          try {
            assert.equal((await pos()).status(), 500)
            assert.equal(await prisma.saleRecord.count({ where: scope }), existingSales)
            assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '3')
          } finally {
            await prisma.$executeRaw`ALTER TABLE "NativeInventoryMovement" DROP CONSTRAINT native_inventory_m1_pos_fault`
          }
          const retried = await pos()
          assert.equal(retried.status(), 201, await retried.text())
          assert.equal(await prisma.saleRecord.count({ where: scope }), existingSales + 1)
          assert.equal((await prisma.nativeInventoryItem.findUniqueOrThrow({ where: key })).onHand.toString(), '2')
        }

        if (terminal) {
          await prisma.desktopDevice.update({ where: { id: terminal.id }, data: { status: 'REVOKED' } })
          await page.reload()
          await expect(page.getByText('请先完成本门店的桌面设备授权。')).toBeVisible()
        }
      } finally { await context.close() }
    })
  }
})

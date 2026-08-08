import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright'

const baseURL = process.env.DASHBOARD_UI_BASE_URL ?? 'http://127.0.0.1:3100'
let printKitchenTicket = false
let settingsWrites = 0

async function mockDashboardApis(page: Page) {
  page.setDefaultTimeout(10_000)
  await page.route('https://telegram.org/**', (route) => route.abort())
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort())
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort())
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })

    if (path === '/api/auth/status') return json({ ok: true })
    if (path === '/api/me') {
      return json({
        tier: 'STANDARD',
        storeName: 'Mobile Print Test',
        storeCode: 'STORE-UI-TEST',
        tenantName: 'Mobile Print Test',
        checkoutMode: 'DIRECT_PAYMENT',
        currencyCode: 'USD',
      })
    }
    if (path === '/api/stores') {
      return json([{
        id: 'seed-store-a',
        name: 'Mobile Print Test',
        checkoutMode: 'DIRECT_PAYMENT',
        currencyCode: 'USD',
        bannerUrl: null,
        announcement: null,
        promoText: null,
        contactPhone: null,
        contactTelegram: null,
        contactWhatsApp: null,
        storeAddress: null,
        storeLat: null,
        storeLng: null,
      }])
    }
    if (path === '/api/admin/users') return json([])
    if (path === '/api/summary') {
      return json({
        dateFrom: '2026-08-08',
        dateTo: '2026-08-08',
        dimension: 'GLOBAL',
        storeName: null,
        operatorDisplayName: null,
        totalSaleAmount: 0,
        totalRefundAmount: 0,
        netAmount: 0,
        saleOrderCount: 0,
        refundOrderCount: 0,
        topProducts: [],
      })
    }
    if (path === '/api/store/settings') {
      if (request.method() === 'PATCH') {
        const body = request.postDataJSON() as { printKitchenTicket?: boolean }
        if (typeof body.printKitchenTicket === 'boolean') {
          printKitchenTicket = body.printKitchenTicket
          settingsWrites += 1
        }
      }
      return json({
        ok: true,
        businessType: 'GENERAL',
        currencyCode: 'USD',
        printKitchenTicket,
      })
    }
    return json({})
  })
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  })

  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const mobile = await context.newPage()
    await mockDashboardApis(mobile)
    await mobile.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded' })

    const storeSettingsEntry = mobile.getByRole('button', { name: /门店配置/ })
    await storeSettingsEntry.waitFor()
    await storeSettingsEntry.click()
    assert.equal(
      await mobile.evaluate(() => sessionStorage.getItem('dashboard:store-config-open')),
      '1',
      'opening store settings must persist before a remount can occur',
    )

    const printSettingsTitle = mobile.getByText('🖨️ 打印设置', { exact: true })
    await printSettingsTitle.waitFor()
    const kitchenToggle = mobile.getByText('打印厨房小票', { exact: true })
      .locator('xpath=../..')
      .locator('button')
    assert.equal(await kitchenToggle.getAttribute('aria-pressed'), 'false')

    await kitchenToggle.click()
    await mobile.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') !== null)
    assert.equal(settingsWrites, 1, 'OWNER toggle must persist through the existing settings API')
    assert.equal(printKitchenTicket, true)

    await mobile.reload({ waitUntil: 'domcontentloaded' })
    await printSettingsTitle.waitFor()
    await mobile.waitForTimeout(500)
    assert.equal(await printSettingsTitle.isVisible(), true, 'mobile print settings must stay visible after remount')
    await mobile.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') !== null)
    assert.equal(await kitchenToggle.getAttribute('aria-pressed'), 'true', 'saved value must be read consistently after remount')

    await kitchenToggle.click()
    await mobile.waitForFunction(() => document.querySelector('button[aria-pressed="false"]') !== null)
    assert.equal(settingsWrites, 2, 'OWNER must be able to persist true and false')
    assert.equal(printKitchenTicket, false)

    await mobile.reload({ waitUntil: 'domcontentloaded' })
    await printSettingsTitle.waitFor()
    await mobile.waitForTimeout(500)
    assert.equal(await printSettingsTitle.isVisible(), true, 'mobile print settings must remain open after the second remount')
    assert.equal(await kitchenToggle.getAttribute('aria-pressed'), 'false', 'the saved false value must be read consistently')

    const desktop = await context.newPage()
    await desktop.setViewportSize({ width: 1440, height: 900 })
    await mockDashboardApis(desktop)
    await desktop.goto(`${baseURL}/dashboard`, { waitUntil: 'domcontentloaded' })
    const desktopEntry = desktop.getByRole('button', { name: /门店配置/ })
    const desktopPrintSettings = desktop.getByText('🖨️ 打印设置', { exact: true })
    await desktopEntry.waitFor()
    await desktopEntry.click()
    await desktopPrintSettings.waitFor()
    await desktopEntry.click()
    await desktopPrintSettings.waitFor({ state: 'hidden' })
    await desktopEntry.click()
    await desktopPrintSettings.waitFor({ state: 'visible' })

    await context.close()
    console.log('dashboard mobile print settings lifecycle tests passed')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

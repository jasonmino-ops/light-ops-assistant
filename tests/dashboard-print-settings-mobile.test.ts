import assert from 'node:assert/strict'
import { chromium, type Page } from 'playwright'

const baseURL = process.env.DASHBOARD_UI_BASE_URL ?? 'http://127.0.0.1:3100'
let printKitchenTicket = false
let settingsWrites = 0
let settingsReadsAfterWrite = 0
let delayedSettingsGetsRemaining = 0
let delayedSettingsGetStarted: (() => void) | null = null
let delayedSettingsGetRelease: Promise<void> = Promise.resolve()
let storeReads = 0
let delayStoreConfigRead = false
let delayedStoreConfigReadStarted: (() => void) | null = null
let delayedStoreConfigReadRelease: Promise<void> = Promise.resolve()
let summaryReads = 0

function delayNextStoreConfigRead() {
  let release: (() => void) | null = null
  const started = new Promise<void>((resolve) => { delayedStoreConfigReadStarted = resolve })
  delayedStoreConfigReadRelease = new Promise<void>((resolve) => { release = resolve })
  delayStoreConfigRead = true
  return {
    started,
    release: () => release?.(),
  }
}

function delayNextSettingsGets(count: number) {
  let release: (() => void) | null = null
  const started = new Promise<void>((resolve) => { delayedSettingsGetStarted = resolve })
  delayedSettingsGetRelease = new Promise<void>((resolve) => { release = resolve })
  delayedSettingsGetsRemaining = count
  return {
    started,
    release: () => release?.(),
  }
}

async function waitForCondition(condition: () => boolean, message: string) {
  const deadline = Date.now() + 10_000
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function mockDashboardApis(page: Page) {
  page.setDefaultTimeout(20_000)
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
      storeReads += 1
      if (delayStoreConfigRead) {
        delayStoreConfigRead = false
        delayedStoreConfigReadStarted?.()
        await delayedStoreConfigReadRelease
      }
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
      summaryReads += 1
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
      } else if (settingsWrites > 0) {
        settingsReadsAfterWrite += 1
      }

      const valueAtRequest = printKitchenTicket
      if (request.method() === 'GET' && delayedSettingsGetsRemaining > 0) {
        delayedSettingsGetsRemaining -= 1
        if (delayedSettingsGetsRemaining === 0) delayedSettingsGetStarted?.()
        await delayedSettingsGetRelease
        return json({
          ok: true,
          businessType: 'GENERAL',
          currencyCode: 'USD',
          printKitchenTicket: valueAtRequest,
        })
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
    await waitForCondition(() => storeReads >= 1, 'initial dashboard store read did not complete')
    await waitForCondition(() => summaryReads >= 3, 'initial dashboard summary reads did not complete')
    await mobile.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
      return buttons.some((button) => button.textContent?.trim() === '刷新' && !button.disabled)
    })
    await mobile.waitForTimeout(1_000)
    const delayedStoreConfig = delayNextStoreConfigRead()
    await storeSettingsEntry.click()
    assert.equal(
      await mobile.evaluate(() => sessionStorage.getItem('dashboard:store-config-open')),
      '1',
      'opening store settings must persist before a remount can occur',
    )

    const printSettingsTitle = mobile.getByText('🖨️ 打印设置', { exact: true })
    await printSettingsTitle.waitFor()
    await delayedStoreConfig.started
    const printSettingsCard = mobile.locator('[data-print-settings-card="true"]')
    const mountedPrintSettingsCard = await printSettingsCard.elementHandle()
    assert.ok(mountedPrintSettingsCard, 'print settings card must mount when store settings opens')
    const initialPrintSettingsBox = await printSettingsCard.boundingBox()
    assert.ok(initialPrintSettingsBox && initialPrintSettingsBox.y < 844, 'print settings must initially be inside the mobile viewport')
    await mobile.getByRole('button', { name: '刷新', exact: true }).evaluate((button) => (button as HTMLElement).click())
    await mobile.waitForTimeout(10_100)
    delayedStoreConfig.release()
    await waitForCondition(() => storeReads >= 2, 'store configuration refresh did not complete')
    await mobile.waitForTimeout(200)
    assert.equal(await mountedPrintSettingsCard.evaluate((element) => element.isConnected), true, 'async store refresh must not replace the open print settings card')
    const refreshedPrintSettingsBox = await printSettingsCard.boundingBox()
    assert.ok(
      refreshedPrintSettingsBox && refreshedPrintSettingsBox.y < 844,
      `async store refresh must not push print settings out of the mobile viewport (${JSON.stringify({ initialPrintSettingsBox, refreshedPrintSettingsBox })})`,
    )
    assert.ok(
      Math.abs(refreshedPrintSettingsBox.y - initialPrintSettingsBox.y) < 20,
      'async store content must render below the stable print settings card',
    )
    const kitchenToggle = mobile.getByText('打印厨房小票', { exact: true })
      .locator('xpath=../..')
      .locator('button')
    const saveButton = mobile.locator('[data-print-settings-save="true"]')
    assert.equal(await kitchenToggle.getAttribute('aria-pressed'), 'false')

    await storeSettingsEntry.click()
    await printSettingsTitle.waitFor({ state: 'hidden' })
    const delayedGets = delayNextSettingsGets(2)
    await storeSettingsEntry.click()
    await printSettingsTitle.waitFor()
    await delayedGets.started
    assert.equal(await kitchenToggle.isDisabled(), false, 'a remount must reuse the last authoritative value instead of disabling the toggle during revalidation')

    await kitchenToggle.click()
    await mobile.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') !== null)
    assert.equal(settingsWrites, 0, 'changing the draft must not write before OWNER saves')
    await saveButton.click()
    await waitForCondition(
      () => settingsWrites >= 1 && settingsReadsAfterWrite >= 1,
      'PATCH and authoritative GET did not complete',
    )
    delayedGets.release()
    await mobile.waitForTimeout(200)
    assert.equal(await printSettingsTitle.isVisible(), true, 'saving and authoritative revalidation must keep mobile print settings open')
    const savedPrintSettingsBox = await printSettingsCard.boundingBox()
    assert.ok(savedPrintSettingsBox && savedPrintSettingsBox.y < 844, 'saving must keep print settings inside the mobile viewport')
    assert.equal(settingsWrites, 1, 'OWNER toggle must persist through the existing settings API')
    assert.equal(printKitchenTicket, true)
    assert.equal(await kitchenToggle.getAttribute('aria-pressed'), 'true', 'a stale GET started before PATCH must not overwrite the confirmed value')

    await mobile.reload({ waitUntil: 'domcontentloaded' })
    await printSettingsTitle.waitFor()
    await mobile.waitForTimeout(500)
    assert.equal(await printSettingsTitle.isVisible(), true, 'mobile print settings must stay visible after remount')
    await mobile.waitForFunction(() => document.querySelector('button[aria-pressed="true"]') !== null)
    assert.equal(await kitchenToggle.getAttribute('aria-pressed'), 'true', 'saved value must be read consistently after remount')

    await kitchenToggle.click()
    await mobile.waitForFunction(() => document.querySelector('button[aria-pressed="false"]') !== null)
    assert.equal(settingsWrites, 1, 'the second draft must wait for its save action')
    await saveButton.click()
    await waitForCondition(
      () => settingsWrites >= 2 && settingsReadsAfterWrite >= 2,
      'second PATCH and authoritative GET did not complete',
    )
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

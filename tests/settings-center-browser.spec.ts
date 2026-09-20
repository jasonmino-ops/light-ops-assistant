import { expect, test, type Page } from '@playwright/test'

const settingsPayload = {
  storeId: 'store-a',
  storeCode: 'STORE-A',
  storeName: 'Settings Test Store',
  businessType: 'FOOD',
  checkoutMode: 'DIRECT_PAYMENT',
  currencyCode: 'USD',
  printKitchenTicket: false,
  contactPhone: '+855 12 345 678',
  contactTelegram: '@settings-test',
  contactWhatsApp: '+855 12 345 678',
  storeAddress: 'Phnom Penh',
  storeLat: null,
  storeLng: null,
}

async function stubOwnerApis(page: Page) {
  await page.route('**/api/**', async (route) => {
    const requestUrl = new URL(route.request().url())
    if (requestUrl.pathname === '/api/auth/status') return route.fulfill({ json: { ok: true } })
    if (requestUrl.pathname === '/api/me') {
      return route.fulfill({ json: { tier: 'STANDARD', storeName: settingsPayload.storeName, storeCode: settingsPayload.storeCode, currencyCode: settingsPayload.currencyCode } })
    }
    if (requestUrl.pathname === '/api/store/settings') return route.fulfill({ json: settingsPayload })
    if (requestUrl.pathname === '/api/stores') {
      return route.fulfill({ json: [{ id: settingsPayload.storeId, code: settingsPayload.storeCode, name: settingsPayload.storeName, checkoutMode: settingsPayload.checkoutMode, currency: settingsPayload.currencyCode }] })
    }
    return route.fulfill({ json: {} })
  })
}

test('Browser Settings renders owner-safe Store settings without Desktop-only sections', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lang', 'en'))
  await stubOwnerApis(page)
  await page.goto('/settings')

  await expect(page.locator('[data-settings-page="owner"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Store', exact: true })).toBeVisible()
  await expect(page.getByText('Display settings', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-settings-auto-print="desktop-only"]')).toHaveCount(0)
  await expect(page.locator('[data-settings-display="desktop-only"]')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Table QR/i })).toBeVisible()
})

test('Desktop Settings exposes only the authorized Desktop-only preferences', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lang', 'en')
    Object.defineProperty(window, 'eshopDesktopRuntime', { configurable: true, value: { isDesktop: true, runtime: 'electron', version: 'test' } })
  })
  await stubOwnerApis(page)
  await page.goto('/settings?from=desktop&storeCode=STORE-A')

  await expect(page.locator('[data-settings-page="owner"]')).toBeVisible()
  await expect(page.locator('[data-settings-auto-print="desktop-only"]')).toBeVisible()
  await expect(page.locator('[data-settings-display="desktop-only"]')).toBeVisible()
  await expect(page.getByText('Desktop preferences', { exact: true })).toBeVisible()
  await expect(page.getByText('Desktop runtime version: test', { exact: true })).toBeVisible()
})

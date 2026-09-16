import { expect, test } from '@playwright/test'

test('OWNER can issue, copy, regenerate, and forget a current-store Desktop activation PIN', async ({ page }) => {
  const issuedBodies: Array<{ storeId?: string }> = []
  let issueCount = 0

  await page.addInitScript(() => {
    localStorage.setItem('lang', 'zh')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          ;(window as typeof window & { __copiedActivationPin?: string }).__copiedActivationPin = value
        },
      },
    })
  })

  await page.route('**/api/auth/status', (route) => route.fulfill({ status: 200, json: { ok: true } }))
  await page.route('**/api/me', (route) => route.fulfill({
    status: 200,
    json: {
      tier: 'MULTI_STORE',
      storeName: 'Mino Pet Shop',
      storeCode: 'ST169E7000',
      tenantName: 'Mino',
      checkoutMode: 'DIRECT_PAYMENT',
      currencyCode: 'USD',
    },
  }))
  await page.route('**/api/stores', (route) => route.fulfill({
    status: 200,
    json: [
      { id: 'store-mino', name: 'Mino Pet Shop', code: 'ST169E7000' },
      { id: 'store-car', name: 'Car Garden(TK)', code: 'ST-CAR-GARDEN' },
    ],
  }))
  await page.route('**/api/computer-client/requests', (route) => route.fulfill({
    status: 200,
    json: { requests: [], boundComputers: [], disabledComputers: [] },
  }))
  await page.route('**/api/desktop/activation-pins', async (route) => {
    issueCount += 1
    issuedBodies.push(route.request().postDataJSON())
    await route.fulfill({
      status: 201,
      json: {
        pinId: `pin-${issueCount}`,
        pin: issueCount === 1 ? '123456' : '654321',
        storeId: 'store-mino',
        expiresAt: '2026-09-17T05:00:00.000Z',
        subscription: { accessState: 'ALLOWED', status: 'ACTIVE', warning: null },
      },
    })
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/home/computer-client')

  const entry = page.locator('[data-desktop-activation-pin="owner-entry"]')
  await expect(entry).toBeVisible()
  await expect(entry.locator('[data-desktop-activation-store]')).toContainText('Mino Pet Shop · ST169E7000')
  await expect(entry.getByRole('button', { name: '生成电脑激活 PIN' })).toBeEnabled()

  await entry.getByRole('button', { name: '生成电脑激活 PIN' }).click()
  await expect(entry.locator('[data-desktop-activation-result]')).toContainText('123456')
  await expect(entry).toContainText('24 小时内有效，使用一次后自动失效')
  expect(issuedBodies).toEqual([{ storeId: 'store-mino' }])

  await entry.getByRole('button', { name: '复制 PIN' }).click()
  await expect(entry.getByRole('button', { name: '已复制 ✓' })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { __copiedActivationPin?: string }).__copiedActivationPin)).toBe('123456')

  page.once('dialog', (dialog) => dialog.accept())
  await entry.getByRole('button', { name: '重新生成' }).click()
  await expect(entry.locator('[data-desktop-activation-result]')).toContainText('654321')
  expect(issuedBodies).toEqual([{ storeId: 'store-mino' }, { storeId: 'store-mino' }])

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  await page.reload()
  await expect(page.locator('[data-desktop-activation-result]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '生成电脑激活 PIN' })).toBeVisible()
  expect(issueCount).toBe(2)
})

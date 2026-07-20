import { expect, test, type Page } from '@playwright/test'

const smokeBaseUrl = process.env.SMOKE_BASE_URL
if (!smokeBaseUrl || !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(smokeBaseUrl)) {
  throw new Error('SMOKE_BASE_URL must point to a local server for this mocked Ops UI test')
}

async function capture(page: Page, name: string) {
  const directory = process.env.OPS_DESKTOP_SCREENSHOT_DIR
  if (directory) await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true })
}

const store = {
  storeId: 'store-test-1',
  storeCode: 'PREV06C',
  storeName: 'Preview Desktop Store',
  storeStatus: 'ACTIVE',
  tenantId: 'tenant-test-1',
  tenantName: 'Preview Tenant',
  tenantStatus: 'ACTIVE',
  subscription: { status: 'ACTIVE', accessState: 'ALLOWED', trialEndsAt: null, currentPeriodEndsAt: null },
  desktopCount: 1,
  activeDesktopCount: 1,
  activationStatus: 'ACTIVE',
  lastVerification: '2026-07-20T03:50:00.000Z',
  currentPinStatus: 'NONE',
  currentRuntimeVersion: 'Activation Runtime v1',
  currentDesktopVersion: '0.2.0-pilot.2',
}

test.beforeEach(async ({ page }) => {
  let revoked = false
  await page.context().addCookies([{
    name: 'auth-session',
    value: 'eyJyb2xlIjoiT1dORVIifQ.local-ui-test',
    url: smokeBaseUrl,
  }])
  await page.route('**/api/ops/check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, opsRole: 'SUPER_ADMIN' }) })
  })
  await page.route('**/api/ops/desktop-activation', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        pin: '654321',
        expiresAt: '2026-07-20T05:00:00.000Z',
        pinTtlHours: 1,
        replacedActivePin: false,
        store: { code: 'PREV06C', name: 'Preview Desktop Store' },
      }),
    })
  })
  await page.route('**/api/ops/desktop-management/devices/*/revoke', async (route) => {
    revoked = true
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, deviceRef: 'ABC12345', status: 'REVOKED' }) })
  })
  await page.route('**/api/ops/desktop-management?**', async (route) => {
    const url = new URL(route.request().url())
    const view = url.searchParams.get('view')
    if (view === 'stores') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ stores: [store], page: 1, pageSize: 10, total: 1, totalPages: 1 }) })
      return
    }
    if (view === 'devices') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          devices: [{
            deviceRef: 'ABC12345',
            deviceName: 'Desktop ABC12345',
            storeCode: 'PREV06C',
            storeName: 'Preview Desktop Store',
            tenantName: 'Preview Tenant',
            subscriptionStatus: 'ACTIVE',
            status: revoked ? 'REVOKED' : 'ACTIVE',
            activatedAt: '2026-07-20T03:40:00.000Z',
            lastVerification: '2026-07-20T03:50:00.000Z',
            desktopVersion: null,
            windowsVersion: null,
            revokedAt: revoked ? '2026-07-20T03:55:00.000Z' : null,
            canRevoke: !revoked,
          }],
          page: 1,
          pageSize: 15,
          total: 1,
          totalPages: 1,
        }),
      })
      return
    }
    if (view === 'audit') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          events: [{
            eventKey: 'event-1', eventType: 'DESKTOP_VERIFIED', category: 'VERIFICATION', label: 'Verification', result: 'SUCCESS', reasonCode: null,
            createdAt: '2026-07-20T03:40:00.000Z', storeCode: 'PREV06C', storeName: 'Preview Desktop Store', tenantName: 'Preview Tenant', deviceRef: 'ABC12345', actor: 'Desktop Runtime', derived: true,
          }],
          page: 1, pageSize: 20, total: 1, totalPages: 1,
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        runtimeVersion: 'Activation Runtime v1', currentDesktopVersion: '0.2.0-pilot.2', deviceCount: 1,
        statusCounts: { ACTIVE: 1, OFFLINE: 0, BLOCKED: 0, REVOKED: 0 }, lastVerification: '2026-07-20T03:50:00.000Z',
        desktopTelemetry: 'NOT_REPORTED', windowsTelemetry: 'NOT_REPORTED',
      }),
    })
  })
})

test('activation is discoverable and clears the one-time PIN', async ({ page }) => {
  await page.goto('/ops/desktop/activation')
  await expect(page.getByRole('heading', { name: 'Desktop Activation' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Devices' })).toBeVisible()
  await expect(page.getByText('PREV06C')).toBeVisible()
  await capture(page, 'activation-desktop')

  await page.getByRole('button', { name: 'Generate Activation PIN' }).click()
  await expect(page.getByRole('dialog')).toContainText('Preview Desktop Store')
  await page.getByRole('button', { name: '确认生成' }).click()
  await expect(page.getByLabel('activation pin')).toHaveText('654321')
  await page.getByRole('button', { name: '关闭并清除' }).click()
  await expect(page.getByLabel('activation pin')).toHaveCount(0)
})

test('device revocation requires a reason and refreshes status', async ({ page }) => {
  await page.goto('/ops/desktop/devices')
  await expect(page.getByText('Desktop ABC12345')).toBeVisible()
  await capture(page, 'devices-desktop')
  await page.getByRole('button', { name: 'Revoke' }).click()
  await expect(page.getByRole('dialog')).toContainText('PREV06C')
  await page.getByLabel('Reason').fill('Founder field-test closure')
  await page.getByRole('button', { name: '确认撤销' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('article').getByText('REVOKED', { exact: true })).toBeVisible()
})

test('audit and runtime views remain readable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/ops/desktop/audit')
  await expect(page.getByLabel('Desktop audit timeline').getByText('Verification', { exact: true })).toBeVisible()
  await expect(page.getByText('Derived from latest verification')).toBeVisible()
  await page.getByRole('link', { name: 'Runtime' }).click()
  await expect(page.getByText('0.2.0-pilot.2')).toBeVisible()
  await capture(page, 'runtime-mobile')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

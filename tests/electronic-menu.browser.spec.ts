import { expect, test, type Page } from '@playwright/test'
import { signSession } from '../lib/session'
import { getRedirectError } from 'next/dist/client/components/redirect'
import { RedirectType } from 'next/dist/client/components/redirect-error'
import type { ElectronicMenuData } from '../lib/electronic-menu'

const baseURL = process.env.ELECTRONIC_MENU_TEST_URL ?? 'http://127.0.0.1:3100'
test.use({ baseURL, extraHTTPHeaders: {}, viewport: { width: 1920, height: 1080 } })
test.beforeEach(() => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname)
})

const picture = (color: string) => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="${color}"/><ellipse cx="230" cy="244" rx="100" ry="12" fill="#000" opacity=".12"/><path d="M145 90h150v115q0 32-75 32t-75-32z" fill="#fff6e9"/><path d="M295 110h24q35 0 35 36t-35 36h-24" fill="none" stroke="#fff6e9" stroke-width="16"/><ellipse cx="220" cy="90" rx="75" ry="18" fill="#6b3f2b"/></svg>`).toString('base64')}`
const names = ['Cold Brew', 'Matcha Latte', 'Cappuccino', 'Americano', 'Mocha', 'Flat White', 'Iced Tea', 'Espresso', 'Lemon Tea', 'Chocolate']
function menu(): ElectronicMenuData {
  return {
    store: { code: 'STORE-A', name: 'MORNING COFFEE', currencyCode: 'USD', announcement: 'Freshly brewed. Made for your morning.', promoText: null, bannerUrl: null },
    categories: [{ id: 'drinks', name: '冰咖啡', parentId: null, sortOrder: 0 }],
    products: names.map((name, index) => ({
      id: `product-${index}`, name, nameEn: name, nameZh: `咖啡 ${index + 1}`, nameKm: `កាហ្វេ ${index + 1}`,
      descZh: null, descEn: 'Freshly prepared · House blend', descKm: null, spec: '350 ml',
      price: index === 0 ? 4.5 : 3.5 + index / 2, originalPrice: index === 0 ? 6 : 3.5 + index / 2,
      discountEnabled: index === 0, isRecommended: index === 0 || index === 2, categoryId: 'drinks',
      imageUrl: picture(['#b6ab8b', '#90a793', '#bf937c', '#ab8973'][index % 4]), imageUrls: [],
    })),
  }
}

async function blockExternal(page: Page) {
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.origin === new URL(baseURL).origin ? route.continue() : route.fulfill({ status: 200, body: '', contentType: 'text/plain' })
  })
}

test('public screen ignores merchant cookies and Telegram context; only catalog GET is sent', async ({ page, context }) => {
  await context.addCookies([
    { name: 'auth-session', value: signSession({ tenantId: 'PRIVATE-TENANT', userId: 'PRIVATE-OWNER', storeId: 'PRIVATE-STORE', role: 'OWNER' }), url: baseURL },
    { name: 'delegate-info', value: encodeURIComponent(JSON.stringify({ storeId: 'PRIVATE-STORE', storeName: 'PRIVATE-NAME', opsAdminId: 'PRIVATE-OPS' })), url: baseURL },
  ])
  await page.addInitScript(() => {
    Object.assign(window, { Telegram: { WebApp: { initData: 'user=internal', initDataUnsafe: { start_param: 'bind_PRIVATE' } } } })
    localStorage.setItem('work-mode', 'staff')
  })
  await blockExternal(page)
  const apiRequests: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/api/**', route => {
    apiRequests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    expect(route.request().headers().cookie).toBeUndefined()
    return route.fulfill({ json: menu() })
  })
  const response = await page.goto('/electronic-menu?code=STORE-A&lang=en')
  await expect(page.getByTestId('menu-product-card')).toHaveCount(8)
  const html = await response!.text()
  expect(html).not.toMatch(/PRIVATE-|telegram\.org|tiktok|delegate-info|auth-session/)
  await expect(page.getByText('MORNING COFFEE', { exact: true })).toBeVisible()
  await expect(page.getByTestId('menu-product-price').first()).toContainText('4.50')
  expect(apiRequests).toEqual(['GET /api/public/electronic-menu'])
  expect(errors).toEqual([])
  await expect(page.locator('[data-merchant-bottom-nav]')).toHaveCount(0)
  await expect(page.locator('script[src*="telegram"]')).toHaveCount(0)
  await page.screenshot({ path: 'test-results/electronic-menu-1920.png', fullPage: true, animations: 'disabled' })
})

test('anonymous display paginates all products, refreshes, survives temporary errors and clears a disabled store', async ({ page }) => {
  await page.clock.install()
  await blockExternal(page)
  let data = menu()
  let status = 200
  let requests = 0
  await page.route('**/api/public/electronic-menu?*', route => {
    requests++
    return route.fulfill({ status, json: status === 200 ? data : { error: status === 404 ? 'STORE_NOT_FOUND' : 'MENU_UNAVAILABLE' } })
  })
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  await expect(page.getByTestId('menu-product-card')).toHaveCount(8)
  await page.clock.fastForward(12_100)
  await expect(page.getByTestId('menu-product-card')).toHaveCount(2)
  await expect(page.getByText('Chocolate', { exact: true })).toBeVisible()
  data = { ...data, products: [{ ...data.products[0], nameEn: 'Updated Coffee', price: 4.75 }] }
  await page.clock.fastForward(30_100)
  await expect(page.getByText('Updated Coffee', { exact: true })).toBeVisible()
  await expect(page.getByTestId('menu-product-price').first()).toContainText('4.75')
  status = 503
  await page.clock.fastForward(30_100)
  await expect(page.getByTestId('menu-refresh-status')).toContainText(/refresh|update|connection|offline/i)
  await expect(page.getByText('Updated Coffee', { exact: true })).toBeVisible()
  status = 404
  await page.clock.fastForward(30_100)
  await expect(page.getByTestId('menu-product-card')).toHaveCount(0)
  await expect(page.getByText('Updated Coffee', { exact: true })).toHaveCount(0)
  expect(requests).toBeGreaterThanOrEqual(4)
})

for (const size of [{ width: 1366, height: 768, count: 6 }, { width: 1024, height: 768, count: 4 }, { width: 960, height: 540, count: 2 }, { width: 390, height: 844, count: 2 }]) {
  test(`screen fits ${size.width}x${size.height} without clipping cards`, async ({ page }) => {
    await page.setViewportSize(size)
    await blockExternal(page)
    const data = menu()
    data.products[0].nameKm = 'កាហ្វេទឹកដោះគោរសជាតិពិសេស ប្រចាំហាង កាហ្វេទឹកដោះគោរសជាតិពិសេស'
    await page.route('**/api/public/electronic-menu?*', route => route.fulfill({ json: data }))
    await page.goto('/electronic-menu?code=STORE-A&lang=km')
    await expect(page.getByTestId('menu-product-card')).toHaveCount(size.count)
    const boxes = await page.getByTestId('menu-product-card').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect()
      const price = node.querySelector('[data-testid="menu-product-price"]')!.getBoundingClientRect()
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, priceBottom: price.bottom, priceRight: price.right }
    }))
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeLessThanOrEqual(size.width + 1)
      expect(box.bottom).toBeLessThanOrEqual(size.height + 1)
      expect(box.priceBottom).toBeLessThanOrEqual(box.bottom)
      expect(box.priceRight).toBeLessThanOrEqual(box.right)
    }
    await page.screenshot({ path: `test-results/electronic-menu-${size.width}.png`, fullPage: true, animations: 'disabled' })
  })
}

test('invalid, duplicate and extra selectors never fall back to a store', async ({ page, request }) => {
  await blockExternal(page)
  let requests = 0
  await page.route('**/api/**', route => { requests++; return route.fulfill({ status: 500, json: {} }) })
  for (const query of ['', '?code=STORE-A&code=STORE-B', '?code=STORE-A&token=bad', '?code=STORE-A&storeId=STORE-B', '?code=%3Cscript%3E']) {
    await page.goto(`/electronic-menu${query}`)
    await expect(page.getByTestId('menu-product-card')).toHaveCount(0)
    await expect(page.getByTestId('electronic-menu-screen')).toBeVisible()
  }
  expect(requests).toBe(0)
  for (const query of ['', '?code=STORE-A&code=STORE-B', '?code=STORE-A&token=bad']) {
    expect((await request.get(`/api/public/electronic-menu${query}`)).status()).toBe(400)
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    expect((await request.fetch('/api/public/electronic-menu?code=STORE-A', { method, data: { price: 1 } })).status()).toBe(405)
  }
})

test('slow requests cannot overlap; timeout, malformed data and offline recovery remain bounded', async ({ page }) => {
  await page.clock.install()
  await blockExternal(page)
  let release: () => void = () => {}
  const held = new Promise<void>(resolve => { release = resolve })
  let count = 0
  let data = menu()
  await page.route('**/api/public/electronic-menu?*', async route => {
    const index = ++count
    if (index === 1) await held
    await route.fulfill({ json: data }).catch(() => {}) // A timed-out browser request has already closed.
  })
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  await expect.poll(() => count).toBe(1)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
  })
  expect(count).toBe(1)
  await page.clock.fastForward(10_100)
  await expect(page.getByRole('heading', { name: 'Unable to load the menu' })).toBeVisible()
  release()
  await page.clock.fastForward(20_100)
  await expect(page.getByTestId('menu-product-card')).toHaveCount(8)
  expect(count).toBe(2)
  data = { ...data, store: { ...data.store, code: 'STORE-B', name: 'FOREIGN STORE' } }
  await page.clock.fastForward(30_100)
  await expect(page.getByTestId('menu-refresh-status')).toContainText('Update unavailable')
  await expect(page.getByText('FOREIGN STORE')).toHaveCount(0)
  await expect(page.getByText('MORNING COFFEE', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    window.dispatchEvent(new Event('offline'))
  })
  const beforeOffline = count
  await page.clock.fastForward(30_100)
  expect(count).toBe(beforeOffline)
  data = menu()
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
    window.dispatchEvent(new Event('online'))
  })
  await expect(page.getByTestId('menu-refresh-status')).toContainText('Menu up to date')
  expect(count).toBe(beforeOffline + 1)
})

test('language changes preserve prices/order without refetch; missing images and an empty catalog render safely', async ({ page }) => {
  await page.clock.install()
  await blockExternal(page)
  const data = menu()
  data.products = data.products.slice(0, 2)
  data.products[0].imageUrl = null
  data.products[1].imageUrl = `${baseURL}/missing-product.jpg`
  await page.route('**/missing-product.jpg', route => route.fulfill({ status: 404, body: '' }))
  let count = 0
  await page.route('**/api/public/electronic-menu?*', route => { count++; return route.fulfill({ json: data }) })
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  await expect(page.getByTestId('menu-product-card')).toHaveCount(2)
  await expect(page.getByLabel('Made to enjoy')).toHaveCount(2)
  await page.getByTestId('menu-language').getByRole('button', { name: '中文' }).click()
  await expect(page.getByTestId('menu-product-name').first()).toHaveText('咖啡 1')
  await expect(page.getByTestId('menu-product-price').first()).toContainText('4.50')
  await page.getByTestId('menu-language').getByRole('button', { name: 'ខ្មែរ' }).click()
  await expect(page.getByTestId('menu-product-name').first()).toHaveText('កាហ្វេ 1')
  expect(count).toBe(1)
  data.products = []
  await page.clock.fastForward(30_100)
  await expect(page.getByTestId('menu-product-card')).toHaveCount(0)
  await page.getByTestId('menu-language').getByRole('button', { name: 'EN' }).click()
  await expect(page.getByRole('heading', { name: 'Coming to the menu' })).toBeVisible()
})

test('a transient image failure retries the same GIF URL on the next catalog refresh', async ({ page }) => {
  await page.clock.install()
  await blockExternal(page)
  const data = menu()
  data.products = [{ ...data.products[0], imageUrl: `${baseURL}/recovered-product.gif` }]
  let reads = 0
  await page.route('**/recovered-product.gif', route => ++reads === 1
    ? route.fulfill({ status: 503, body: '', headers: { 'Cache-Control': 'no-store' } })
    : route.fulfill({ contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') }))
  await page.route('**/api/public/electronic-menu?*', route => route.fulfill({ json: data }))
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  await expect(page.getByLabel('Made to enjoy')).toHaveCount(1)
  await page.clock.fastForward(30_100)
  await expect(page.getByTestId('menu-product-card').locator('img')).toBeVisible()
  await expect.poll(() => reads).toBe(2)
  expect(await page.getByTestId('menu-product-card').locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
})

test('catalog refresh does not starve later pages in a 26-product menu', async ({ page }) => {
  await page.clock.install()
  await blockExternal(page)
  const data = menu()
  data.products = Array.from({ length: 26 }, (_, index) => ({ ...data.products[index % 10], id: `item-${index}` }))
  let reads = 0
  await page.route('**/api/public/electronic-menu?*', route => { reads++; return route.fulfill({ json: data }) })
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  await expect(page.getByTestId('menu-product-card')).toHaveCount(8)
  const seen = new Set<string>()
  for (let index = 0; index < 4; index++) {
    if (index > 0) await page.clock.fastForward(12_100)
    await expect(page.getByTestId('menu-page-indicator')).toHaveAttribute('aria-label', `Page ${index + 1} / 4`)
    for (const id of await page.getByTestId('menu-product-card').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-product-id')!))) seen.add(id)
  }
  expect(seen.size).toBe(26)
  expect(reads).toBeGreaterThanOrEqual(2)
})

test('existing menu and Customer Display keep their own catalog and polling behavior', async ({ page }) => {
  await mockOwner(page)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const data = menu()
  data.products = data.products.slice(0, 2)
  await page.route('**/api/public/menu?*', route => route.fulfill({ json: { ...data, store: { ...data.store, isOpen: true, checkoutMode: 'DIRECT_PAYMENT' }, customerBound: false } }))
  await page.goto('/menu?code=STORE-A')
  await expect(page.getByText(/^咖啡 1/).first()).toBeVisible()
  await expect(page.getByText('$4.50', { exact: true }).first()).toBeVisible()
  await expect(page.getByTestId('electronic-menu-screen')).toHaveCount(0)
  let polls = 0
  await page.route('**/api/pos/session/current?*', route => {
    polls++
    expect(new URL(route.request().url()).searchParams.get('storeCode')).toBe('STORE-A')
    return route.fulfill({ json: { storeCode: 'STORE-A', storeName: 'Existing Customer Display', serverNow: new Date().toISOString(), session: null, displayProducts: [] } })
  })
  await page.goto('/desktop/display?storeCode=STORE-A&lang=en')
  await expect(page.getByText('Existing Customer Display', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Waiting for items', { exact: true })).toBeVisible()
  await expect.poll(() => polls).toBeGreaterThanOrEqual(2)
  await expect(page.getByTestId('electronic-menu-screen')).toHaveCount(0)
  expect(errors).toEqual([])
})

async function mockOwner(page: Page, code: string | null = 'STORE-A') {
  await blockExternal(page)
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/status') return route.fulfill({ json: { ok: true } })
    if (path === '/api/me') return route.fulfill({ json: { tier: 'STANDARD', storeName: 'Owner Store', storeCode: code, tenantName: 'Owner Tenant', currencyCode: 'USD' } })
    if (path === '/api/stores' || path === '/api/admin/users') return route.fulfill({ json: [] })
    if (path === '/api/summary') return route.fulfill({ json: { totalSaleAmount: 0, totalRefundAmount: 0, netAmount: 0, saleOrderCount: 0, refundOrderCount: 0, topProducts: [] } })
    return route.fulfill({ json: {} })
  })
}

test('OWNER can open, copy or manually select the canonical URL; preview is a separate document', async ({ page, context }) => {
  await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'fixture', userId: 'owner', storeId: 'a', role: 'OWNER' }), url: baseURL }])
  await mockOwner(page)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { document.documentElement.dataset.copied = value } } })
  })
  await page.goto('/dashboard')
  await page.getByTestId('electronic-menu-entry').click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible()
  const url = page.locator('#electronic-menu-url')
  await expect(url).toHaveValue(/\/electronic-menu\?code=STORE-A&lang=zh$/)
  await modal.getByRole('button', { name: '复制链接', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-copied', await url.inputValue())
  const preview = modal.getByRole('link', { name: '预览菜单屏' })
  await expect(preview).toHaveAttribute('target', '_blank')
  await expect(preview).toHaveAttribute('rel', 'noopener noreferrer')
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied') } } }) })
  await modal.getByRole('button', { name: '已复制', exact: true }).click()
  await expect(modal.getByRole('status')).toContainText('复制失败')
  await expect(url).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal).not.toBeVisible()
})

test('OWNER without a resolved store gets no usable URL', async ({ page, context }) => {
  await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'fixture', userId: 'owner', storeId: 'a', role: 'OWNER' }), url: baseURL }])
  await mockOwner(page, null)
  await page.goto('/dashboard')
  await page.getByTestId('electronic-menu-entry').click()
  await expect(page.locator('#electronic-menu-url')).toHaveValue('')
  await expect(page.getByRole('button', { name: '复制链接', exact: true })).toBeDisabled()
  await expect(page.getByRole('link', { name: '预览菜单屏' })).toHaveCount(0)
})

test('STAFF cannot access the OWNER entry', async ({ page, context }) => {
  await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'fixture', userId: 'staff', storeId: 'a', role: 'STAFF' }), url: baseURL }])
  await mockOwner(page)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/home/)
  await expect(page.getByTestId('electronic-menu-entry')).toHaveCount(0)
})

test('OWNER preview opens a standalone public document; leaving it restores the merchant shell', async ({ page, context }) => {
  await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'fixture', userId: 'owner', storeId: 'a', role: 'OWNER' }), url: baseURL }])
  await mockOwner(page)
  // Context routes also cover the popup's initial document and first catalog read.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== new URL(baseURL).origin) return route.fulfill({ body: '' })
    if (url.pathname === '/api/public/electronic-menu') return route.fulfill({ json: menu() })
    return route.continue()
  })
  await page.goto('/dashboard')
  await page.getByTestId('electronic-menu-entry').click()
  // Build this local suite with NEXT_PUBLIC_PUBLIC_SITE_URL matching baseURL.
  const displayURL = await page.locator('#electronic-menu-url').inputValue()
  expect(new URL(displayURL).origin).toBe(new URL(baseURL).origin)
  const [display] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('link', { name: '预览菜单屏' }).click(),
  ])
  await expect(display).toHaveURL(displayURL)
  await expect(display.getByTestId('menu-product-card')).toHaveCount(8)
  await expect(display.locator('body')).toHaveAttribute('data-electronic-menu-document', 'true')
  await expect(display.getByTestId('electronic-menu-entry')).toHaveCount(0)
  await expect(display.locator('script[src*="telegram"]')).toHaveCount(0)
  await expect(page.getByTestId('electronic-menu-entry')).toBeVisible()
  await mockOwner(display)
  const ownerDocument = display.waitForRequest(request => request.isNavigationRequest() && request.resourceType() === 'document' && new URL(request.url()).pathname === '/dashboard')
  await display.evaluate(() => { window.history.pushState(null, '', '/dashboard') })
  await ownerDocument
  await expect(display.getByTestId('electronic-menu-entry')).toBeVisible()
  await expect(display.getByTestId('electronic-menu-screen')).toHaveCount(0)
  await expect(display.locator('body')).not.toHaveAttribute('data-electronic-menu-document', 'true')
  await display.close()
})

test('App Router navigation into the display reloads before mounting the catalog in the merchant document', async ({ page, context }) => {
  await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'fixture', userId: 'owner', storeId: 'a', role: 'OWNER' }), url: baseURL }])
  await mockOwner(page)
  let catalogReads = 0
  await page.route('**/api/public/electronic-menu?*', async route => {
    catalogReads++
    expect(await page.locator('body').getAttribute('data-electronic-menu-document')).toBe('true')
    await route.fulfill({ json: menu() })
  })
  await page.goto('/dashboard')
  await expect(page.getByTestId('electronic-menu-entry')).toBeVisible()
  await expect(page.locator('body')).not.toHaveAttribute('data-electronic-menu-document', 'true')
  const rsc = page.waitForRequest(request => new URL(request.url()).pathname === '/electronic-menu' && request.headers().rsc === '1')
  const document = page.waitForRequest(request => request.isNavigationRequest() && request.resourceType() === 'document' && new URL(request.url()).pathname === '/electronic-menu')
  // Next's redirect handler calls its real App Router.push. This exercises SPA
  // entry without adding a test-only Link/route or exposing a router in the app.
  const redirect = getRedirectError('/electronic-menu?code=STORE-A&lang=en', RedirectType.push)
  await page.evaluate(({ message, digest }) => {
    const error = Object.assign(new Error(message), { digest })
    window.dispatchEvent(new ErrorEvent('error', { error, cancelable: true }))
  }, { message: redirect.message, digest: redirect.digest })
  await rsc
  await document
  await expect(page.getByTestId('menu-product-card')).toHaveCount(8)
  await expect(page.getByTestId('electronic-menu-entry')).toHaveCount(0)
  await expect(page.locator('script[src*="telegram"]')).toHaveCount(0)
  expect(catalogReads).toBe(1)
})

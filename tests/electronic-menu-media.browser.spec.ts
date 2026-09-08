import { expect, test, type BrowserContext, type Page, type Request, type Route } from '@playwright/test'
import { signSession } from '../lib/session'
import type { ElectronicMenuData } from '../lib/electronic-menu'

// This suite requires a local production build with a fixture-only session secret.
// Every browser API request and external resource is intercepted before navigation.
const baseURL = process.env.ELECTRONIC_MENU_TEST_URL ?? 'http://127.0.0.1:3100'
test.use({ baseURL, extraHTTPHeaders: {}, viewport: { width: 1366, height: 768 } })
test.beforeEach(() => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname)
})

const BANNER = `${baseURL}/menu-media-fixture/banner-a.gif`
const DEDICATED = `${baseURL}/menu-media-fixture/dedicated-b.gif`
const REPLACEMENT = `${baseURL}/menu-media-fixture/dedicated-c.gif`
const PRODUCT = `${baseURL}/menu-media-fixture/product.gif`
const MEDIA_PATH = '/api/stores/a/electronic-menu-media'
const GIF = Buffer.from('R0lGODlhAQABAIAAAKa4m7+TfCH/C05FVFNDQVBFMi4wAwEAAAAh+QQEGQAAACwAAAAAAQABAAACAkQBACH5BAQZAAAALAAAAAABAAEAAAICTAEAOw==', 'base64')
const uploadFile = { name: 'original-promotion.gif', mimeType: 'image/gif', buffer: GIF }
const stores = [
  { id: 'other', code: 'STORE-OTHER', name: 'Other Store', checkoutMode: 'DIRECT_PAYMENT', currencyCode: 'USD', bannerUrl: null },
  { id: 'a', code: 'STORE-A', name: 'Owner Store', checkoutMode: 'DIRECT_PAYMENT', currencyCode: 'USD', bannerUrl: BANNER },
]

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

async function blockExternal(page: Page) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return url.origin === new URL(baseURL).origin ? route.continue() : route.fulfill({ status: 200, body: '', contentType: 'text/plain' })
  })
  await page.route('**/menu-media-fixture/**', route => route.fulfill({ contentType: 'image/gif', body: GIF }))
}

async function mockOwner(page: Page, context: BrowserContext, media: (route: Route) => Promise<void>, code = 'STORE-A') {
  await context.addCookies([{ name: 'auth-session', value: signSession({ tenantId: 'fixture', userId: 'owner', storeId: 'a', role: 'OWNER' }), url: baseURL }])
  await page.addInitScript(() => localStorage.setItem('lang', 'en'))
  await blockExternal(page)
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/electronic-menu-media')) {
      // The current store is deliberately second in /api/stores.
      expect(path).toBe(MEDIA_PATH)
      for (const header of ['x-tenant-id', 'x-user-id', 'x-store-id', 'x-role']) {
        expect(route.request().headers()[header]).toBeUndefined()
      }
      return media(route)
    }
    if (path === '/api/auth/status') return route.fulfill({ json: { ok: true } })
    if (path === '/api/me') return route.fulfill({ json: { tier: 'STANDARD', storeName: 'Owner Store', storeCode: code, tenantName: 'Owner Tenant', currencyCode: 'USD' } })
    if (path === '/api/stores') return route.fulfill({ json: stores })
    if (path === '/api/admin/users') return route.fulfill({ json: [] })
    if (path === '/api/summary') return route.fulfill({ json: { totalSaleAmount: 0, totalRefundAmount: 0, netAmount: 0, saleOrderCount: 0, refundOrderCount: 0, topProducts: [] } })
    return route.fulfill({ json: {} })
  })
}

async function openPanel(page: Page) {
  await page.goto('/dashboard')
  await page.getByTestId('electronic-menu-entry').click()
  const panel = page.getByTestId('electronic-menu-media-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading')).toHaveText('Menu screen image / GIF')
  return panel
}

async function expectOriginalGif(request: Request) {
  const contentType = request.headers()['content-type']
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
  const payload = request.postDataBuffer()
  expect(payload).not.toBeNull()
  const form = await new Response(Uint8Array.from(payload!), { headers: { 'Content-Type': contentType } }).formData()
  expect([...form.keys()]).toEqual(['file'])
  const file = form.get('file')
  expect(file).toBeInstanceOf(File)
  if (!(file instanceof File)) throw new Error('Expected an original file upload')
  expect(file.name).toBe(uploadFile.name)
  expect(file.type).toBe('image/gif')
  expect(Buffer.from(await file.arrayBuffer())).toEqual(GIF)
}

function catalog(): ElectronicMenuData {
  return {
    store: { code: 'STORE-A', name: 'Owner Store', currencyCode: 'USD', announcement: null, promoText: 'Fresh every day.', bannerUrl: BANNER, electronicMenuMediaUrl: DEDICATED },
    categories: [{ id: 'drinks', name: 'Coffee', parentId: null, sortOrder: 0 }],
    products: [{
      id: 'coffee', name: 'Coffee', nameEn: 'Coffee', nameZh: '咖啡', nameKm: 'កាហ្វេ',
      descZh: null, descEn: null, descKm: null, spec: null, price: 4.5, originalPrice: 4.5,
      discountEnabled: false, isRecommended: false, categoryId: 'drinks', imageUrl: PRODUCT, imageUrls: [],
    }],
  }
}

async function mockCatalog(page: Page, getData: () => ElectronicMenuData) {
  await blockExternal(page)
  let reads = 0
  await page.route('**/api/**', route => {
    expect(new URL(route.request().url()).pathname).toBe('/api/public/electronic-menu')
    expect(route.request().method()).toBe('GET')
    reads++
    return route.fulfill({ json: getData() })
  })
  return () => reads
}

test('OWNER uploads the original GIF, previews it and restores the unchanged homepage banner', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const methods: string[] = []
  let dedicated: string | null = null
  await mockOwner(page, context, async route => {
    const method = route.request().method()
    methods.push(method)
    if (method === 'POST') {
      await expectOriginalGif(route.request())
      dedicated = DEDICATED
      return route.fulfill({ json: { electronicMenuMediaUrl: dedicated } })
    }
    if (method === 'DELETE') {
      dedicated = null
      return route.fulfill({ json: { ok: true } })
    }
    expect(method).toBe('GET')
    return route.fulfill({ json: { electronicMenuMediaUrl: dedicated, bannerUrl: BANNER } })
  })
  await page.goto('/dashboard')
  await expect(page.getByTestId('electronic-menu-entry')).toBeVisible()
  expect(methods).toEqual([])
  await expect(page.getByTestId('electronic-menu-media-panel')).toHaveCount(0)
  await page.getByTestId('electronic-menu-entry').click()
  const panel = page.getByTestId('electronic-menu-media-panel')
  const preview = panel.getByTestId('electronic-menu-media-preview')
  await expect(preview).toHaveAttribute('src', BANNER)
  await panel.getByTestId('electronic-menu-media-file').setInputFiles(uploadFile)
  await expect(preview).toHaveAttribute('src', DEDICATED)
  await expect(panel.getByRole('status')).toHaveText('Menu screen image updated.')
  await expect(page.locator('#electronic-menu-url')).toHaveValue(/\/electronic-menu\?code=STORE-A&lang=en$/)
  await expect(page.getByRole('link', { name: 'Preview menu', exact: true })).toBeVisible()
  const dialog = page.getByRole('dialog')
  await page.setViewportSize({ width: 390, height: 600 })
  expect(await dialog.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  const bounds = await dialog.boundingBox()
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600)
  await page.screenshot({ path: 'test-results/electronic-menu-media-owner.png', fullPage: true })
  await panel.getByRole('button', { name: 'Restore homepage banner', exact: true }).click()
  await expect(preview).toHaveAttribute('src', BANNER)
  await expect(panel.getByRole('status')).toHaveText('Default display restored.')
  await expect(panel.getByRole('button', { name: 'Restore homepage banner', exact: true })).toHaveCount(0)
  expect(methods).toEqual(['GET', 'POST', 'DELETE', 'GET'])
})

test('failed mutations keep the preview and allow the same file to be selected again', async ({ page, context }) => {
  let posts = 0
  await mockOwner(page, context, async route => {
    const method = route.request().method()
    if (method === 'GET') return route.fulfill({ json: { electronicMenuMediaUrl: DEDICATED, bannerUrl: BANNER } })
    if (method === 'DELETE') return route.fulfill({ status: 503, json: { error: 'TEMPORARY_FAILURE' } })
    expect(method).toBe('POST')
    await expectOriginalGif(route.request())
    posts++
    return posts === 1 ? route.fulfill({ status: 503, json: { error: 'TEMPORARY_FAILURE' } }) : route.fulfill({ json: { electronicMenuMediaUrl: REPLACEMENT } })
  })
  const panel = await openPanel(page)
  const preview = panel.getByTestId('electronic-menu-media-preview')
  await expect(preview).toHaveAttribute('src', DEDICATED)
  const fileInput = panel.getByTestId('electronic-menu-media-file')
  await fileInput.setInputFiles(uploadFile)
  await expect(panel.getByRole('alert')).toContainText('Upload failed')
  await expect(preview).toHaveAttribute('src', DEDICATED)
  await expect(fileInput).toHaveValue('')
  await fileInput.setInputFiles(uploadFile)
  await expect(preview).toHaveAttribute('src', REPLACEMENT)
  expect(posts).toBe(2)
  await panel.getByRole('button', { name: 'Restore homepage banner', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('Restore or refresh failed')
  await expect(preview).toHaveAttribute('src', REPLACEMENT)
  await expect(panel.getByRole('button', { name: 'Replace image / GIF', exact: true })).toBeEnabled()
})

test('same-turn repeated file selections and competing restore cannot overlap a busy upload', async ({ page, context }) => {
  const held = deferred()
  let posts = 0
  let deletes = 0
  await mockOwner(page, context, async route => {
    const method = route.request().method()
    if (method === 'GET') return route.fulfill({ json: { electronicMenuMediaUrl: DEDICATED, bannerUrl: BANNER } })
    if (method === 'DELETE') { deletes++; return route.fulfill({ json: { ok: true } }) }
    posts++
    await expectOriginalGif(route.request())
    await held.promise
    await route.fulfill({ json: { electronicMenuMediaUrl: REPLACEMENT } }).catch(() => {})
  })
  const panel = await openPanel(page)
  await expect(panel.getByTestId('electronic-menu-media-preview')).toHaveAttribute('src', DEDICATED)
  try {
    await panel.getByTestId('electronic-menu-media-file').evaluate((element, fixture) => {
      const input = element as HTMLInputElement
      // Dispatch both changes in one task, before disabled state can re-render.
      for (let attempt = 0; attempt < 2; attempt++) {
        const transfer = new DataTransfer()
        transfer.items.add(new File([Uint8Array.from(fixture.bytes)], fixture.name, { type: 'image/gif' }))
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }, { bytes: [...GIF], name: uploadFile.name })
    await expect.poll(() => posts).toBe(1)
    await expect(panel.getByRole('button', { name: 'Replace image / GIF', exact: true })).toBeDisabled()
    const restore = panel.getByRole('button', { name: 'Restore homepage banner', exact: true })
    await expect(restore).toBeDisabled()
    await restore.dispatchEvent('click')
    expect(deletes).toBe(0)
    held.resolve()
    await expect(panel.getByTestId('electronic-menu-media-preview')).toHaveAttribute('src', REPLACEMENT)
    expect(posts).toBe(1)
    expect(deletes).toBe(0)
  } finally {
    held.resolve()
  }
})

test('closing and reopening ignores a late media load from the previous dialog', async ({ page, context }) => {
  const held = deferred()
  const staleFinished = deferred()
  let reads = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mockOwner(page, context, async route => {
    expect(route.request().method()).toBe('GET')
    if (++reads === 1) {
      await held.promise
      await route.fulfill({ json: { electronicMenuMediaUrl: DEDICATED, bannerUrl: BANNER } }).catch(() => {})
      staleFinished.resolve()
      return
    }
    return route.fulfill({ json: { electronicMenuMediaUrl: null, bannerUrl: BANNER } })
  })
  await openPanel(page)
  try {
    await expect.poll(() => reads).toBe(1)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('electronic-menu-media-panel')).toHaveCount(0)
    await page.getByTestId('electronic-menu-entry').click()
    await expect(page.getByTestId('electronic-menu-media-preview')).toHaveAttribute('src', BANNER)
    expect(reads).toBe(2)
    held.resolve()
    await staleFinished.promise
    await expect(page.getByTestId('electronic-menu-media-preview')).toHaveAttribute('src', BANNER)
    await expect(page.getByTestId('electronic-menu-media-panel').getByRole('button', { name: 'Upload image / GIF', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  } finally {
    held.resolve()
  }
})

test('an unmatched current store disables media writes without selecting the first store', async ({ page, context }) => {
  let mediaRequests = 0
  await mockOwner(page, context, async route => { mediaRequests++; await route.fulfill({ status: 500, json: {} }) }, 'STORE-MISSING')
  const panel = await openPanel(page)
  await expect(panel.getByRole('alert')).toHaveText('Could not load media. Please retry.')
  await expect(panel.getByRole('button', { name: 'Upload image / GIF', exact: true })).toBeDisabled()
  await expect(panel.getByTestId('electronic-menu-media-file')).toBeDisabled()
  await expect(panel.getByTestId('electronic-menu-media-preview')).toHaveCount(0)
  expect(mediaRequests).toBe(0)
})

test('public media falls back from dedicated to banner to product to the brand display', async ({ page }) => {
  await page.clock.install()
  const data = catalog()
  const reads = await mockCatalog(page, () => data)
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  const media = page.getByTestId('menu-brand-media')
  await expect(media.locator('img')).toHaveAttribute('src', DEDICATED)
  data.store.electronicMenuMediaUrl = null
  await page.clock.fastForward(30_100)
  await expect(media.locator('img')).toHaveAttribute('src', BANNER)
  data.store.bannerUrl = null
  await page.clock.fastForward(30_100)
  await expect(media.locator('img')).toHaveAttribute('src', PRODUCT)
  data.products[0].imageUrl = null
  await page.clock.fastForward(30_100)
  await expect(page.getByTestId('menu-brand-fallback')).toContainText('Fresh every day.')
  await expect(media.locator('img')).toHaveCount(0)
  await expect(page.locator('video')).toHaveCount(0)
  expect(reads()).toBe(4)
})

test('a failed dedicated GIF falls back to the existing banner', async ({ page }) => {
  const data = catalog()
  await mockCatalog(page, () => data)
  let failedReads = 0
  await page.route(DEDICATED, route => { failedReads++; return route.fulfill({ status: 503, body: '' }) })
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  const image = page.getByTestId('menu-brand-media').locator('img')
  await expect(image).toHaveAttribute('src', BANNER)
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1)
  expect(failedReads).toBe(1)
})

test('the next 30-second catalog refresh updates the dedicated URL without a document reload', async ({ page }) => {
  await page.clock.install()
  const data = catalog()
  const reads = await mockCatalog(page, () => data)
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  const image = page.getByTestId('menu-brand-media').locator('img')
  await expect(image).toHaveAttribute('src', DEDICATED)
  await page.locator('body').evaluate(body => body.dataset.mediaRefreshProof = 'same-document')
  data.store.electronicMenuMediaUrl = REPLACEMENT
  await page.clock.fastForward(29_000)
  await expect(image).toHaveAttribute('src', DEDICATED)
  expect(reads()).toBe(1)
  await page.clock.fastForward(1_100)
  await expect(image).toHaveAttribute('src', REPLACEMENT)
  expect(reads()).toBe(2)
  await expect(page.locator('body')).toHaveAttribute('data-media-refresh-proof', 'same-document')
})

test('the dedicated GIF renders changing native image frames', async ({ page }) => {
  await mockCatalog(page, catalog)
  await page.goto('/electronic-menu?code=STORE-A&lang=en')
  const image = page.getByTestId('menu-brand-media').locator('img')
  await expect(image).toHaveAttribute('src', DEDICATED)
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1)
  const firstFrame = await image.screenshot({ animations: 'allow' })
  await expect.poll(async () => Buffer.compare(firstFrame, await image.screenshot({ animations: 'allow' })), {
    timeout: 4_000, message: 'The dedicated GIF must display both original animation frames',
  }).not.toBe(0)
  await expect(page.locator('video')).toHaveCount(0)
})

import { expect, test, type Page } from '@playwright/test'

const baseURL = process.env.ELIFE_CATALOG_TEST_URL ?? 'http://127.0.0.1:3100'
const code = 'CATALOG-FIX-FIXTURE'
const name = (i: number) => `CATALOG-PRODUCT ${String(i).padStart(5, '0')}`
const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>').toString('base64')}`

test.use({ baseURL, extraHTTPHeaders: {}, viewport: { width: 390, height: 844 } })
test.beforeEach(() => {
  // This suite must never exercise a real merchant, order or payment endpoint.
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL).hostname)
})

function catalog(count: number) {
  return {
    store: { name: 'Catalog Test Store', isOpen: true, businessType: 'RETAIL', currencyCode: 'USD' },
    customerBound: false,
    categories: [
      { id: 'a', name: 'Category A', parentId: null, sortOrder: 0 },
      { id: 'b', name: 'Category B', parentId: null, sortOrder: 1 },
    ],
    products: Array.from({ length: count }, (_, i) => ({
      id: `product-${i}`, name: name(i), nameZh: name(i), nameEn: null, nameKm: null,
      spec: `Specification ${i}`, descZh: `Description ${i}`, descEn: null, descKm: null,
      price: 8, originalPrice: 10, discountEnabled: true, isRecommended: false,
      categoryId: i === count - 1 ? null : i % 2 ? 'b' : 'a',
      imageUrl: i === count - 1 ? image : null,
      imageUrls: i === count - 1 ? [image] : [], marketingImageUrls: [],
    })),
  }
}

async function setup(page: Page, count: number) {
  const errors: string[] = []
  const unexpected: string[] = []
  const orders: Array<{ body: { storeCode: string; items: Array<{ productId: string; quantity: number }> }; key: string | undefined }> = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => { localStorage.setItem('menu_lang', 'en') })
  const body = catalog(count)
  await page.route('**/*', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.protocol === 'data:') return route.continue()
    if (url.origin !== new URL(baseURL).origin) return route.fulfill({ body: '', contentType: 'text/plain' })
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/public/menu' && req.method() === 'GET') return route.fulfill({ json: body })
    if (url.pathname === '/api/public/payments/shinhan/config') return route.fulfill({ json: { enabled: false } })
    if (url.pathname === '/api/public/orders' && req.method() === 'POST') {
      orders.push({ body: req.postDataJSON(), key: req.headers()['idempotency-key'] })
      return route.fulfill({ json: { orderNo: 'C-LOCAL-FIXTURE', totalAmount: 8, status: 'PENDING' } })
    }
    if (url.pathname === '/api/auth/status') return route.fulfill({ json: { ok: true } })
    if (url.pathname === '/api/me') return route.fulfill({ json: {} })
    unexpected.push(`${req.method()} ${url.pathname}`)
    return route.fulfill({ status: 503, json: { error: 'UNEXPECTED_TEST_REQUEST' } })
  })
  return { body, errors, unexpected, orders }
}

test('2096-product menu retains complete search, category, detail, cart and submission behavior', async ({ page }, info) => {
  const f = await setup(page, 2096)
  const start = performance.now()
  await page.goto(`/menu?code=${code}`)
  await expect(page.getByText(/^CATALOG-PRODUCT \d{5}$/)).toHaveCount(2096)
  const initialRenderMs = performance.now() - start

  await page.getByRole('button', { name: 'Category B', exact: true }).click()
  await expect(page.getByText(/^CATALOG-PRODUCT \d{5}$/)).toHaveCount(1047)
  await page.getByRole('button', { name: 'All Items', exact: true }).click()
  const search = page.getByPlaceholder('Search products…')
  await search.fill(name(2095))
  await expect(page.getByText(/^CATALOG-PRODUCT \d{5}$/)).toHaveCount(1)
  const card = page.getByText(name(2095), { exact: true }).locator('..').locator('..')
  await expect(card.getByText('Specification 2095', { exact: true })).toBeVisible()
  await expect(card.getByText('Description 2095', { exact: true })).toBeVisible()
  await card.getByRole('img', { name: name(2095), exact: true }).click()
  await expect(page.getByRole('img', { name: `${name(2095)} 1`, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'close', exact: true }).click()
  await card.getByRole('button', { name: '+', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Checkout', exact: true })).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Checkout', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Checkout', exact: true }).click()
  await expect(page.getByText('Confirm Order', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Place Order', exact: true }).click()
  await expect(page.getByText('Order submitted', { exact: true })).toBeVisible()
  expect(f.orders).toHaveLength(1)
  expect(f.orders[0].body.storeCode).toBe(code)
  expect(f.orders[0].body.items).toEqual([{ productId: 'product-2095', quantity: 1 }])
  expect(f.orders[0].key).toMatch(/^[0-9a-f-]{36}$/)
  expect(f.errors).toEqual([])
  expect(f.unexpected).toEqual([])
  console.log('CATALOG_PERFORMANCE', JSON.stringify({ count: 2096, initialRenderMs, responseBytes: Buffer.byteLength(JSON.stringify(f.body)) }))
  await info.attach('catalog-performance.json', { body: JSON.stringify({ count: 2096, initialRenderMs, responseBytes: Buffer.byteLength(JSON.stringify(f.body)), mode: 'local synthetic browser; order API intercepted' }), contentType: 'application/json' })
})

test('5000-product menu remains complete and can search the final item within the local performance budget', async ({ page }, info) => {
  test.setTimeout(60_000)
  const f = await setup(page, 5000)
  const start = performance.now()
  await page.goto(`/menu?code=${code}`)
  await expect(page.getByText(/^CATALOG-PRODUCT \d{5}$/)).toHaveCount(5000, { timeout: 30_000 })
  const initialRenderMs = performance.now() - start
  const searchStart = performance.now()
  await page.getByPlaceholder('Search products…').fill(name(4999))
  await expect(page.getByText(/^CATALOG-PRODUCT \d{5}$/)).toHaveCount(1)
  await expect(page.getByText(name(4999), { exact: true })).toBeVisible()
  const searchMs = performance.now() - searchStart
  expect(initialRenderMs).toBeLessThan(30_000)
  expect(searchMs).toBeLessThan(5000)
  expect(f.errors).toEqual([])
  expect(f.unexpected).toEqual([])
  console.log('CATALOG_PERFORMANCE', JSON.stringify({ count: 5000, initialRenderMs, searchMs, responseBytes: Buffer.byteLength(JSON.stringify(f.body)) }))
  await info.attach('catalog-performance.json', { body: JSON.stringify({ count: 5000, initialRenderMs, searchMs, responseBytes: Buffer.byteLength(JSON.stringify(f.body)), mode: 'local synthetic browser; not real-device FIELD' }), contentType: 'application/json' })
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright'

const cashierPage = fs.readFileSync('app/cashier/page.tsx', 'utf8')
const computerLaunchPage = fs.readFileSync('app/cashier/launch/page.tsx', 'utf8')
const runtimeBaseUrl = process.env.DESKTOP_POS_AUTH_RUNTIME_BASE_URL?.replace(/\/$/, '')
const chromePath = process.env.DESKTOP_POS_AUTH_CHROME_PATH?.trim()
const storeCode = 'STORE-A'
const tokenKey = `cashier:posDeviceToken:${storeCode}`

let cases = 0

async function test(name: string, run: () => void | Promise<void>) {
  await run()
  cases += 1
  console.log(`PASS ${name}`)
}

function jsonRoute(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

type RuntimeState = {
  accessCount: number
  authorizationStartCount: number
  authorizationStatusCount: number
  accessHeaders: Array<Record<string, string>>
  cashierHeaders: Array<Record<string, string>>
}

type AccessResult =
  | { kind: 'response'; status: number; body: Record<string, unknown> }
  | { kind: 'network-reject' }

async function createRuntimePage(
  browser: Browser,
  options: {
    token?: string
    access: (headers: Record<string, string>) => AccessResult
    authorizationStatus?: 'PENDING' | 'APPROVED'
  },
): Promise<{ context: BrowserContext; page: Page; state: RuntimeState }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(({ initialToken, storageKey }) => {
    localStorage.setItem('lang', 'zh')
    localStorage.setItem('cashier:deviceId', 'desktop-pos-auth-test-device')
    if (initialToken) localStorage.setItem(storageKey, initialToken)
  }, { initialToken: options.token ?? '', storageKey: tokenKey })

  const page = await context.newPage()
  const state: RuntimeState = {
    accessCount: 0,
    authorizationStartCount: 0,
    authorizationStatusCount: 0,
    accessHeaders: [],
    cashierHeaders: [],
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = request.headers()

    if (url.pathname === '/api/cashier/access') {
      state.accessCount += 1
      state.accessHeaders.push(headers)
      const result = options.access(headers)
      if (result.kind === 'network-reject') return route.abort('failed')
      return jsonRoute(route, result.body, result.status)
    }
    if (url.pathname === '/api/cashier/store') {
      return jsonRoute(route, {
        storeName: 'Desktop POS Auth Test Store',
        storeId: 'store-a',
        tenantId: 'tenant-a',
        currencyCode: 'USD',
        products: [],
        categories: [],
        printKitchenTicket: false,
      })
    }
    if (url.pathname === '/api/cashier/device-authorization/start') {
      state.authorizationStartCount += 1
      return jsonRoute(route, {
        requestId: 'request-a',
        authorizeUrl: `${runtimeBaseUrl}/cashier/device-authorization/request-a`,
        storeName: 'Desktop POS Auth Test Store',
      })
    }
    if (url.pathname === '/api/cashier/device-authorization/status') {
      state.authorizationStatusCount += 1
      if (options.authorizationStatus === 'APPROVED') {
        return jsonRoute(route, { status: 'APPROVED', token: 'approved-pos-token' })
      }
      return jsonRoute(route, { status: 'PENDING' })
    }
    if (url.pathname === '/api/cashier/orders' || url.pathname === '/api/cashier/pending-orders') {
      state.cashierHeaders.push(headers)
      return jsonRoute(route, [])
    }
    if (url.pathname === '/api/me') {
      return jsonRoute(route, {
        role: 'OWNER',
        tier: 'STANDARD',
        checkoutMode: 'DIRECT_PAYMENT',
        storeName: 'Desktop POS Auth Test Store',
      })
    }
    return jsonRoute(route, {})
  })

  return { context, page, state }
}

async function waitForCashier(page: Page) {
  await page.getByRole('button', { name: '销售记录' }).first().waitFor({
    state: 'visible',
    timeout: 30_000,
  })
}

async function waitForBrowserCashier(page: Page) {
  await page.getByRole('button', { name: /完成销售/ }).waitFor({
    state: 'visible',
    timeout: 30_000,
  })
}

async function waitForDeviceAuthorization(page: Page) {
  await page.getByRole('heading', { name: '本机尚未授权为收银机' }).waitFor({
    state: 'visible',
    timeout: 30_000,
  })
}

async function main() {
  await test('Desktop context is a device-authorization context, not an authorization bypass', () => {
    assert.match(cashierPage, /function usesPosDeviceAuthorizationFlow\(\)/)
    assert.match(cashierPage, /window\.location\.pathname === '\/desktop\/pos'/)
    assert.match(cashierPage, /params\.get\('from'\) === 'desktop'/)
    assert.match(cashierPage, /params\.get\('deviceAuth'\) === '1'/)
    assert.doesNotMatch(cashierPage, /desktopPublicEntry \|\| existingDeviceToken \? 'authorized'/)
  })

  await test('all entries start checking and use the existing access probe', () => {
    assert.match(cashierPage, /setPosAccountAccess\('checking'\)[\s\S]*apiFetch\(`\/api\/cashier\/access\?storeCode=/)
    assert.match(cashierPage, /const cashierAuthorized = Boolean\(storeCode && posAccountAccess === 'authorized'\)/)
    assert.doesNotMatch(cashierPage, /const cashierAuthorized = Boolean\(storeCode && \(posDeviceToken \|\|/)
  })

  await test('only explicit 401 or 403 invalidates a cached POS token', () => {
    assert.match(cashierPage, /const explicitAuthorizationFailure = r\.status === 401 \|\| r\.status === 403/)
    assert.match(cashierPage, /if \(existingDeviceToken && !explicitAuthorizationFailure\) \{[\s\S]*setPosAccountAccess\('authorized'\)/)
    assert.match(cashierPage, /if \(existingDeviceToken\) \{[\s\S]*clearPosDeviceToken\(sc\)[\s\S]*setPosDeviceToken\(''\)/)
    assert.match(cashierPage, /\.catch\(\(\) => \{[\s\S]*if \(existingDeviceToken\) \{[\s\S]*setPosAccountAccess\('authorized'\)/)
  })

  await test('existing QR approval persists the token and authorizes the cashier state', () => {
    assert.match(cashierPage, /savePosDeviceToken\(storeCode, body\.token\)[\s\S]*setPosAccountAccess\('authorized'\)/)
  })

  await test('Computer Client launch still saves the existing POS token and enters Desktop POS', () => {
    assert.match(computerLaunchPage, /savePosDeviceToken\(body\.storeCode, body\.posDeviceToken\)/)
    assert.match(computerLaunchPage, /window\.location\.replace\(`\/desktop\/pos\?\$\{nextParams\.toString\(\)\}`\)/)
    assert.match(computerLaunchPage, /new URLSearchParams\(\{ storeCode: body\.storeCode, mode: 'pos' \}\)/)
  })

  assert.ok(runtimeBaseUrl, 'DESKTOP_POS_AUTH_RUNTIME_BASE_URL is required')
  const browser = await chromium.launch({
    headless: true,
    ...(chromePath ? { executablePath: chromePath } : {}),
  })

  try {
    await test('Desktop first use without a token enters QR authorization, not /relogin', async () => {
      const runtime = await createRuntimePage(browser, {
        access: () => ({ kind: 'response', status: 401, body: { error: 'LOGIN_REQUIRED' } }),
      })
      try {
        await runtime.page.goto(`${runtimeBaseUrl}/desktop/pos?storeCode=${storeCode}&lang=zh&mode=pos`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await waitForDeviceAuthorization(runtime.page)
        assert.equal(new URL(runtime.page.url()).pathname, '/desktop/pos')
        assert.equal(runtime.state.accessCount, 1)
        assert.equal(runtime.state.authorizationStartCount, 1)
      } finally {
        await runtime.context.close()
      }
    })

    await test('a valid Desktop token passes the access probe and opens the cashier directly', async () => {
      const runtime = await createRuntimePage(browser, {
        token: 'valid-pos-token',
        access: (headers) => ({
          kind: 'response',
          status: headers['x-pos-device-token'] === 'valid-pos-token' ? 200 : 403,
          body: headers['x-pos-device-token'] === 'valid-pos-token' ? { ok: true } : { error: 'FORBIDDEN' },
        }),
      })
      try {
        await runtime.page.goto(`${runtimeBaseUrl}/desktop/pos?storeCode=${storeCode}&lang=zh&mode=pos`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await waitForCashier(runtime.page)
        assert.equal(runtime.state.accessCount, 1)
        assert.equal(runtime.state.accessHeaders[0]['x-pos-device-token'], 'valid-pos-token')
        assert.equal(runtime.state.authorizationStartCount, 0)
      } finally {
        await runtime.context.close()
      }
    })

    for (const status of [401, 403]) {
      await test(`a stale Desktop token receiving explicit ${status} re-enters QR authorization`, async () => {
        const runtime = await createRuntimePage(browser, {
          token: `stale-${status}`,
          access: () => ({
            kind: 'response',
            status,
            body: { error: status === 401 ? 'LOGIN_REQUIRED' : 'FORBIDDEN' },
          }),
        })
        try {
          await runtime.page.goto(`${runtimeBaseUrl}/desktop/pos?storeCode=${storeCode}&lang=zh&mode=pos`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          await waitForDeviceAuthorization(runtime.page)
          assert.equal(await runtime.page.evaluate((key) => localStorage.getItem(key), tokenKey), null)
          assert.equal(new URL(runtime.page.url()).pathname, '/desktop/pos')
          assert.equal(runtime.state.authorizationStartCount, 1)
        } finally {
          await runtime.context.close()
        }
      })
    }

    await test('QR approval stores the token, sends it to cashier APIs, and reloads without repeated authorization', async () => {
      const runtime = await createRuntimePage(browser, {
        access: (headers) => {
          const valid = headers['x-pos-device-token'] === 'approved-pos-token'
          return {
            kind: 'response',
            status: valid ? 200 : 401,
            body: valid ? { ok: true } : { error: 'LOGIN_REQUIRED' },
          }
        },
        authorizationStatus: 'APPROVED',
      })
      try {
        await runtime.page.goto(`${runtimeBaseUrl}/desktop/pos?storeCode=${storeCode}&lang=zh&mode=pos`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await waitForDeviceAuthorization(runtime.page)
        await runtime.page.getByRole('button', { name: '我已授权，重新检查' }).click()
        await waitForCashier(runtime.page)
        assert.equal(await runtime.page.evaluate((key) => localStorage.getItem(key), tokenKey), 'approved-pos-token')
        await runtime.page.waitForFunction(() => (
          performance.getEntriesByType('resource').some((entry) => entry.name.includes('/api/cashier/orders'))
        ))
        assert.ok(runtime.state.cashierHeaders.some((headers) => headers['x-pos-device-token'] === 'approved-pos-token'))
        const authorizationStarts = runtime.state.authorizationStartCount

        await runtime.page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
        await waitForCashier(runtime.page)
        assert.equal(runtime.state.authorizationStartCount, authorizationStarts)
        assert.equal(runtime.state.accessCount, 2)
      } finally {
        await runtime.context.close()
      }
    })

    await test('Browser network rejection with a cached token preserves the existing offline tolerance', async () => {
      const runtime = await createRuntimePage(browser, {
        token: 'offline-cached-token',
        access: () => ({ kind: 'network-reject' }),
      })
      try {
        await runtime.page.goto(`${runtimeBaseUrl}/cashier?storeCode=${storeCode}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await waitForBrowserCashier(runtime.page)
        assert.equal(await runtime.page.evaluate((key) => localStorage.getItem(key), tokenKey), 'offline-cached-token')
        assert.equal(runtime.state.accessCount, 1)
        assert.equal(runtime.state.authorizationStartCount, 0)
      } finally {
        await runtime.context.close()
      }
    })

    for (const role of ['OWNER', 'STAFF']) {
      await test(`logged ${role} Browser cashier remains authorized through the existing access probe`, async () => {
        const runtime = await createRuntimePage(browser, {
          access: () => ({ kind: 'response', status: 200, body: { ok: true, role } }),
        })
        try {
          await runtime.page.goto(`${runtimeBaseUrl}/cashier?storeCode=${storeCode}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          await waitForBrowserCashier(runtime.page)
          assert.equal(runtime.state.accessCount, 1)
          assert.equal(runtime.state.authorizationStartCount, 0)
        } finally {
          await runtime.context.close()
        }
      })
    }

    await test('a valid Browser POS token remains accepted without entering QR authorization', async () => {
      const runtime = await createRuntimePage(browser, {
        token: 'browser-pos-token',
        access: (headers) => ({
          kind: 'response',
          status: 200,
          body: { ok: headers['x-pos-device-token'] === 'browser-pos-token' },
        }),
      })
      try {
        await runtime.page.goto(`${runtimeBaseUrl}/cashier?storeCode=${storeCode}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        })
        await waitForBrowserCashier(runtime.page)
        assert.equal(await runtime.page.evaluate((key) => localStorage.getItem(key), tokenKey), 'browser-pos-token')
        assert.equal(runtime.state.accessHeaders[0]['x-pos-device-token'], 'browser-pos-token')
        assert.equal(runtime.state.authorizationStartCount, 0)
      } finally {
        await runtime.context.close()
      }
    })
  } finally {
    await browser.close()
  }

  console.log(`PASS desktop-pos-web-auth-compat (${cases} cases)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

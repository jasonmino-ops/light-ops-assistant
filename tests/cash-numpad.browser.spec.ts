import { expect, test, type Page } from '@playwright/test'

const baseURL = process.env.CASH_BROWSER_URL ?? 'http://127.0.0.1:3151'
test.use({ baseURL, extraHTTPHeaders: {}, viewport: { width: 1366, height: 768 }, hasTouch: true })
test.beforeEach(() => expect(['localhost','127.0.0.1']).toContain(new URL(baseURL).hostname))

async function cashier(page: Page, currencyCode = 'USD', rate: number | null = null) {
  const sales: Record<string, unknown>[] = []
  const errors: string[] = []
  const control = { storeOffline: false }
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(rate => {
    localStorage.setItem('lang','en')
    if (rate !== null && localStorage.getItem('cashier:usdKhrRate') === null) localStorage.setItem('cashier:usdKhrRate',String(rate))
  },rate)
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin ? route.continue() : route.fulfill({status:200,body:''}))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/cashier/store' && control.storeOffline) return route.abort()
    if (path === '/api/cashier/store') return route.fulfill({json:{tenantId:'helper-test',storeId:'helper-store',storeCode:'CASH-UI',storeName:'Cash helper test',currencyCode,products:[{id:'helper-product',barcode:'CASH-PRODUCT',name:'Cash fixture item',spec:null,sellPrice:7.30,categoryId:null,imageUrl:null,status:'ACTIVE'}],categories:[]}})
    if (path === '/api/cashier/sales') {
      const payload = route.request().postDataJSON(); sales.push(payload)
      // The unchanged server response deliberately has no tender/currency/rate metadata.
      return route.fulfill({status:201,json:{orderNo:`HELPER-${sales.length}`,totalAmount:7.30,paymentMethod:payload.paymentMethod,paymentIntentId:`PI-${sales.length}`,createdAt:new Date().toISOString()}})
    }
    if (path === '/api/me') return route.fulfill({json:{tier:'STANDARD',storeName:'Cash helper test',storeCode:'CASH-UI',currencyCode}})
    if (['/api/cashier/orders','/api/cashier/pending-orders','/api/stores'].includes(path)) return route.fulfill({json:[]})
    return route.fulfill({json:{ok:true}})
  })
  await page.goto('/cashier?storeCode=CASH-UI')
  await expect(page.getByText('Cash fixture item',{exact:true})).toBeVisible()
  return {sales,errors,control}
}
async function openCash(page: Page) {
  await page.getByText('Cash fixture item',{exact:true}).first().click()
  await page.getByRole('button',{name:'✓ Confirm order',exact:true}).click()
  await page.getByRole('button',{name:'Confirm order, choose payment',exact:true}).click()
  await page.getByRole('button',{name:/^Cash payment/}).click()
  await expect(page.locator('#desktop-cash-tendered')).toBeVisible()
}
const amount = (page: Page) => page.locator('#desktop-cash-tendered')
const confirm = (page: Page) => page.getByRole('button',{name:'Confirm cash received and complete sale',exact:true})
const keypad = (page: Page) => page.getByRole('group',{name:'Cash numpad',exact:true})
const mode = (page: Page, code: string) => page.getByRole('button',{name:code,exact:true})
const originalPayload = {storeCode:'CASH-UI',items:[{barcode:'CASH-PRODUCT',quantity:1}],paymentMethod:'CASH',manualPaymentConfirmed:false}

test('USD mouse/physical keyboard, clear/backspace, cents and scanner/Enter isolation', async ({page}) => {
  const {sales,errors} = await cashier(page)
  await openCash(page)
  for (const key of ['7','.','3','0']) await keypad(page).getByRole('button',{name:key,exact:true}).click()
  await expect(amount(page)).toHaveValue('7.30')
  await expect(confirm(page)).toBeEnabled()
  await keypad(page).getByRole('button',{name:'Backspace',exact:true}).click()
  await expect(amount(page)).toHaveValue('7.3')
  await keypad(page).getByRole('button',{name:'Clear',exact:true}).click()
  await keypad(page).getByRole('button',{name:'1',exact:true}).click()
  await page.waitForTimeout(650) // spans the existing scanner's 300ms focus-reclaim ticks
  await expect(amount(page)).toBeFocused()
  await page.keyboard.type('0')
  await expect(page.locator('output')).toHaveText('$2.70')
  const clear = keypad(page).getByRole('button',{name:'Clear',exact:true})
  await clear.focus(); await page.waitForTimeout(650); await expect(clear).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(amount(page)).toHaveValue(''); await expect(confirm(page)).toBeDisabled(); expect(sales).toHaveLength(0)
  await page.keyboard.type('.5'); await expect(amount(page)).toHaveValue('0.5')
  await amount(page).fill('10'); await amount(page).fill('1e5'); await expect(amount(page)).toHaveValue('10')
  await expect(page.locator('output')).toHaveText('$2.70')
  await page.screenshot({path:'/private/tmp/cash-helper-ui-usd.png',fullPage:true})
  expect(errors).toEqual([])
})

test('KHR touch helper: integers, formatted reference/change, insufficient rejection', async ({page}) => {
  const {sales,errors} = await cashier(page)
  await openCash(page); await mode(page,'KHR').tap()
  await expect(page.getByText('$1 = ៛4,100',{exact:true})).toBeVisible()
  await expect(page.getByText('៛29,930',{exact:true})).toBeVisible()
  await expect(page.getByText('KHR conversion helper · Sale recorded in USD',{exact:true})).toBeVisible()
  for (const key of ['3','0','0','0','0']) await keypad(page).getByRole('button',{name:key,exact:true}).tap()
  await page.waitForTimeout(650); await expect(amount(page)).toBeFocused()
  await expect(page.locator('output')).toHaveText('៛70')
  await expect(page.getByText('៛30,000',{exact:true})).toBeVisible()
  for (const invalid of ['30000.5','-1','a','30,000']) { await amount(page).fill(invalid); await expect(amount(page)).toHaveValue('30000') }
  await expect(keypad(page).getByRole('button',{name:'.',exact:true})).toHaveCount(0)
  await amount(page).fill('50000'); await expect(page.locator('output')).toHaveText('៛20,070')
  await page.screenshot({path:'/private/tmp/cash-helper-ui-khr.png',fullPage:true})
  await amount(page).fill('20000'); await expect(confirm(page)).toBeDisabled(); expect(sales).toHaveLength(0)
  expect(errors).toEqual([])
})

test('consecutive USD/KHR/USD: helper resets, original Cash USD sale payload unchanged', async ({page}) => {
  const {sales} = await cashier(page)
  for (const [currency,received,change] of [['USD','10','$2.70'],['KHR','30000','៛70'],['USD','10','$2.70']]) {
    await openCash(page)
    await expect(mode(page,'USD')).toHaveAttribute('aria-pressed','true')
    await expect(amount(page)).toHaveValue(''); await expect(confirm(page)).toBeDisabled()
    await mode(page,currency).click(); await amount(page).fill(received)
    await expect(page.locator('output')).toHaveText(change)
    await confirm(page).tap(); await page.getByRole('button',{name:'Continue',exact:true}).click()
  }
  expect(sales).toEqual([originalPayload,originalPayload,originalPayload])
})

test('currency/method/cancel resets tender and helper mode', async ({page}) => {
  await cashier(page); await openCash(page)
  await amount(page).fill('10'); await mode(page,'KHR').click(); await expect(amount(page)).toHaveValue('')
  await amount(page).fill('30000')
  await page.getByRole('button',{name:/^KHQR payment/}).click()
  await page.getByRole('button',{name:/^Cash payment/}).click()
  await expect(mode(page,'USD')).toHaveAttribute('aria-pressed','true'); await expect(amount(page)).toHaveValue('')
  await mode(page,'KHR').click(); await amount(page).fill('30000')
  await page.getByRole('button',{name:'Back to edit items',exact:true}).click()
  await page.getByRole('button',{name:'✓ Confirm order',exact:true}).click()
  await page.getByRole('button',{name:'Confirm order, choose payment',exact:true}).click()
  await page.getByRole('button',{name:/^Cash payment/}).click()
  await expect(mode(page,'USD')).toHaveAttribute('aria-pressed','true'); await expect(amount(page)).toHaveValue('')
})

test('existing device localStorage rate and edit persist without any backend config', async ({page}) => {
  await cashier(page,'USD',4000)
  await openCash(page); await mode(page,'KHR').click(); await amount(page).fill('30000')
  await expect(page.getByText('$1 = ៛4,000',{exact:true})).toBeVisible()
  await expect(page.locator('output')).toHaveText('៛800')
  await page.getByRole('button',{name:'Back to edit items',exact:true}).click()
  page.once('dialog',dialog=>dialog.accept('4100'))
  await page.getByRole('button',{name:'Edit',exact:true}).click()
  expect(await page.evaluate(()=>localStorage.getItem('cashier:usdKhrRate'))).toBe('4100')
  await page.reload()
  await openCash(page)
  await expect(page.getByText('$1 = ៛4,100',{exact:true})).toBeVisible()
})

for (const viewport of [{width:1024,height:768},{width:768,height:1024}]) test(`tablet touch ${viewport.width}x${viewport.height}: keypad and completion reachable`, async ({page}) => {
  await page.setViewportSize(viewport)
  const {errors} = await cashier(page); await openCash(page)
  await mode(page,'KHR').tap()
  for (const key of ['5','0','0','0','0']) await keypad(page).getByRole('button',{name:key,exact:true}).tap()
  await expect(page.locator('output')).toHaveText('៛20,070')
  for (const target of [amount(page),page.locator('output'),confirm(page),page.getByRole('button',{name:'Back to edit items',exact:true}),...await keypad(page).getByRole('button').all()]) await expect(target).toBeInViewport({ratio:1})
  for (const button of await keypad(page).getByRole('button').all()) { const rect=(await button.boundingBox())!; expect(rect.width).toBeGreaterThanOrEqual(48); expect(rect.height).toBeGreaterThanOrEqual(48) }
  await page.screenshot({path:`/private/tmp/cash-helper-ui-tablet-${viewport.width}.png`,fullPage:true})
  expect(errors).toEqual([])
})

test('XAF preserves the original cash input and payload without a KHR helper', async ({page}) => {
  const {sales} = await cashier(page,'XAF'); await openCash(page)
  await expect(mode(page,'KHR')).toHaveCount(0); await expect(keypad(page)).toHaveCount(0)
  await amount(page).fill('10'); await confirm(page).click()
  expect(sales).toEqual([originalPayload])
})

for (const currency of ['USD','KHR']) test(`offline ${currency} input saves the existing USD offline order contract`, async ({page}) => {
  const {sales,control} = await cashier(page)
  await page.waitForFunction(async () => await new Promise<boolean>(resolve => {
    const request=indexedDB.open('light_ops_cashier_offline')
    request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('cashier_products')){db.close();resolve(false);return}const count=db.transaction('cashier_products').objectStore('cashier_products').count();count.onsuccess=()=>{db.close();resolve(count.result>0)}}
    request.onerror=()=>resolve(false)
  }))
  control.storeOffline=true
  await page.addInitScript(()=>Object.defineProperty(Navigator.prototype,'onLine',{get:()=>false,configurable:true}))
  await page.reload(); await expect(page.getByText('Cash fixture item',{exact:true})).toBeVisible()
  await openCash(page); await mode(page,currency).click(); await amount(page).fill(currency === 'USD' ? '10' : '30000'); await confirm(page).click()
  await expect(page.getByText('离线订单已保存，网络恢复后请同步',{exact:true})).toBeVisible()
  expect(sales).toHaveLength(0)
  const orders = await page.evaluate(async () => await new Promise<Record<string, unknown>[]>(resolve=>{
    const request=indexedDB.open('light_ops_cashier_offline');request.onsuccess=()=>{const db=request.result;const read=db.transaction('cashier_offline_orders').objectStore('cashier_offline_orders').getAll();read.onsuccess=()=>{db.close();resolve(read.result)}}
  }))
  expect(orders).toHaveLength(1);expect(orders[0]).toMatchObject({totalAmount:7.30,paymentMethod:'CASH',paymentStatus:'PAID_OFFLINE'})
  for (const key of ['cashCurrency','cashReceivedAmount','cashExchangeRate','cashSettlement']) expect(orders[0]).not.toHaveProperty(key)
})

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { browserPosCustomerDisplayPath } from '../lib/browser-pos-customer-display'

assert.equal(
  browserPosCustomerDisplayPath(' ST169E7000 ', 'zh'),
  '/desktop/display?storeCode=ST169E7000&lang=zh',
)
assert.equal(
  browserPosCustomerDisplayPath('STORE A&B', 'km'),
  '/desktop/display?storeCode=STORE+A%26B&lang=km',
)
assert.equal(browserPosCustomerDisplayPath('', 'en'), null)
assert.equal(browserPosCustomerDisplayPath(null, 'en'), null)

const cashierPage = fs.readFileSync('app/cashier/page.tsx', 'utf8')
assert.match(cashierPage, /openCustomerDisplay: '打开顾客屏'/)
assert.match(cashierPage, /openCustomerDisplay: 'Open Customer Display'/)
assert.match(cashierPage, /openCustomerDisplay: 'បើកអេក្រង់អតិថិជន'/)
assert.match(cashierPage, /browserPosCustomerDisplayPath\(storeCode, lang as DeskLang\)/)
assert.match(cashierPage, /window\.open\(target, '_blank', 'noopener,noreferrer'\)/)
assert.match(cashierPage, /disabled=\{!storeCode\}/)

console.log('browser POS customer display entry tests passed')

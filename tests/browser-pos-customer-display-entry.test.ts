import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { browserPosCustomerDisplayPath } from '../lib/browser-pos-customer-display'

assert.equal(
  browserPosCustomerDisplayPath('STORE-A', 'km'),
  '/desktop/display?storeCode=STORE-A&lang=km',
  'the Browser POS customer-display link must preserve the authorized store and current language',
)
assert.equal(
  browserPosCustomerDisplayPath('STORE A&next=/desktop/pos', 'zh'),
  '/desktop/display?storeCode=STORE+A%26next%3D%2Fdesktop%2Fpos&lang=zh',
  'store codes must be encoded as data rather than allowing query injection',
)
assert.equal(browserPosCustomerDisplayPath('   ', 'en'), null,
  'missing store context must not construct a display URL')

const pos = readFileSync('app/desktop/pos/page.tsx', 'utf8')

assert.match(pos, /打开顾客显示屏/, 'the bound Browser POS must expose a visible customer-display entry')
assert.match(pos, /browserPosCustomerDisplayPath\(boundStoreCode, lang\)/,
  'the entry must use only the authorized POS store context')
assert.match(pos, /window\.open\('about:blank', '_blank'\)/,
  'the customer display must open in a separate tab or window')
assert.match(pos, /displayWindow\.opener = null/,
  'the separate display must not retain a window opener')
assert.match(pos, /displayWindow\.location\.replace\(displayPath\)/,
  'the new tab must receive the constrained display URL')
assert.match(pos, /if \(!displayPath\)[\s\S]*无法打开顾客显示屏/,
  'missing store context must show an explicit error without opening a display page')
assert.match(pos, /getPosDeviceToken\(storeCode\)/,
  'the existing Browser POS binding gate must remain in place')
assert.match(pos, /setMode\(authorized \? 'pos' : 'select'\)/,
  'the existing Browser POS redirect decision must remain unchanged')

console.log('Browser POS customer-display entry tests passed')

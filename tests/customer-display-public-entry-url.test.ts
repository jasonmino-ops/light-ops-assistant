import assert from 'node:assert/strict'
import fs from 'node:fs'
import { publicCustomerEntryUrl } from '../lib/public-url'

const storeCode = 'ST169E7000'
const customerUrl = publicCustomerEntryUrl(storeCode)

assert.equal(customerUrl, 'https://elifekh.com/m/ST169E7000', '顾客入口必须解析到公开 HTTPS 地址')
assert.match(customerUrl, /^https:\/\//, '顾客入口必须使用 HTTPS')
assert.doesNotMatch(customerUrl, /localhost|127\.0\.0\.1|\b(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\./i, '顾客入口不得包含本地或局域网地址')
assert.equal(
  publicCustomerEntryUrl('ST A/1'),
  'https://elifekh.com/m/ST%20A%2F1',
  'storeCode 必须正确 URL encode',
)

const urlsByLanguage = ['zh', 'en', 'km'].map(() => publicCustomerEntryUrl(storeCode))
assert.deepEqual(urlsByLanguage, [customerUrl, customerUrl, customerUrl], '语言切换不得改变顾客二维码目标')

const display = fs.readFileSync('app/desktop/display/page.tsx', 'utf8')
const invite = fs.readFileSync('app/invite/page.tsx', 'utf8')
assert.match(display, /publicCustomerEntryUrl\(displayStoreCode\)/, '顾客屏必须调用共享公开顾客入口函数')
assert.match(invite, /publicCustomerEntryUrl\(current\.code\)/, '邀请页必须调用共享公开顾客入口函数')
assert.match(display, /<QRCode value=\{entryUrl\}/, '左侧二维码必须使用共享 URL')

const paymentStart = display.indexOf('const StaticKhqrPaymentPanel')
const languageStart = display.indexOf('function LangSwitch')
assert.ok(paymentStart > 0 && languageStart > paymentStart, '支付区应保持独立组件')
const payment = display.slice(paymentStart, languageStart)
assert.doesNotMatch(payment, /QRCode|entryUrl|\/m\//, '右侧支付区不得包含顾客 H5 二维码')
assert.match(payment, /displayImageSrc\(storeKhqrImageUrl\)/, 'KHQR 图片仍应取自门店级静态码')
assert.match(payment, /img src=\{staticKhqrImageSrc\}/, 'KHQR 图片 src 逻辑不得改变')
assert.doesNotMatch(payment, /\bfetch\(/, '支付方式切换不得发起新的二维码请求')

console.log('customer display public entry URL tests passed')

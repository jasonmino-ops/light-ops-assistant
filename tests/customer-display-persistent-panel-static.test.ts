import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('app/desktop/display/page.tsx', 'utf8')

assert.match(page, /publicCustomerEntryUrl\(displayStoreCode\)/, '顾客 H5 应复用公开顾客入口 URL')
assert.match(page, /<CustomerEntryPanel[\s\S]*<OrderPanel[\s\S]*<StaticKhqrPaymentPanel/, '页面应常驻左、中、右三栏')
assert.match(page, /panelState === 'KHQR' \? s\.panelGridKhqr : \{\}/, 'KHQR 应仅改变三栏比例')
assert.match(page, /panelGrid: \{[\s\S]*gridTemplateColumns: '22fr minmax\(0, 52fr\) 26fr'/, '普通态应使用三栏比例')
assert.match(page, /panelGridKhqr: \{ gridTemplateColumns: '18fr minmax\(0, 42fr\) 40fr'/, 'KHQR 态应扩大右侧支付区')

const staticPaymentStart = page.indexOf('const StaticKhqrPaymentPanel')
const langSwitchStart = page.indexOf('function LangSwitch')
assert.ok(staticPaymentStart > 0 && langSwitchStart > staticPaymentStart, '应有独立的右侧静态 KHQR 组件')
const staticPayment = page.slice(staticPaymentStart, langSwitchStart)
assert.match(staticPayment, /storeKhqrImageUrl/, '右侧支付区必须使用门店级静态 KHQR')
assert.doesNotMatch(staticPayment, /khqrImageUrl|khqrPayload|QRCode|customerEntry|\/m\//, '右侧不得混入订单级或顾客 H5 二维码')
assert.match(staticPayment, /state === 'KHQR'/, 'KHQR 切换应仅增强既有右侧组件')
assert.match(staticPayment, /img src=\{staticKhqrImageSrc\}/, 'KHQR 图片必须继续使用原有静态图片 src')
assert.doesNotMatch(staticPayment, /\bfetch\(/, 'KHQR/CASH 切换不得在支付区触发新的二维码请求')

assert.match(page, /setStoreKhqrImageUrl\(body\.storeKhqrImageUrl \?\? null\)/, '轮询响应应更新门店静态 KHQR')
const staticUpdateAt = page.indexOf('setStoreKhqrImageUrl(body.storeKhqrImageUrl ?? null)')
const staleGuardAt = page.indexOf('shouldIgnoreStaleDisplayResponse(current?.session ?? null, body.session, realtimeGuardRef.current)')
assert.ok(staticUpdateAt > 0 && staleGuardAt > staticUpdateAt, '静态 KHQR 更新不得被 session stale-response guard 阻断')
assert.equal((page.match(/fetch\(`\/api\/pos\/session\/current\?/g) ?? []).length, 1, '支付方式切换不得新增 KHQR 请求')
assert.match(page, /const KHQR_FOCUS_MESSAGE = 'KHQR_FOCUS'/, '应继续识别既有 KHQR_FOCUS 信号')
assert.doesNotMatch(page, /KhqrFocusOverlay|khqrFocusBackdrop/, 'KHQR 不得使用全屏遮罩')
assert.match(page, /customerQrCard: \{[^\n]*158px/, '左侧顾客 H5 二维码应轻度缩小')
assert.match(page, /staticKhqrFrame: \{[^\n]*padding: 4/, 'KHQR 白色容器应减少内部留白')
assert.match(page, /staticKhqrImage: \{[^\n]*maxWidth: 400/, 'KHQR 实际图片应获得更多可用宽度')
assert.match(page, /staticKhqrFrame: \{[^\n]*position: 'relative'[^\n]*boxSizing: 'border-box'[^\n]*overflow: 'hidden'/, 'KHQR 外框必须建立确定的可用区域并约束边框与留白')
assert.match(page, /staticKhqrImage: \{[^\n]*position: 'absolute'[^\n]*inset: 4[^\n]*width: 'calc\(100% - 8px\)'[^\n]*height: 'calc\(100% - 8px\)'[^\n]*maxWidth: 400[^\n]*objectFit: 'contain'/, 'KHQR 图片必须在外框内按响应式宽高完整缩放')
assert.match(page, /cartRow: \{[^\n]*minHeight: 54/, '商品行应轻度紧凑')
assert.match(page, /productImage: \{[^\n]*width: 34, height: 34/, '商品缩略图应轻度缩小')

for (const lang of ['zh', 'en', 'km']) {
  const start = page.indexOf(`  ${lang}: {`)
  const end = page.indexOf('\n  },', start)
  const copy = page.slice(start, end)
  assert.match(copy, /joinMember/, `${lang} 应包含会员入口文案`)
  assert.match(copy, /mobileOrder/, `${lang} 应包含手机下单文案`)
  assert.match(copy, /khqrInstruction/, `${lang} 应包含 KHQR 付款提示`)
  assert.match(copy, /cashHint/, `${lang} 应包含现金付款提示`)
}

assert.match(page, /khqrHint: '请核对金额后付款'/, '中文主提示应精简')
assert.match(page, /khqrInstruction: '付款完成后请告知店员'/, '中文辅助提示应精简')
assert.match(page, /khqrHint: 'Please verify the amount before paying'/, '英文主提示应简洁自然')
assert.match(page, /khqrInstruction: 'After paying, please tell the cashier'/, '英文辅助提示应简洁自然')
assert.match(page, /khqrHint: 'សូមផ្ទៀងផ្ទាត់ចំនួនទឹកប្រាក់មុនពេលបង់ប្រាក់'/, '高棉语主提示应简洁自然')
assert.match(page, /khqrInstruction: 'បន្ទាប់ពីបង់ប្រាក់ សូមជូនដំណឹងដល់បុគ្គលិក'/, '高棉语辅助提示应简洁自然')

console.log('customer display persistent panel static tests passed')

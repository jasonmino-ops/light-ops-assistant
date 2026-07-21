import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync('app/cashier/page.tsx', 'utf8')

function styleObject(name: string) {
  const match = page.match(new RegExp(`${name}: \\{([^}]*)\\}`))
  assert.ok(match, `${name} 样式对象必须存在`)
  return match[1]
}

const desktopPaySec = styleObject('desktopPaySec')
const desktopSelectPaySec = styleObject('desktopSelectPaySec')
assert.doesNotMatch(desktopPaySec, /\\boverflow\\s*:/, '桌面支付区不得混用 overflow 简写')
assert.match(desktopPaySec, /overflowX: 'hidden'/, '桌面支付区应保持横向裁切')
assert.match(desktopPaySec, /overflowY: 'auto'/, '桌面支付区应保持纵向滚动')
assert.doesNotMatch(desktopSelectPaySec, /\\boverflow\\s*:/, '选择支付方式状态不得混用 overflow 简写')
assert.match(desktopSelectPaySec, /overflowX: 'hidden'/, '选择支付方式状态应保持横向裁切')
assert.match(desktopSelectPaySec, /overflowY: 'hidden'/, '选择支付方式状态应保持无内部滚动')
assert.match(page, /\.\.\.s\.paySec,[\s\S]*\.\.\.\(isDesktopPos \? s\.desktopPaySec : \{\}\),[\s\S]*\.\.\.\(isDesktopPos && checkoutStep === 'SELECT_PAYMENT' \? s\.desktopSelectPaySec : \{\}\)/, '支付区应继续按原顺序合并三种布局状态')

const desktopPayOption = styleObject('desktopPayOption')
const desktopPayOptionOn = styleObject('desktopPayOptionOn')
assert.doesNotMatch(desktopPayOption, /\\bborder\\s*:/, '支付方式按钮基础态不得使用 border 简写')
assert.match(desktopPayOption, /borderWidth: 1/, '支付方式按钮应保持 1px 边框宽度')
assert.match(desktopPayOption, /borderStyle: 'solid'/, '支付方式按钮应保持实线边框')
assert.match(desktopPayOption, /borderColor: '#cbd5e1'/, '支付方式按钮应保持原正常态边框颜色')
assert.match(desktopPayOptionOn, /borderColor: ACCENT/, '选中态应继续只覆盖边框颜色')
assert.match(desktopPayOptionOn, /background: '#eff6ff'/, '选中态背景不得改变')
assert.match(desktopPayOptionOn, /boxShadow: '0 0 0 2px rgba\(59,130,246,\.12\)'/, '选中态描边不得改变')
assert.match(page, /style=\{\{ \.\.\.s\.desktopPayOption, \.\.\.\(selected \? s\.desktopPayOptionOn : \{\}\) \}\}/, '支付方式按钮应继续按原逻辑合并正常态与选中态')

console.log('cashier inline-style conflict tests passed')

import assert from 'node:assert/strict'
import fs from 'node:fs'

const route = fs.readFileSync('app/api/pos/session/current/route.ts', 'utf8')
const activeStart = route.indexOf('if (row && hasActiveItems)')
const idleStart = route.indexOf('if (!hasActiveItems)')
assert.ok(activeStart > 0 && idleStart > activeStart, 'route should retain distinct active and idle paths')

const preActive = route.slice(0, activeStart)
const activePath = route.slice(activeStart, idleStart)
const remainingPath = route.slice(idleStart)

// 无活跃订单：门店配置经过现有安全图片地址清洗后，继续作为顶层静态字段返回。
assert.match(preActive, /const storeKhqrImageUrl = cleanDisplayImageUrl\(khqrConfig\?\.khqrImageUrl\)/)
assert.match(remainingPath, /storeKhqrImageUrl,/)

// 活跃现金订单：早期返回不得再清空门店静态 KHQR。
assert.match(activePath, /storeKhqrImageUrl,/)
assert.doesNotMatch(activePath, /storeKhqrImageUrl:\s*null/)

// 活跃 KHQR 订单：订单级图片和 payload 仍按原有字段返回，不能与门店静态码混用。
assert.match(activePath, /const sessionKhqrImageUrl = cleanDisplayImageUrl\(row\.khqrImageUrl\)/)
assert.match(activePath, /const khqrImageUrl = row\.paymentMethod === 'KHQR' \? sessionKhqrImageUrl : null/)
assert.match(activePath, /khqrPayload: row\.khqrPayload/)
assert.match(activePath, /khqrImageUrl,/)

// 未配置门店：现有清洗函数仍会将空值映射为 null，而不引入后备订单二维码。
assert.match(route, /function cleanDisplayImageUrl\(raw: string \| null \| undefined\): string \| null \{[\s\S]*if \(!raw\) return null/)
assert.match(remainingPath, /const khqrImageUrl = sessionKhqrImageUrl \?\? \(row\?\.paymentMethod === 'KHQR' \? storeKhqrImageUrl : null\)/)

console.log('customer display session/current static KHQR tests passed')

/**
 * lib/khqr.ts — KHQR provider 路由层
 *
 * 架构：
 *   generateKhqrPayload() 按 config.provider 分发到具体实现。
 *   v1: BAKONG_KHQR → _generateBakongStub()（占位字符串，可渲染二维码）
 *   v2: 替换 _generateBakongStub 为 bakong-khqr npm SDK + 真实 Bakong 商户凭证。
 *
 * 图片模式：merchantAccountRef 为 null 时返回 null（由前端展示 khqrImageUrl）。
 *
 * 新增 provider 时在 generateKhqrPayload() 的 switch 分支中追加，
 * 原有分支不变，保持向后兼容。
 */

export type KhqrProviderConfig = {
  provider: string
  merchantId: string | null
  merchantName: string | null
  merchantAccountRef: string | null  // null = 纯图片模式，不生成动态码
  currency: string
}

/**
 * Provider 路由入口 — 对外唯一暴露的生成函数。
 * 当 merchantAccountRef 为空时返回 null（纯图片模式，调用方应使用 khqrImageUrl）。
 */
export function generateKhqrPayload(params: {
  amount: number
  orderNo: string
  config: KhqrProviderConfig
}): string | null {
  if (!params.config.merchantAccountRef) return null
  switch (params.config.provider) {
    case 'BAKONG_KHQR':
      return _generateBakongStub(params)
    default:
      return _generateBakongStub(params)
  }
}

/**
 * Bakong KHQR v1 stub.
 *
 * 编码格式：KHQR|<accountRef>|<merchantName>|<orderNo>|<amount>|<currency>
 * 这是 v1 占位格式，react-qr-code 可渲染，但不是真实 Bakong EMV 码。
 *
 * v2 替换为：
 *   import { BakongKHQR } from 'bakong-khqr'
 *   new BakongKHQR(merchantConfig).createMerchantQR({ amount, currency, billNumber })
 */
function _generateBakongStub(params: {
  amount: number
  orderNo: string
  config: KhqrProviderConfig
}): string {
  const { amount, orderNo, config } = params
  return [
    'KHQR',
    config.merchantAccountRef ?? '',
    config.merchantName ?? '',
    orderNo,
    amount.toFixed(2),
    config.currency,
  ].join('|')
}

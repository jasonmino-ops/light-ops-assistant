/**
 * lib/khqr.ts — KHQR v1 stub
 *
 * v1 生成可渲染为二维码的占位字符串。
 * v2 会替换为 bakong-khqr npm 包 + Bakong 商户凭证的真实实现。
 */
export function generateKhqrPayload(params: {
  amount: number
  orderNo: string
}): string {
  const { amount, orderNo } = params
  // v1 stub: 将单号和金额编码为简单字符串
  // react-qr-code 可以将其渲染为二维码（不是真实 Bakong 付款码）
  return `KHQR|${orderNo}|${amount.toFixed(2)}|USD`
}

export type CashierPaymentMethod = 'CASH' | 'KHQR'
export type CashierPaymentIntentStatus = 'PAID' | 'PENDING'

/**
 * 电脑收银台的 KHQR 只能由最终「确认已收款」动作入账。
 * 门店是否配置系统内 KHQR 图片不参与该判定：未配置时仍可使用柜台实体码，
 * 但绝不能仅因配置缺失自动写入 PAID。
 */
export function resolveCashierPaymentIntentStatus(
  paymentMethod: CashierPaymentMethod,
  manualPaymentConfirmed: boolean,
): CashierPaymentIntentStatus {
  if (paymentMethod === 'CASH') return 'PAID'
  return manualPaymentConfirmed ? 'PAID' : 'PENDING'
}

export function requiresCashierManualPaymentConfirmation(
  paymentMethod: CashierPaymentMethod,
  manualPaymentConfirmed: boolean,
) {
  return paymentMethod === 'KHQR' && !manualPaymentConfirmed
}

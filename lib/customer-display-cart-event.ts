'use client'

export const CASHIER_CART_TOTAL_CHANGED_EVENT = 'cashier:cart-total-changed'

export type CashierCartTotalChangedReason = 'cart' | 'clear' | 'final'

export type CashierCartTotalChangedDetail = {
  storeCode: string
  totalAmount: number
  itemCount: number
  updatedAt: string
  reason: CashierCartTotalChangedReason
}

export function dispatchCashierCartTotalChanged(detail: CashierCartTotalChangedDetail) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent<CashierCartTotalChangedDetail>(CASHIER_CART_TOTAL_CHANGED_EVENT, { detail }))
  } catch (error) {
    console.warn('[cashier:cart-total] event dispatch failed', error)
  }
}

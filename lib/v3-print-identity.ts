export const V3_PRINT_INTENT_TTL_MS = 24 * 60 * 60 * 1000
export type V3PrintEffectRole = 'FRONT' | 'KITCHEN'

export function canonicalV3PrintEffectKey(orderNo: string, role: V3PrintEffectRole): string {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(orderNo)) throw new Error('V3_PRINT_ORDER_ID_INVALID')
  return `cashier-network-v2:${orderNo}:${role}`
}

export function v3PrintIntentExpiresAt(createdAt: string): string {
  const timestamp = Date.parse(createdAt)
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== createdAt) throw new Error('V3_PRINT_CREATED_AT_INVALID')
  return new Date(timestamp + V3_PRINT_INTENT_TTL_MS).toISOString()
}

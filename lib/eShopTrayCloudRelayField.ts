export const ESHOP_TRAY_FIELD_STORE_CODE = 'ST169E7000' as const
export const ESHOP_TRAY_FIELD_QUEUE_NAME = '前台' as const

export function isEshopTrayCloudRelayFieldEnabled(
  storeCode: string | null | undefined,
  gateValue = process.env.ESHOP_TRAY_FIELD_ENABLED ?? process.env.NEXT_PUBLIC_ESHOP_TRAY_FIELD_ENABLED,
): boolean {
  return gateValue === '1' && storeCode === ESHOP_TRAY_FIELD_STORE_CODE
}

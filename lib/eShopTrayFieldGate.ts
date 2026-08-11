import { ESHOP_TRAY_FIELD_STORE_CODE } from './eShopTrayCloudRelayField'

export { ESHOP_TRAY_FIELD_STORE_CODE }

export function isEshopTrayFieldEnabled({
  storeCode,
  realRole,
  isDesktopRecords,
  gateValue = process.env.NEXT_PUBLIC_ESHOP_TRAY_FIELD_ENABLED,
}: {
  storeCode: string | null | undefined
  realRole: string
  isDesktopRecords: boolean
  gateValue?: string
}): boolean {
  return gateValue === '1'
    && realRole === 'OWNER'
    && !isDesktopRecords
    && storeCode === ESHOP_TRAY_FIELD_STORE_CODE
}

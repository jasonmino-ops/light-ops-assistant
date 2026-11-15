// The pilot runs on a single verified store. A live legacy binding wins.
export function nativeInventoryAvailable(storeId?: string) {
  const pilotStoreId = process.env.NATIVE_INVENTORY_PILOT_STORE_ID?.trim()
  return process.env.NATIVE_INVENTORY_ENABLED === 'true'
    && Boolean(pilotStoreId)
    && process.env.INVENTORY_PROFIT_PILOT_STORE_ID?.trim() !== pilotStoreId
    && (storeId === undefined || storeId === pilotStoreId)
}

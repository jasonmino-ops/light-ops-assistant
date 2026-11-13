// Server-side only. An opted-in deployment still requires the store's database enablement.
export function nativeInventoryAvailable() {
  return process.env.NATIVE_INVENTORY_ENABLED === 'true'
}

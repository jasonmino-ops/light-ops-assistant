// Public identity only. The immutable 54-line snapshot is server-only.
export const DIAMOND_RECOVERY = {
  origin: 'https://elifekh.com',
  storeCode: 'ST883DC00C',
  holdId: 'b9a1663d-1ddf-405e-b2ac-6c4430186287',
  cartSha256: '3c4ea08373c73238c85a483aa16c87ff3d0a8fdcb46e3c2736b05c01434942f2',
  holdIds: [
    'b9a1663d-1ddf-405e-b2ac-6c4430186287',
    'fcf89f83-9e1f-4319-a028-df72a0967c38',
    '900fe73a-fd96-4610-8e05-6c8cda3a2d17',
    '642ac3b8-3234-4cd9-86b8-dae9d0338ea4',
  ],
} as const
export function isDiamondRecoveryHold(storeCode: string | null | undefined, id: string) {
  return storeCode === DIAMOND_RECOVERY.storeCode && DIAMOND_RECOVERY.holdIds.some(value => value === id)
}
export function canonicalCart(value: unknown): string {
  function sorted(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sorted)
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, val]) => [key, sorted(val)]))
    return item
  }
  return JSON.stringify(sorted(value))
}

/**
 * lib/merchant-config.ts
 *
 * 商户支付配置查找工具，供多处 API 路由复用。
 */
import { prisma } from './prisma'
import type { KhqrProviderConfig } from './khqr'

export type MerchantKhqrConfig = KhqrProviderConfig & {
  id: string
  khqrImageUrl: string | null
}

/**
 * 按优先级查找门店的 KHQR 支付配置：
 *  1. 当前 storeId 的专属启用配置
 *  2. 租户级默认配置（storeId = null, isDefault = true）
 *  3. 两者都没有 → 返回 null（调用方应拒绝 KHQR 并提示）
 */
export async function findKhqrConfig(
  tenantId: string,
  storeId: string,
): Promise<MerchantKhqrConfig | null> {
  const storeConfig = await prisma.merchantPaymentConfig.findFirst({
    where: { tenantId, storeId, khqrEnabled: true, isActive: true },
  })
  if (storeConfig) return storeConfig

  return prisma.merchantPaymentConfig.findFirst({
    where: { tenantId, storeId: null, khqrEnabled: true, isActive: true, isDefault: true },
  })
}

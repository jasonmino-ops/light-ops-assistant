/**
 * lib/tier.ts — 统一 Tenant.tier 的业务判断
 *
 * 单一事实来源：所有"是否高级版 / 是否旗舰版 / tier 显示文案"必须经此文件，
 * 不要在调用方手写 `tier === 'STANDARD'` 之类的字面量比较。
 *
 * 当前 tier 取值（与 prisma/schema.prisma `Tenant.tier` 一致）：
 *   - LITE         轻试用版（默认）
 *   - STANDARD     标准收银版
 *   - MULTI_STORE  门店标准化版（事实上的"旗舰版"）
 *
 * 不在这里新增 FLAGSHIP；如未来要拆分，应同步扩 OPS VALID_TIERS 与 TIER_META。
 */

export const TENANT_TIERS = {
  LITE: 'LITE',
  STANDARD: 'STANDARD',
  MULTI_STORE: 'MULTI_STORE',
} as const

export type TenantTier = typeof TENANT_TIERS[keyof typeof TENANT_TIERS]

export function normalizeTier(tier: string | null | undefined): TenantTier {
  if (tier === TENANT_TIERS.STANDARD) return TENANT_TIERS.STANDARD
  if (tier === TENANT_TIERS.MULTI_STORE) return TENANT_TIERS.MULTI_STORE
  return TENANT_TIERS.LITE
}

/** 是否具备"打印能力"（高级版起步：STANDARD / MULTI_STORE）。 */
export function isPrintingTier(tier: string | null | undefined): boolean {
  const normalized = normalizeTier(tier)
  return normalized === TENANT_TIERS.STANDARD || normalized === TENANT_TIERS.MULTI_STORE
}

/** 是否允许 AI 客服 L3 能力（STANDARD / MULTI_STORE）。 */
export function canUseAiSupport(tier: string | null | undefined): boolean {
  const normalized = normalizeTier(tier)
  return normalized === TENANT_TIERS.STANDARD || normalized === TENANT_TIERS.MULTI_STORE
}

/** 是否为"旗舰版"（当前等价于 MULTI_STORE）。用于批量触达等顶档专属能力。 */
export function isFlagshipTier(tier: string | null | undefined): boolean {
  const normalized = normalizeTier(tier)
  return normalized === TENANT_TIERS.MULTI_STORE
}

/** tier 的中文展示文案（与 OPS 后台 TIER_META 保持一致）。 */
export function getTierLabel(tier: string | null | undefined): string {
  const normalized = normalizeTier(tier)
  if (normalized === TENANT_TIERS.STANDARD) return '标准收银版'
  if (normalized === TENANT_TIERS.MULTI_STORE) return '门店标准化版'
  return '轻试用版'
}

/** 旗舰版专属能力的统一徽标文案。 */
export function getFlagshipFeatureLabel(): string {
  return '旗舰版专属'
}

import { prisma } from '@/lib/prisma'

const PRODUCT_PAGE_ERROR = '该营销页不存在或未发布，请先发布营销页'
const PRODUCT_PAGE_STORE_ERROR = '该营销页不属于当前门店，请重新选择'
const UNSUPPORTED_TARGET_ERROR = '仅支持菜单页或营销页链接'

type TargetContext = {
  tenantId: string
  storeId: string
}

type TargetOptions = {
  strictStore?: boolean
}

type TargetResult =
  | { ok: true; targetUrl: string }
  | { ok: false; message: string }

function productSlug(targetUrl: string): string {
  return targetUrl.slice(3).split(/[?#]/)[0]?.trim() ?? ''
}

function normalizeTargetUrl(rawTargetUrl: string): string {
  const trimmed = rawTargetUrl.trim()
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return trimmed
  }
}

export async function validateCampaignTargetUrl(
  rawTargetUrl: unknown,
  ctx: TargetContext,
  options: TargetOptions = {},
): Promise<TargetResult> {
  if (rawTargetUrl == null) return { ok: true, targetUrl: '' }
  if (typeof rawTargetUrl !== 'string') return { ok: false, message: UNSUPPORTED_TARGET_ERROR }

  const targetUrl = normalizeTargetUrl(rawTargetUrl)
  if (!targetUrl) return { ok: true, targetUrl: '' }
  if (targetUrl.startsWith('/menu')) return { ok: true, targetUrl }

  if (!targetUrl.startsWith('/p/')) {
    return { ok: false, message: UNSUPPORTED_TARGET_ERROR }
  }

  const slug = productSlug(targetUrl)
  if (!slug) return { ok: false, message: PRODUCT_PAGE_ERROR }

  const page = await prisma.marketingProductPage.findUnique({
    where: { slug },
    select: {
      slug: true,
      status: true,
      tenantId: true,
      storeId: true,
      store: { select: { status: true } },
      product: { select: { status: true } },
    },
  })

  if (!page) return { ok: false, message: PRODUCT_PAGE_ERROR }
  if (page.status !== 'PUBLISHED') return { ok: false, message: PRODUCT_PAGE_ERROR }
  if (page.store.status !== 'ACTIVE' || page.product.status !== 'ACTIVE') return { ok: false, message: PRODUCT_PAGE_ERROR }
  if (page.tenantId !== ctx.tenantId) return { ok: false, message: PRODUCT_PAGE_STORE_ERROR }
  if (options.strictStore !== false && page.storeId !== ctx.storeId) {
    return { ok: false, message: PRODUCT_PAGE_STORE_ERROR }
  }
  return { ok: true, targetUrl: `/p/${page.slug}` }
}

export async function campaignTargetRisk(
  targetUrl: string | null,
  ctx: TargetContext,
): Promise<string | null> {
  if (!targetUrl) return null
  const result = await validateCampaignTargetUrl(targetUrl, ctx, { strictStore: false })
  return result.ok ? null : result.message
}

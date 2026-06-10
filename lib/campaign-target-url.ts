import { prisma } from '@/lib/prisma'

const PRODUCT_PAGE_ERROR = '该营销页不存在或未发布，请先发布营销页'
const UNSUPPORTED_TARGET_ERROR = '仅支持菜单页或营销页链接'

type TargetContext = {
  tenantId: string
  storeId: string
}

type TargetResult =
  | { ok: true; targetUrl: string }
  | { ok: false; message: string }

function productSlug(targetUrl: string): string {
  return targetUrl.slice(3).split(/[?#]/)[0]?.trim() ?? ''
}

export async function validateCampaignTargetUrl(
  rawTargetUrl: unknown,
  ctx: TargetContext,
): Promise<TargetResult> {
  if (rawTargetUrl == null) return { ok: true, targetUrl: '' }
  if (typeof rawTargetUrl !== 'string') return { ok: false, message: UNSUPPORTED_TARGET_ERROR }

  const targetUrl = rawTargetUrl.trim()
  if (!targetUrl) return { ok: true, targetUrl: '' }
  if (targetUrl.startsWith('/menu')) return { ok: true, targetUrl }

  if (!targetUrl.startsWith('/p/')) {
    return { ok: false, message: UNSUPPORTED_TARGET_ERROR }
  }

  const slug = productSlug(targetUrl)
  if (!slug) return { ok: false, message: PRODUCT_PAGE_ERROR }

  const page = await prisma.marketingProductPage.findFirst({
    where: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      slug,
      status: 'PUBLISHED',
    },
    select: { slug: true },
  })

  if (!page) return { ok: false, message: PRODUCT_PAGE_ERROR }
  return { ok: true, targetUrl: `/p/${page.slug}` }
}

export async function campaignTargetRisk(
  targetUrl: string | null,
  ctx: TargetContext,
): Promise<string | null> {
  if (!targetUrl) return null
  const result = await validateCampaignTargetUrl(targetUrl, ctx)
  return result.ok ? null : result.message
}

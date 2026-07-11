import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import PrivateLandingShell from './PrivateLandingShell'

type PageParams = {
  params: Promise<{ storeCode: string }>
  searchParams: Promise<{ lang?: string; source?: string; campaign?: string }>
}

type StoreRow = {
  code: string
  name: string
  bannerUrl: string | null
  announcement: string | null
  promoText: string | null
  businessType: string | null
  status: string
}

const LANGS = ['zh', 'en', 'km'] as const
type Lang = (typeof LANGS)[number]

function normalizeLang(raw: string | null | undefined): Lang | null {
  const v = (raw ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'zh' || v.startsWith('zh-') || v.startsWith('zh_')) return 'zh'
  if (v === 'en' || v.startsWith('en-') || v.startsWith('en_')) return 'en'
  if (v === 'km' || v.startsWith('km-') || v.startsWith('kh')) return 'km'
  return null
}

function detectLang(urlLang: string | null | undefined, acceptLanguage: string | null): Lang {
  const fromUrl = normalizeLang(urlLang)
  if (fromUrl) return fromUrl
  const accept = (acceptLanguage ?? '').toLowerCase()
  if (accept.includes('km') || accept.includes('kh')) return 'km'
  if (accept.includes('en')) return 'en'
  return 'zh'
}

function cleanParam(raw: string | null | undefined, max = 80): string | null {
  const cleaned = (raw ?? '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, max)
  return cleaned || null
}

export default async function CustomerPrivateLandingPage({ params, searchParams }: PageParams) {
  const [{ storeCode: rawStoreCode }, { lang: urlLang, source, campaign }] = await Promise.all([params, searchParams])
  const storeCode = rawStoreCode?.trim() ?? ''
  const requestHeaders = await headers()
  const initialLang = detectLang(urlLang, requestHeaders.get('accept-language'))
  const initialSource = cleanParam(source)
  const initialCampaign = cleanParam(campaign, 120)

  if (!storeCode) {
    return (
      <PrivateLandingShell
        initialLang={initialLang}
        store={null}
        storeCode=""
        errorKind="missing"
        initialSource={initialSource}
        initialCampaign={initialCampaign}
      />
    )
  }

  const store = await prisma.store.findFirst({
    where: {
      OR: [
        { code: storeCode },
        { code: { equals: storeCode, mode: 'insensitive' } },
      ],
    },
    select: {
      code: true,
      name: true,
      bannerUrl: true,
      announcement: true,
      promoText: true,
      businessType: true,
      status: true,
    },
  })

  const normalizedStore: StoreRow | null = store && store.status === 'ACTIVE'
    ? {
      code: store.code,
      name: store.name,
      bannerUrl: store.bannerUrl ?? null,
      announcement: store.announcement ?? null,
      promoText: store.promoText ?? null,
      businessType: store.businessType ?? 'GENERAL',
      status: store.status,
    }
    : null

  return (
    <PrivateLandingShell
      initialLang={initialLang}
      store={normalizedStore}
      storeCode={storeCode}
      errorKind={store ? null : 'missing'}
      initialSource={initialSource}
      initialCampaign={initialCampaign}
    />
  )
}

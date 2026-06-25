import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import PrivateLandingShell from './PrivateLandingShell'

type PageParams = {
  params: Promise<{ storeCode: string }>
  searchParams: Promise<{ lang?: string }>
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

export default async function CustomerPrivateLandingPage({ params, searchParams }: PageParams) {
  const [{ storeCode: rawStoreCode }, { lang: urlLang }] = await Promise.all([params, searchParams])
  const storeCode = rawStoreCode?.trim() ?? ''
  const requestHeaders = await headers()
  const initialLang = detectLang(urlLang, requestHeaders.get('accept-language'))

  if (!storeCode) {
    return (
      <PrivateLandingShell
        initialLang={initialLang}
        store={null}
        storeCode=""
        errorKind="missing"
      />
    )
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
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
      errorKind={store ? 'inactive' : 'missing'}
    />
  )
}

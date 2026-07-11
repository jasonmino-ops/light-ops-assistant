import { prisma } from '@/lib/prisma'

export const LANDING_EVENT_TYPES = ['landing_view', 'landing_cta_click', 'menu_arrival'] as const
export type LandingEventType = typeof LANDING_EVENT_TYPES[number]
export type JourneyEventType = LandingEventType | 'order_conversion'

const ALL_EVENT_TYPES: JourneyEventType[] = [...LANDING_EVENT_TYPES, 'order_conversion']
const LANGS = ['zh', 'en', 'km'] as const

export function isLandingEventType(value: unknown): value is LandingEventType {
  return typeof value === 'string' && LANDING_EVENT_TYPES.includes(value as LandingEventType)
}

export function isJourneyEventType(value: unknown): value is JourneyEventType {
  return typeof value === 'string' && ALL_EVENT_TYPES.includes(value as JourneyEventType)
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max)
  return cleaned || null
}

export function cleanTrackingText(value: unknown, max = 80): string | null {
  const cleaned = cleanText(value, max)
  if (!cleaned) return null
  const safe = cleaned.replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, max)
  return safe || null
}

export function cleanVisitorId(value: unknown): string | null {
  const cleaned = cleanText(value, 80)
  if (!cleaned) return null
  return /^[a-zA-Z0-9_-]{8,80}$/.test(cleaned) ? cleaned : null
}

export function cleanLanguage(value: unknown): string | null {
  const cleaned = cleanText(value, 8)?.toLowerCase()
  if (!cleaned) return null
  if (cleaned === 'zh' || cleaned.startsWith('zh-') || cleaned.startsWith('zh_')) return 'zh'
  if (cleaned === 'en' || cleaned.startsWith('en-') || cleaned.startsWith('en_')) return 'en'
  if (cleaned === 'km' || cleaned.startsWith('km-') || cleaned.startsWith('kh')) return 'km'
  return LANGS.includes(cleaned as (typeof LANGS)[number]) ? cleaned : null
}

export function cleanReferrer(value: unknown): string | null {
  return cleanText(value, 500)
}

export function cleanEventKey(value: unknown): string | null {
  const cleaned = cleanText(value, 180)
  if (!cleaned) return null
  return /^[a-zA-Z0-9_.:-]{8,180}$/.test(cleaned) ? cleaned : null
}

export type CreateJourneyEventInput = {
  eventType: JourneyEventType
  storeId: string
  storeCode: string
  visitorId?: string | null
  source?: string | null
  campaign?: string | null
  referrer?: string | null
  language?: string | null
  orderId?: string | null
  eventKey?: string | null
}

export async function createCustomerJourneyEvent(input: CreateJourneyEventInput): Promise<void> {
  if (!isJourneyEventType(input.eventType)) return
  try {
    await prisma.customerJourneyEvent.create({
      data: {
        eventType: input.eventType,
        storeId: input.storeId,
        storeCode: input.storeCode,
        visitorId: cleanVisitorId(input.visitorId),
        source: cleanTrackingText(input.source),
        campaign: cleanTrackingText(input.campaign, 120),
        referrer: cleanReferrer(input.referrer),
        language: cleanLanguage(input.language),
        orderId: cleanTrackingText(input.orderId, 80),
        eventKey: cleanEventKey(input.eventKey),
      },
    })
  } catch (error) {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') return
    console.error('[customer-journey] create event failed', error)
  }
}


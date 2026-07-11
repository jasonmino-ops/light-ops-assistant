import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  cleanEventKey,
  cleanLanguage,
  cleanReferrer,
  cleanTrackingText,
  cleanVisitorId,
  createCustomerJourneyEvent,
  isLandingEventType,
} from '@/lib/customer-journey'

type Body = {
  eventType?: unknown
  storeCode?: unknown
  visitorId?: unknown
  source?: unknown
  campaign?: unknown
  referrer?: unknown
  language?: unknown
  eventKey?: unknown
}

export async function POST(req: NextRequest) {
  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  if (!isLandingEventType(body.eventType)) {
    return NextResponse.json({ error: 'INVALID_EVENT_TYPE' }, { status: 400 })
  }

  const storeCode = cleanTrackingText(body.storeCode, 80)
  if (!storeCode) {
    return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, code: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  await createCustomerJourneyEvent({
    eventType: body.eventType,
    storeId: store.id,
    storeCode: store.code,
    visitorId: cleanVisitorId(body.visitorId),
    source: cleanTrackingText(body.source),
    campaign: cleanTrackingText(body.campaign, 120),
    referrer: cleanReferrer(body.referrer),
    language: cleanLanguage(body.language),
    eventKey: cleanEventKey(body.eventKey),
  })

  return NextResponse.json({ ok: true })
}


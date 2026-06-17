import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { normalizeMemberPhone } from '@/lib/member-phone'

export async function GET(req: NextRequest) {
  const storeCode = req.nextUrl.searchParams.get('storeCode')?.trim()
  const phone = req.nextUrl.searchParams.get('phone')?.trim()
  if (!storeCode) return NextResponse.json({ error: 'MISSING_STORE_CODE' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'BAD_REQUEST', message: 'phone is required' }, { status: 400 })

  const normalizedPhone = normalizeMemberPhone(phone)
  if (!normalizedPhone) {
    return NextResponse.json({ error: 'BAD_REQUEST', message: 'phone is invalid' }, { status: 400 })
  }

  const store = await prisma.store.findUnique({
    where: { code: storeCode },
    select: { id: true, tenantId: true, status: true },
  })
  if (!store || store.status !== 'ACTIVE') {
    return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  }

  const member = await prisma.member.findFirst({
    where: {
      tenantId: store.tenantId,
      storeId: store.id,
      normalizedPhone,
      status: 'ACTIVE',
    },
    select: {
      id: true,
      memberCode: true,
      name: true,
      phone: true,
      normalizedPhone: true,
      balance: true,
      status: true,
    },
  })

  if (!member) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })

  return NextResponse.json({
    member: {
      ...member,
      balance: member.balance.toString(),
    },
  })
}

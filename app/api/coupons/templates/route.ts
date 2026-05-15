/**
 * GET /api/coupons/templates — 返回本租户优惠券模板（OWNER）
 * 若该 tenant 尚无模板，lazy seed 3 张默认满减模板。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'

const DEFAULTS = [
  { name: '满 50 减 5',   amountOff: 5,  minSpend: 50,  validDays: 7  },
  { name: '满 100 减 10', amountOff: 10, minSpend: 100, validDays: 14 },
  { name: '满 200 减 20', amountOff: 20, minSpend: 200, validDays: 30 },
]

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  let templates = await prisma.couponTemplate.findMany({
    where: { tenantId: ctx.tenantId, status: { in: ['ACTIVE', 'PAUSED'] } },
    orderBy: { createdAt: 'asc' },
  })

  if (templates.length === 0) {
    await prisma.couponTemplate.createMany({
      data: DEFAULTS.map((d) => ({
        tenantId:  ctx.tenantId,
        name:      d.name,
        type:      'AMOUNT_OFF' as const,
        amountOff: d.amountOff,
        minSpend:  d.minSpend,
        validDays: d.validDays,
        status:    'ACTIVE' as const,
      })),
    })
    templates = await prisma.couponTemplate.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ['ACTIVE', 'PAUSED'] } },
      orderBy: { createdAt: 'asc' },
    })
  }

  return NextResponse.json({
    templates: templates.map((t) => ({
      id:         t.id,
      name:       t.name,
      type:       t.type,
      amountOff:  t.amountOff != null ? Number(t.amountOff) : null,
      percentOff: t.percentOff,
      minSpend:   Number(t.minSpend),
      validDays:  t.validDays,
      status:     t.status,
    })),
  })
}

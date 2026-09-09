import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { object, parseSelection } from '@/lib/product-sales/contract'
import { reportRange } from '@/lib/product-sales/dates'
import { ownerRequest, readBody } from '@/lib/product-sales/http'
import { querySales } from '@/lib/product-sales/service'

export async function POST(req: NextRequest) {
  return ownerRequest(req, async (_owner, stores) => {
    const input = object(await readBody(req))
    const selection = parseSelection(input)
    const now = new Date()
    const range = reportRange({ period: input.period, dateFrom: input.dateFrom, dateTo: input.dateTo }, now)
    return prisma.$transaction((db) => querySales(selection, stores, range, now, db), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 })
  })
}

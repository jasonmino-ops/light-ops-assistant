import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { identifier } from '@/lib/product-sales/contract'
import { ownerRequest } from '@/lib/product-sales/http'
import { canReadReport } from '@/lib/product-sales/service'

export async function GET(req: NextRequest) {
  return ownerRequest(req, async (ownerTelegramId, stores) => {
    const cursor = req.nextUrl.searchParams.get('cursor')
    const groupId = req.nextUrl.searchParams.get('groupId')
    const reports = await prisma.productSalesDailyReport.findMany({
      where: { group: { ownerTelegramId }, ...(groupId ? { groupId: identifier(groupId) } : {}), ...(cursor ? { id: { lt: identifier(cursor) } } : {}) },
      orderBy: { id: 'desc' }, take: 31,
    })
    return { reports: reports.slice(0, 30).flatMap((report) => canReadReport(report.result, stores)
      ? [{ id: report.id, groupId: report.groupId, reportDate: report.reportDate, generatedAt: report.generatedAt.toISOString(), name: report.result.groupName ?? '' }] : []),
    nextCursor: reports.length > 30 ? reports[29].id : null }
  })
}

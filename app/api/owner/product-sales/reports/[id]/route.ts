import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { identifier, ReportError } from '@/lib/product-sales/contract'
import { ownerRequest } from '@/lib/product-sales/http'
import { canReadReport } from '@/lib/product-sales/service'

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return ownerRequest(req, async (ownerTelegramId, stores) => {
    const id = identifier((await context.params).id)
    const report = await prisma.productSalesDailyReport.findFirst({ where: { id, group: { ownerTelegramId } } })
    if (!report || !canReadReport(report.result, stores)) throw new ReportError('REPORT_NOT_FOUND', 404)
    return { id: report.id, reportDate: report.reportDate, result: report.result }
  })
}

/**
 * GET /api/ops/cleanup/stats
 *
 * Dry-run: returns counts of records eligible for 90-day retention cleanup.
 * Does NOT delete anything. Use this to understand the impact before
 * enabling an actual cleanup job.
 *
 * Retention policy (plan):
 *   OperationLog   → keep last 90 days
 *   SaleRecord     → keep indefinitely (financial records)
 *
 * Access: SUPER_ADMIN only.
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

export async function GET(req: NextRequest) {
  const opsRole = checkOpsAuth(req)
  if (!opsRole) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })
  if (opsRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 90)

  const [eligibleLogs, totalLogs] = await Promise.all([
    prisma.operationLog.count({ where: { createdAt: { lt: cutoff } } }),
    prisma.operationLog.count(),
  ])

  // Oldest log date (for context)
  const oldestLog = await prisma.operationLog.findFirst({
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })

  return NextResponse.json({
    dryRun: true,
    retentionDays: 90,
    cutoffDate: cutoff.toISOString().slice(0, 10),
    operationLog: {
      total: totalLogs,
      eligible: eligibleLogs,
      retain: totalLogs - eligibleLogs,
      pct: totalLogs > 0 ? Math.round((eligibleLogs / totalLogs) * 100) : 0,
      oldestAt: oldestLog?.createdAt.toISOString() ?? null,
    },
    note: 'SaleRecord 为财务流水，不纳入自动清理。实际删除需额外确认后执行。',
  })
}

import { timingSafeEqual } from 'node:crypto'
import { prisma } from '../prisma'
import { ReportError } from './contract'
import { generateDailyGroup } from './service'

export function scheduledAuthorization(header: string | null, secret: string | undefined) {
  if (!secret || secret.length < 16 || !header) return false
  const actual = Buffer.from(header)
  const expected = Buffer.from(`Bearer ${secret}`)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
export async function generateDailyReports(now = new Date(), client = prisma, generate = generateDailyGroup) {
  const outcome = { created: 0, existing: 0, skipped: 0, failed: 0 }
  let cursor: string | undefined
  for (;;) {
    const groups = await client.productSalesGroup.findMany({ where: { enabled: true, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 50, select: { id: true } })
    for (const group of groups) {
      try { outcome[await generate(group.id, now, client)]++ }
      catch (error) {
        outcome.failed++
        console.error('[product-sales-daily]', { groupId: group.id, code: error instanceof ReportError ? error.code : 'GENERATION_FAILED' })
      }
    }
    if (groups.length < 50) break
    cursor = groups[groups.length - 1].id
  }
  return outcome
}

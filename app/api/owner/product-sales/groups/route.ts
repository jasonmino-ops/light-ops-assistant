import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { ownerRequest, readBody } from '@/lib/product-sales/http'
import { createGroup, groupView } from '@/lib/product-sales/service'

export async function GET(req: NextRequest) {
  return ownerRequest(req, async (ownerTelegramId) => {
    const groups = await prisma.productSalesGroup.findMany({ where: { ownerTelegramId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] })
    return groups.map(groupView)
  })
}
export async function POST(req: NextRequest) {
  return ownerRequest(req, async (owner, stores) => createGroup(await readBody(req), owner, stores))
}

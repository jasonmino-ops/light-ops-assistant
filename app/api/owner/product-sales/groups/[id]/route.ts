import { NextRequest } from 'next/server'
import { ownerRequest, readBody } from '@/lib/product-sales/http'
import { updateGroup } from '@/lib/product-sales/service'

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return ownerRequest(req, async (owner, stores) => updateGroup((await context.params).id, await readBody(req), owner, stores))
}

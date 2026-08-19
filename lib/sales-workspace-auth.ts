import { NextRequest } from 'next/server'
import { checkOpsAuthContext, type OpsRole } from '@/lib/ops-auth'

export type SalesWorkspaceActor = {
  role: OpsRole
  userId: string
  isManager: boolean
}

export async function getSalesWorkspaceActor(
  req: NextRequest,
): Promise<SalesWorkspaceActor | false> {
  const context = await checkOpsAuthContext(req)
  if (!context) return false
  return {
    role: context.role,
    userId: context.userId,
    isManager: context.role === 'OPS_ADMIN' || context.role === 'SUPER_ADMIN',
  }
}

export function canAccessOwnedSalesLead(
  actor: SalesWorkspaceActor,
  salesOwnerId: string | null,
) {
  return actor.isManager || salesOwnerId === actor.userId
}

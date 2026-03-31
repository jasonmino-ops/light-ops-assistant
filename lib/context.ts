import { NextRequest } from 'next/server'

export type UserRole = 'OWNER' | 'STAFF'

export type RequestContext = {
  tenantId: string
  userId: string
  storeId: string
  role: UserRole
}

/**
 * Extracts the temporary dev identity context from request headers.
 * Headers: x-tenant-id, x-user-id, x-store-id, x-role
 *
 * Replace this with JWT verification when auth is implemented.
 */
export function getContext(req: NextRequest): RequestContext | null {
  const tenantId = req.headers.get('x-tenant-id')
  const userId = req.headers.get('x-user-id')
  const storeId = req.headers.get('x-store-id')
  const role = req.headers.get('x-role')

  if (!tenantId || !userId || !storeId || !role) return null
  if (role !== 'OWNER' && role !== 'STAFF') return null

  return { tenantId, userId, storeId, role }
}

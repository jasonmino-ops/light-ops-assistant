import { NextRequest } from 'next/server'
import { getContext } from './context'

/** Returns the request context if the caller is an authorized ops admin, else null. */
export function checkOpsAuth(req: NextRequest) {
  const ctx = getContext(req)
  if (!ctx || ctx.role !== 'OWNER') return null

  const allowed = (process.env.OPS_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // Empty whitelist = allow any OWNER (dev / single-admin deployments)
  if (allowed.length > 0 && !allowed.includes(ctx.userId)) return null
  return ctx
}

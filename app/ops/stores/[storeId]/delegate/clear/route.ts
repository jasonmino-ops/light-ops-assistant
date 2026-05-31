/**
 * GET /ops/stores/[storeId]/delegate/clear
 *
 * 退出平台代运营模式。清除 delegate cookies，写退出审计日志，
 * 重定向回 /ops 后台。
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifySession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const delegateToken = req.cookies.get('delegate-session')?.value
  if (delegateToken) {
    const ds = verifySession(delegateToken)
    if (ds && ds.storeId && ds.tenantId && !ds.opsRole) {
      const opsSession = verifySession(req.cookies.get('auth-session')?.value ?? '')
      const opsAdminId = opsSession?.userId ?? 'unknown'
      try {
        await prisma.operationLog.create({
          data: {
            tenantId:        ds.tenantId,
            storeId:         ds.storeId,
            userId:          null,
            actionType:      'OPS_DELEGATE_EXIT',
            targetType:      'Store',
            targetId:        ds.storeId,
            status:          'SUCCESS',
            message:         'Platform delegate mode exited',
            payloadSnapshot: { opsAdminId, source: 'ops_delegate_operation' },
          },
        })
      } catch { /* audit failure must never block exit */ }
    }
  }

  const response = NextResponse.redirect(new URL('/ops', req.url))
  response.cookies.delete('delegate-session')
  response.cookies.delete('delegate-info')
  return response
}

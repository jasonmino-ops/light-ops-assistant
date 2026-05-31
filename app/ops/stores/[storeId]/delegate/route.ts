/**
 * GET /ops/stores/[storeId]/delegate
 *
 * 平台代运营模式入口。验证 ops 管理员身份后，签发 delegate-session cookie，
 * 并将浏览器重定向到商户老板端首页 /home。
 *
 * 安全模型：
 *  - 仅持有合法 auth-session（ops session）的管理员可访问
 *  - delegate-session 以 HMAC-SHA256 签名，无法伪造
 *  - delegate-session 没有 opsRole 字段，与真实 ops session 严格区分
 *  - getContext 在 ops + delegate-session 同时存在时，返回目标商户 context
 *  - checkOpsAuth 仍从 auth-session 读取，不受 delegate-session 影响
 *  - 所有 owner API 通过 ctx.storeId / ctx.tenantId 严格限制在目标商户内
 *
 * 明确禁止（通过架构自然隔离）：
 *  - 删除商户 / 修改套餐：仅在 /api/ops/* 路由，代运营无法触达
 *  - 串店：ctx.storeId 由签名 delegate-session 锁定，无法修改
 *
 * 代运营有效期：2 小时，重新点击入口可续期。
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkOpsAuth } from '@/lib/ops-auth'
import { verifySession, signSession } from '@/lib/session'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params

  // ── 1. Validate ops session ───────────────────────────────────────────────
  const opsRole = await checkOpsAuth(req)
  if (!opsRole) {
    return NextResponse.redirect(new URL('/ops/login', req.url))
  }

  const sessionToken = req.cookies.get('auth-session')?.value ?? ''
  const opsSession = verifySession(sessionToken)
  const opsAdminId = opsSession?.userId ?? 'unknown'

  // ── 2. Look up target store ───────────────────────────────────────────────
  const store = await prisma.store.findUnique({
    where:  { id: storeId },
    select: { id: true, name: true, tenantId: true, status: true },
  })
  if (!store) {
    return NextResponse.redirect(new URL('/ops', req.url))
  }

  // Find the store's OWNER for a FK-compatible userId (writes by delegate appear
  // as owner writes, which is semantically correct for a platform-assisted operation)
  const ownerRole = await prisma.userStoreRole.findFirst({
    where:  { storeId: store.id, role: 'OWNER', status: 'ACTIVE' },
    select: { userId: true },
  })

  // ── 3. Sign delegate session ──────────────────────────────────────────────
  // payload intentionally has NO opsRole → getContext distinguishes from ops session
  const delegateSigned = signSession({
    tenantId: store.tenantId,
    storeId:  store.id,
    userId:   ownerRole?.userId ?? `sys`,
    role:     'OWNER',
  })

  // ── 4. Audit log (entry) ──────────────────────────────────────────────────
  try {
    await prisma.operationLog.create({
      data: {
        tenantId:        store.tenantId,
        storeId:         store.id,
        userId:          null,
        actionType:      'OPS_DELEGATE_ENTER',
        targetType:      'Store',
        targetId:        store.id,
        status:          'SUCCESS',
        message:         `Platform delegate mode entered`,
        payloadSnapshot: {
          opsAdminId,
          source:    'ops_delegate_operation',
          storeName: store.name,
          opsRole,
        },
      },
    })
  } catch { /* audit failure must never block entry */ }

  // ── 5. Set cookies and redirect ───────────────────────────────────────────
  const response = NextResponse.redirect(new URL('/home', req.url))
  const cookieOpts = {
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   60 * 60 * 2,
    path:     '/' as const,
    sameSite: 'strict' as const,
  }

  // HttpOnly — provides storeId/tenantId to server-side getContext
  response.cookies.set('delegate-session', delegateSigned, { ...cookieOpts, httpOnly: true })

  // Non-HttpOnly — read by DelegateBanner client component for display
  response.cookies.set(
    'delegate-info',
    encodeURIComponent(JSON.stringify({ storeId: store.id, storeName: store.name, opsAdminId })),
    { ...cookieOpts, httpOnly: false },
  )

  return response
}

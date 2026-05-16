import { NextRequest } from 'next/server'
import { verifySession } from './session'
import { prisma } from './prisma'

/**
 * Checks if the caller is an authorized ops admin and returns their role.
 * Returns false if not authorized.
 *
 * Role hierarchy: SUPER_ADMIN > OPS_ADMIN > BD
 *
 * 合法 OPS 身份判定（任一命中即可）：
 *  1) session.opsRole ∈ {SUPER_ADMIN, OPS_ADMIN, BD}（OpsAdmin 表登录写入 session）
 *  2) userId === '_ops_admin'（legacy ops-only web 登录）→ SUPER_ADMIN
 *  3) OPS_USER_IDS 环境变量已配置且包含当前 userId → OPS_ADMIN
 *
 * 收紧：OPS_USER_IDS 未配置/为空时 **不再** 默认放行任何 OWNER。
 * 普通 OWNER / STAFF / 未登录一律 false。
 *
 * 行为矩阵：
 *   no auth                         → false
 *   STAFF                           → false
 *   OWNER (无任何 ops 标记)         → false
 *   OWNER + session.opsRole         → 对应 OpsRole
 *   userId === '_ops_admin'         → SUPER_ADMIN
 *   OWNER + userId ∈ OPS_USER_IDS   → OPS_ADMIN
 *
 * Dev 头 (x-role / x-user-id / x-ops-role) 仅在 NODE_ENV !== 'production'
 * 时作为兜底来源，避免生产被绕过。
 */
export type OpsRole = 'SUPER_ADMIN' | 'OPS_ADMIN' | 'BD'

/**
 * 异步 OPS 鉴权（必须 await）。在通过 session/whitelist 初步识别 ops 角色后，
 * 额外查 OpsAdmin 表校验 sessionVersion / status / lockedUntil，
 * 任何被踢出 / 禁用 / 锁定的旧 cookie 均返回 false。
 */
export async function checkOpsAuth(req: NextRequest): Promise<OpsRole | false> {
  const sessionToken = req.cookies.get('auth-session')?.value
  let userId: string | null = null
  let role: string | null = null
  let opsRole: string | null = null
  let opsSessionVersion: number | undefined = undefined

  if (sessionToken) {
    const session = verifySession(sessionToken)
    if (session) {
      userId = session.userId
      role = session.role
      opsRole = session.opsRole ?? null
      opsSessionVersion = session.opsSessionVersion
    }
  }

  // Dev x-* header fallback — 仅在非生产生效
  if (!role && process.env.NODE_ENV !== 'production') {
    role = req.headers.get('x-role')
    userId = req.headers.get('x-user-id')
    opsRole = req.headers.get('x-ops-role')
  }

  if (role !== 'OWNER') return false

  // 优先：session.opsRole（OpsAdmin 表登录写入）
  let candidate: OpsRole | null = null
  if (opsRole === 'SUPER_ADMIN' || opsRole === 'OPS_ADMIN' || opsRole === 'BD') {
    candidate = opsRole as OpsRole
  } else if (userId === '_ops_admin') {
    candidate = 'SUPER_ADMIN'
  } else {
    // OPS_USER_IDS 白名单
    const allowed = (process.env.OPS_USER_IDS ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean)
    if (allowed.length > 0 && userId != null && allowed.includes(userId)) {
      candidate = 'OPS_ADMIN'
    }
  }
  if (!candidate) return false

  // 仅对 OpsAdmin 表登录链路（candidate 来自 session.opsRole 且 userId 是 OpsAdmin.id）做强校验。
  // legacy 路径（_ops_admin / OPS_USER_IDS 白名单）无 sessionVersion 概念，沿用 candidate。
  const isOpsAdminSession = !!opsRole && !!userId && userId !== '_ops_admin'
  if (!isOpsAdminSession) return candidate

  try {
    const admin = await prisma.opsAdmin.findUnique({
      where: { id: userId! },
      select: { status: true, role: true, sessionVersion: true, lockedUntil: true },
    })
    if (!admin) return false
    if (admin.status !== 'ACTIVE') return false
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) return false
    if (opsSessionVersion == null) return false
    if (opsSessionVersion !== admin.sessionVersion) return false
    if (admin.role !== candidate) return false
    return candidate
  } catch {
    return false
  }
}

/**
 * 自检矩阵（设计期；非自动化测试）：
 *
 *   场景                                         期望结果
 *   ─────────────────────────────────────────── ────────────
 *   no auth                                       false
 *   STAFF cookie                                  false
 *   OWNER without ops grant (env empty)           false   ← 本次加固重点
 *   OWNER + OPS_USER_IDS contains userId          OPS_ADMIN
 *   OWNER + session.opsRole=OPS_ADMIN             OPS_ADMIN
 *   OWNER + session.opsRole=SUPER_ADMIN           SUPER_ADMIN
 *   OWNER + session.opsRole=BD                    BD
 *   userId='_ops_admin' (legacy)                  SUPER_ADMIN
 *   prod + only x-ops-role header (无 cookie)     false   ← 生产屏蔽 dev 头
 */

/** Returns true if the given ops role meets the minimum required role. */
export function hasOpsRole(actual: OpsRole, required: OpsRole): boolean {
  const rank: Record<OpsRole, number> = { SUPER_ADMIN: 3, OPS_ADMIN: 2, BD: 1 }
  return rank[actual] >= rank[required]
}

import { NextRequest } from 'next/server'
import { verifySession } from './session'

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

export function checkOpsAuth(req: NextRequest): OpsRole | false {
  const sessionToken = req.cookies.get('auth-session')?.value
  let userId: string | null = null
  let role: string | null = null
  let opsRole: string | null = null

  if (sessionToken) {
    const session = verifySession(sessionToken)
    if (session) {
      userId = session.userId
      role = session.role
      opsRole = session.opsRole ?? null
    }
  }

  // Dev x-* header fallback — 仅在非生产生效，避免线上被绕过
  if (!role && process.env.NODE_ENV !== 'production') {
    role = req.headers.get('x-role')
    userId = req.headers.get('x-user-id')
    opsRole = req.headers.get('x-ops-role')
  }

  if (role !== 'OWNER') return false

  // 1) session.opsRole（OpsAdmin 表登录写入）
  if (opsRole === 'SUPER_ADMIN') return 'SUPER_ADMIN'
  if (opsRole === 'OPS_ADMIN')   return 'OPS_ADMIN'
  if (opsRole === 'BD')          return 'BD'

  // 2) legacy _ops_admin
  if (userId === '_ops_admin') return 'SUPER_ADMIN'

  // 3) OPS_USER_IDS 白名单（必须显式配置且包含当前 userId 才放行）
  const allowed = (process.env.OPS_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (allowed.length > 0 && userId != null && allowed.includes(userId)) {
    return 'OPS_ADMIN'
  }

  return false
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

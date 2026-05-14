/**
 * lib/api.ts
 *
 * Thin fetch wrapper. 安全模型：
 *
 *  生产环境（NODE_ENV === 'production'）：
 *    - 默认不注入任何 x-* 身份头
 *    - 服务端 getContext 仅从 auth-session cookie 解析真实身份
 *    - 即使代码里漏传 ctxOverride，也不会出现 seed-tenant-001 跨租户访问
 *
 *  开发环境（NODE_ENV !== 'production'）：
 *    - 默认注入 STAFF_CTX，便于不带 cookie 测试
 *    - 仍可通过 ctxOverride 指定 OWNER_CTX
 *
 *  显式 ctxOverride 永远生效（dev 与 prod 都生效），便于本地脚本或 CI。
 *
 * 配合 lib/context.ts：cookie session 失效时 fallback 到 header；生产因 header 不存在
 * 直接返 null → 401，不会用 dev 死值越权。
 */

export type DevCtx = {
  'x-tenant-id': string
  'x-user-id': string
  'x-store-id': string
  'x-role': 'STAFF' | 'OWNER'
}

export const STAFF_CTX: DevCtx = {
  'x-tenant-id': 'seed-tenant-001',
  'x-user-id': 'seed-user-staff-a',
  'x-store-id': 'seed-store-a',
  'x-role': 'STAFF',
}

export const OWNER_CTX: DevCtx = {
  'x-tenant-id': 'seed-tenant-001',
  'x-user-id': 'seed-user-boss',
  'x-store-id': 'seed-store-a',
  'x-role': 'OWNER',
}

const IS_DEV = process.env.NODE_ENV !== 'production'

export async function apiFetch(
  path: string,
  init?: RequestInit,
  ctxOverride?: DevCtx,
) {
  // 仅 dev / 显式 override 时注入身份头；生产默认走 cookie session
  const ctx: DevCtx | undefined = ctxOverride ?? (IS_DEV ? STAFF_CTX : undefined)
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(ctx ?? {}),
      ...(init?.headers ?? {}),
    },
  })
  return res
}

/**
 * lib/api.ts
 *
 * Thin fetch wrapper that injects the dev identity headers.
 * Replace DEV_CTX with real JWT logic when auth is implemented.
 *
 * Pass ctxOverride to use a different identity context (e.g. OWNER for dashboard).
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

export async function apiFetch(
  path: string,
  init?: RequestInit,
  ctxOverride?: DevCtx,
) {
  const ctx = ctxOverride ?? STAFF_CTX
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...ctx,
      ...(init?.headers ?? {}),
    },
  })
  return res
}

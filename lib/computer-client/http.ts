import { NextResponse } from 'next/server'
import { ComputerClientSecretError, assertComputerClientSecretConfigured } from './crypto'

/**
 * 电脑客户端接口的统一响应工具。
 * 独立于 lib/desktop-activation/http.ts，避免新旧链路互相耦合。
 */

export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export function noStoreJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body as Record<string, unknown>, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...(init?.headers ?? {}) },
  })
}

export function apiError(error: string, status: number, extra?: Record<string, unknown>) {
  return noStoreJson({ error, ...(extra ?? {}) }, { status })
}

/**
 * 电脑客户端全部接口（含 OWNER 列表 / 批准 / 拒绝）的统一入口：
 *   1. 先检查 COMPUTER_CLIENT_TOKEN_SECRET —— 缺失时 7 个接口一律 fail-closed，
 *      不允许出现「OWNER 接口能用、Agent 接口不能用」的半启用状态；
 *   2. 密钥未配置 → 500，不降级；
 *   3. 其它异常   → 500，不回显内部细节。
 */
export async function withComputerClientApiError(handler: () => Promise<Response>) {
  try {
    assertComputerClientSecretConfigured()
    return await handler()
  } catch (err) {
    if (err instanceof ComputerClientSecretError) {
      console.error('[computer-client] COMPUTER_CLIENT_TOKEN_SECRET 未配置')
      return apiError('SERVICE_NOT_CONFIGURED', 500)
    }
    console.error('[computer-client] 未处理异常', err)
    return apiError('SERVER_ERROR', 500)
  }
}

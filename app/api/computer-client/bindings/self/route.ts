import { NextRequest } from 'next/server'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import {
  authenticateAgent,
  persistExpiryIfNeeded,
  serializeRequestState,
} from '@/lib/computer-client/service'

/**
 * 查询本机申请状态（Agent 侧，claim 通道）。
 *
 * 只返回状态，不返回门店信息、不返回任何凭证。
 * 批准后 Agent 应改用本机已持有的 deviceSecret 调用 /self/bind 完成绑定。
 */
export async function GET(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const auth = await authenticateAgent(req, 'claim')
    if (!auth.ok) return apiError(auth.error, auth.status)

    const binding = await persistExpiryIfNeeded(auth.binding)
    return noStoreJson(serializeRequestState(binding))
  })
}

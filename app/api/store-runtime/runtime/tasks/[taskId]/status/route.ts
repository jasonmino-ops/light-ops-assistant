import { NextRequest, NextResponse } from 'next/server'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { parseStoreRuntimeTaskProgressInput } from '@/lib/store-runtime/contract'
import {
  STORE_RUNTIME_NO_STORE_HEADERS,
  readStoreRuntimeJson,
  storeRuntimeErrorResponse,
} from '@/lib/store-runtime/http'
import { updateStoreRuntimePrintTask } from '@/lib/store-runtime/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TASK_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ taskId: string }> },
) {
  const auth = await getDesktopDeviceContext(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: STORE_RUNTIME_NO_STORE_HEADERS })
  }
  try {
    const { taskId } = await context.params
    if (!TASK_ID_PATTERN.test(taskId)) {
      return NextResponse.json({ error: 'STORE_RUNTIME_INVALID_TASK_ID' }, { status: 400, headers: STORE_RUNTIME_NO_STORE_HEADERS })
    }
    const input = parseStoreRuntimeTaskProgressInput(await readStoreRuntimeJson(req))
    const task = await updateStoreRuntimePrintTask(auth.context, taskId, input)
    return NextResponse.json({ task }, { headers: STORE_RUNTIME_NO_STORE_HEADERS })
  } catch (error) {
    return storeRuntimeErrorResponse(error)
  }
}

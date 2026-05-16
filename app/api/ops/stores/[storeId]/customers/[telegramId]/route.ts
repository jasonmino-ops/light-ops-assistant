/**
 * PATCH /api/ops/stores/[storeId]/customers/[telegramId]
 *
 * 后台对某顾客做最小维护：
 *   - 备注：{ opsNote: string }
 *   - 标记异常 / 取消异常：{ status: 'flagged' | 'active' }
 *   - 解除错误绑定：{ status: 'revoked' }
 *
 * 所有动作写入 OperationLog（actionType='OPS_CUSTOMER_PATCH'，payloadSnapshot 含 before/after）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuth } from '@/lib/ops-auth'

const VALID_STATUS = new Set(['active', 'flagged', 'revoked'])
const MAX_NOTE = 500

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string; telegramId: string }> },
) {
  const role = await checkOpsAuth(req)
  if (!role) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const { storeId, telegramId } = await params
  const tgId = decodeURIComponent(telegramId).trim()
  if (!tgId) return NextResponse.json({ error: 'INVALID_PARAMS' }, { status: 400 })

  let body: { opsNote?: string; status?: string; reason?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 }) }

  const store = await prisma.store.findUnique({
    where:  { id: storeId },
    select: { id: true, code: true, tenantId: true },
  })
  if (!store) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })

  const contact = await prisma.storeCustomerContact.findFirst({
    where: { tenantId: store.tenantId, storeCode: store.code, telegramId: tgId },
  })
  if (!contact) return NextResponse.json({ error: 'CUSTOMER_NOT_FOUND' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (typeof body.opsNote === 'string') {
    const v = body.opsNote.trim().slice(0, MAX_NOTE)
    data.opsNote = v.length > 0 ? v : null
  }
  if (typeof body.status === 'string') {
    if (!VALID_STATUS.has(body.status)) {
      return NextResponse.json({ error: 'INVALID_STATUS' }, { status: 400 })
    }
    data.status = body.status
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'NO_CHANGES' }, { status: 400 })
  }

  const before = { status: contact.status, opsNote: contact.opsNote ?? null }
  const updated = await prisma.storeCustomerContact.update({
    where: { id: contact.id },
    data,
    select: { id: true, status: true, opsNote: true, telegramId: true },
  })
  const after = { status: updated.status, opsNote: updated.opsNote ?? null }

  // 审计日志（不阻塞响应，复用 OperationLog）
  await prisma.operationLog.create({
    data: {
      tenantId:   store.tenantId,
      storeId:    store.id,
      userId:     null,
      actionType: 'OPS_CUSTOMER_PATCH',
      targetType: 'StoreCustomerContact',
      targetId:   contact.id,
      status:     'SUCCESS',
      message:    body.reason ?? null,
      payloadSnapshot: {
        opsRole: role,
        telegramId: tgId,
        before, after,
      },
    },
  }).catch((e) => console.error('[ops customer patch] audit log failed:', e))

  return NextResponse.json({ ok: true, status: updated.status, opsNote: updated.opsNote })
}

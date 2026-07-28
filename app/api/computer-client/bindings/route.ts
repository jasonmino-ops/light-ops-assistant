import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  getBindingRequestExpiresAt,
  hashClaimSecret,
  hashDeviceSecret,
  hashInstallationId,
  isValidClaimSecretFormat,
  isValidDeviceSecretFormat,
  isValidInstallationId,
  safeHashEqual,
} from '@/lib/computer-client/crypto'
import { apiError, noStoreJson, withComputerClientApiError } from '@/lib/computer-client/http'
import { auditRequestFingerprint, writeComputerBindingAudit } from '@/lib/computer-client/audit'
import {
  INSTALLATION_HEADER,
  normalizeSubmitInput,
  persistExpiryIfNeeded,
  serializeRequestState,
} from '@/lib/computer-client/service'

/** 最小防滥用：同一门店 1 小时内最多堆积的待审批申请数 */
const MAX_PENDING_PER_STORE = 20
const PENDING_WINDOW_MS = 60 * 60 * 1000

/**
 * 提交绑定申请（Agent 侧，无会话）。
 *
 * 幂等键 = installationIdHash。凭证明文由 Agent 本机生成后随首次提交上送，
 * 云端只保存哈希。因为凭证不由云端下发，本接口响应丢失时重发即可恢复，
 * 不存在「首次响应丢失导致永久失联」。
 *
 * 幂等语义：
 *   PENDING                      → 返回同一条申请（不新建）
 *   APPROVED                     → ALREADY_APPROVED，不新建
 *   REJECTED/CANCELLED/EXPIRED   → 允许发起新一轮，复用同一行重置为 PENDING
 */
export async function POST(req: NextRequest) {
  return withComputerClientApiError(async () => {
    const installationId = req.headers.get(INSTALLATION_HEADER)?.trim() ?? ''
    if (!isValidInstallationId(installationId)) return apiError('INSTALLATION_ID_INVALID', 400)

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return apiError('INVALID_BODY', 400)
    }

    const claimSecret = body.claimSecret
    const deviceSecret = body.deviceSecret
    if (!isValidClaimSecretFormat(claimSecret)) return apiError('CLAIM_SECRET_INVALID', 400)
    if (!isValidDeviceSecretFormat(deviceSecret)) return apiError('DEVICE_SECRET_INVALID', 400)

    const { storeCode, computerName, agentVersion, deviceInfo } = normalizeSubmitInput(body)
    if (!storeCode) return apiError('STORE_CODE_REQUIRED', 400)
    if (!computerName) return apiError('COMPUTER_NAME_REQUIRED', 400)

    const installationIdHash = hashInstallationId(installationId)
    const claimSecretHash = hashClaimSecret(claimSecret)
    const deviceSecretHash = hashDeviceSecret(deviceSecret)
    const fingerprint = auditRequestFingerprint(req)

    const existing = await prisma.computerBinding.findUnique({ where: { installationIdHash } })

    // ── 已有记录：先验 claim 凭证，再按状态决定幂等行为 ──────────────────────
    if (existing) {
      if (!safeHashEqual(claimSecretHash, existing.claimSecretHash)) {
        await writeComputerBindingAudit(prisma, {
          tenantId: existing.tenantId,
          storeId: existing.storeId,
          bindingId: existing.id,
          eventType: 'COMPUTER_BINDING_SUBMIT',
          result: 'DENIED',
          reasonCode: 'CLAIM_MISMATCH',
          ...fingerprint,
        })
        return apiError('INSTALLATION_ALREADY_CLAIMED', 409)
      }

      const current = await persistExpiryIfNeeded(existing)

      if (current.status === 'PENDING') {
        // 幂等重提：只在数据库中「仍然是 PENDING」时才允许刷新申请字段与凭证材料。
        //
        // 必须用条件更新，不能先读后无条件 update：否则 OWNER 的 approve 若先落库，
        // 这里较晚到达的重提会把已经激活的 deviceSecretHash 覆盖掉，
        // 导致已批准的设备凭证被悄悄替换。
        const refresh = await prisma.computerBinding.updateMany({
          where: { id: current.id, status: 'PENDING' },
          data: { computerName, agentVersion, deviceInfo, claimSecretHash, deviceSecretHash },
        })
        // 竞态输了（approve/reject/cancel/expire 已经先落库）：
        // 只回读最终状态，绝不修改任何凭证材料。
        const latest = await prisma.computerBinding.findUnique({ where: { id: current.id } })
        if (!latest) return apiError('REQUEST_NOT_FOUND', 404)
        return noStoreJson({
          ...serializeRequestState(latest),
          idempotent: true,
          ...(refresh.count === 0 ? { credentialsFrozen: true } : {}),
        })
      }
      if (current.status === 'APPROVED') {
        // 已批准：不再新建申请，也绝不替换凭证材料；
        // Agent 应改用本机 deviceSecret 调 /bind 完成绑定确认。
        return noStoreJson({ ...serializeRequestState(current), idempotent: true, credentialsFrozen: true })
      }

      // REJECTED / CANCELLED / EXPIRED → 允许重新申请
      const store = await prisma.store.findFirst({
        where: { code: storeCode, status: 'ACTIVE' },
        select: { id: true, tenantId: true },
      })
      if (!store) return apiError('STORE_NOT_FOUND', 404)

      // 同样使用条件更新：只有仍处于终止态才允许重新开启并刷新凭证材料
      const reopen = await prisma.computerBinding.updateMany({
        where: { id: current.id, status: { in: ['REJECTED', 'CANCELLED', 'EXPIRED'] } },
        data: {
          tenantId: store.tenantId,
          storeId: store.id,
          computerName,
          agentVersion,
          deviceInfo,
          status: 'PENDING',
          requestedAt: new Date(),
          expiresAt: getBindingRequestExpiresAt(),
          claimSecretHash,
          deviceSecretHash,
          credentialStatus: 'PENDING',
          credentialActivatedAt: null,
          credentialExpiresAt: null,
          decidedByUserId: null,
          decidedAt: null,
          boundAt: null,
        },
      })
      const reopened = await prisma.computerBinding.findUnique({ where: { id: current.id } })
      if (!reopened) return apiError('REQUEST_NOT_FOUND', 404)
      if (reopen.count === 0) {
        // 竞态输了：状态已被其它请求改变，不动凭证，直接回读
        return noStoreJson({ ...serializeRequestState(reopened), idempotent: true, credentialsFrozen: true })
      }
      await writeComputerBindingAudit(prisma, {
        tenantId: reopened.tenantId,
        storeId: reopened.storeId,
        bindingId: reopened.id,
        eventType: 'COMPUTER_BINDING_SUBMIT',
        result: 'SUCCESS',
        reasonCode: 'REOPENED',
        metadata: { storeCode, agentVersion: agentVersion ?? undefined, previousStatus: current.status },
        ...fingerprint,
      })
      return noStoreJson(serializeRequestState(reopened))
    }

    // ── 首次提交 ────────────────────────────────────────────────────────────
    const store = await prisma.store.findFirst({
      where: { code: storeCode, status: 'ACTIVE' },
      select: { id: true, tenantId: true },
    })
    if (!store) return apiError('STORE_NOT_FOUND', 404)

    // 最小防滥用：公开接口，限制同一门店短时间内可堆积的待审批申请数量。
    // 不引入额外系统，用数据库计数即可跨实例生效。
    const recentPending = await prisma.computerBinding.count({
      where: {
        storeId: store.id,
        status: 'PENDING',
        requestedAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) },
      },
    })
    if (recentPending >= MAX_PENDING_PER_STORE) {
      await writeComputerBindingAudit(prisma, {
        tenantId: store.tenantId,
        storeId: store.id,
        eventType: 'COMPUTER_BINDING_SUBMIT',
        result: 'DENIED',
        reasonCode: 'RATE_LIMITED',
        metadata: { storeCode },
        ...fingerprint,
      })
      return apiError('TOO_MANY_REQUESTS', 429)
    }

    const created = await prisma.computerBinding.create({
      data: {
        tenantId: store.tenantId,
        storeId: store.id,
        installationIdHash,
        computerName,
        agentVersion,
        deviceInfo,
        status: 'PENDING',
        expiresAt: getBindingRequestExpiresAt(),
        claimSecretHash,
        deviceSecretHash,
        credentialStatus: 'PENDING',
      },
    })
    await writeComputerBindingAudit(prisma, {
      tenantId: created.tenantId,
      storeId: created.storeId,
      bindingId: created.id,
      eventType: 'COMPUTER_BINDING_SUBMIT',
      result: 'SUCCESS',
      metadata: { storeCode, agentVersion: agentVersion ?? undefined, status: 'PENDING' },
      ...fingerprint,
    })

    return noStoreJson(serializeRequestState(created), { status: 201 })
  })
}

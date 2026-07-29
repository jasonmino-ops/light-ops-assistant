import type { NextRequest } from 'next/server'
import type { ComputerBinding } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  hashClaimSecret,
  hashDeviceSecret,
  hashInstallationId,
  isValidClaimSecretFormat,
  isValidDeviceSecretFormat,
  isValidInstallationId,
  safeHashEqual,
} from './crypto'

/**
 * 电脑客户端服务层。
 *
 * 两条互不相通的凭证通道：
 *   - claim  ：提交 / 查询 / 取消绑定申请
 *   - device ：批准后确认绑定、读取本机绑定态
 * 两者都只能操作「自己这一行」，任何情况下都不进 getContext、拿不到 OWNER/STAFF 会话。
 */

export const INSTALLATION_HEADER = 'x-installation-id'

export type AgentChannel = 'claim' | 'device'

export type AgentAuthFailure = { ok: false; status: number; error: string }
export type AgentAuthSuccess = { ok: true; binding: ComputerBinding }
export type AgentAuthResult = AgentAuthFailure | AgentAuthSuccess

function readBearer(req: NextRequest) {
  const raw = req.headers.get('authorization') ?? ''
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match?.[1]?.trim() ?? ''
}

/** PENDING 且已过 expiresAt → 视为 EXPIRED（惰性判定，不需要定时任务） */
export function isExpiredPending(binding: ComputerBinding, now = new Date()) {
  return binding.status === 'PENDING' && binding.expiresAt.getTime() <= now.getTime()
}

export function effectiveStatus(binding: ComputerBinding, now = new Date()) {
  if (binding.disabledAt) return 'DISABLED'
  return isExpiredPending(binding, now) ? 'EXPIRED' : binding.status
}

/**
 * 把惰性过期固化到库里（原子）。
 * 用 updateMany + status/expiresAt 守卫，避免与 approve/reject/cancel 竞态：
 * 并发时只有一方能把 PENDING 改走。
 */
export async function persistExpiryIfNeeded(binding: ComputerBinding, now = new Date()) {
  if (!isExpiredPending(binding, now)) return binding
  const res = await prisma.computerBinding.updateMany({
    where: { id: binding.id, status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', credentialStatus: 'VOID' },
  })
  if (res.count === 0) {
    // 竞态输了：别人已经改过状态，回读真实结果
    return (await prisma.computerBinding.findUnique({ where: { id: binding.id } })) ?? binding
  }
  return (await prisma.computerBinding.findUnique({ where: { id: binding.id } })) ?? binding
}

/**
 * PENDING → 目标状态的原子转移。
 *
 * 只有 status 仍为 PENDING 的那一次调用会成功（count === 1），
 * 并发批准 / 拒绝 / 取消 / 过期中只可能有一个赢家；
 * 输的一方拿到 null，由调用方回读真实状态返回 INVALID_STATE。
 */
export async function transitionFromPending(
  scope: { id: string; tenantId?: string; storeId?: string },
  data: Record<string, unknown>,
): Promise<{ won: boolean; binding: ComputerBinding | null }> {
  const res = await prisma.computerBinding.updateMany({
    where: {
      id: scope.id,
      status: 'PENDING',
      ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
      ...(scope.storeId ? { storeId: scope.storeId } : {}),
    },
    data,
  })
  const binding = await prisma.computerBinding.findUnique({ where: { id: scope.id } })
  return { won: res.count === 1, binding }
}

/**
 * Agent 侧鉴权：installationId + 对应通道的 secret。
 * 一律返回 401，不区分「安装不存在」与「凭证不对」，避免探测。
 */
export async function authenticateAgent(
  req: NextRequest,
  channel: AgentChannel,
): Promise<AgentAuthResult> {
  const installationId = req.headers.get(INSTALLATION_HEADER)?.trim() ?? ''
  const secret = readBearer(req)

  if (!isValidInstallationId(installationId)) {
    return { ok: false, status: 401, error: 'AGENT_AUTH_REQUIRED' }
  }
  const validFormat =
    channel === 'claim' ? isValidClaimSecretFormat(secret) : isValidDeviceSecretFormat(secret)
  if (!validFormat) {
    return { ok: false, status: 401, error: 'AGENT_AUTH_REQUIRED' }
  }

  const binding = await prisma.computerBinding.findUnique({
    where: { installationIdHash: hashInstallationId(installationId) },
  })
  if (!binding) return { ok: false, status: 401, error: 'AGENT_AUTH_REQUIRED' }

  const expectedHash =
    channel === 'claim' ? hashClaimSecret(secret) : hashDeviceSecret(secret)
  const storedHash = channel === 'claim' ? binding.claimSecretHash : binding.deviceSecretHash
  if (!safeHashEqual(expectedHash, storedHash)) {
    return { ok: false, status: 401, error: 'AGENT_AUTH_REQUIRED' }
  }

  // 设备通道：批准前不可用，且凭证过期即失效（credentialExpiresAt 真实参与鉴权）
  if (channel === 'device') {
    if (binding.disabledAt) {
      return { ok: false, status: 403, error: 'COMPUTER_DISABLED' }
    }
    if (binding.credentialStatus !== 'ACTIVE') {
      return { ok: false, status: 403, error: 'CREDENTIAL_NOT_ACTIVE' }
    }
    if (binding.credentialExpiresAt && binding.credentialExpiresAt.getTime() <= Date.now()) {
      return { ok: false, status: 403, error: 'CREDENTIAL_EXPIRED' }
    }
  }

  return { ok: true, binding }
}

/**
 * Agent 申请阶段可见的信息：只有状态，不含门店信息。
 * 批准前不提前泄露门店名。
 */
export function serializeRequestState(binding: ComputerBinding, now = new Date()) {
  return {
    requestId: binding.id,
    status: effectiveStatus(binding, now),
    computerName: binding.computerName,
    requestedAt: binding.requestedAt.toISOString(),
    expiresAt: binding.expiresAt.toISOString(),
    decidedAt: binding.decidedAt?.toISOString() ?? null,
    /** 已批准但尚未用 deviceSecret 确认绑定 */
    bindingConfirmed: Boolean(binding.boundAt),
  }
}

/**
 * 绑定完成后下发给 Agent 的最小集合。
 * 明确不含 tenantId；storeId 本阶段 Agent 用不到，也不下发。
 */
export function serializeBoundResult(
  binding: ComputerBinding,
  store: { code: string; name: string },
) {
  return {
    computerId: binding.id,
    storeCode: store.code,
    storeName: store.name,
    computerName: binding.computerName,
    boundAt: binding.boundAt?.toISOString() ?? null,
    credentialExpiresAt: binding.credentialExpiresAt?.toISOString() ?? null,
  }
}

/** OWNER 列表项：不含任何凭证信息 */
export function serializeOwnerRequest(binding: ComputerBinding) {
  const info = (binding.deviceInfo ?? {}) as Record<string, unknown>
  const osVersion = typeof info.osVersion === 'string' ? info.osVersion : null
  return {
    requestId: binding.id,
    computerName: binding.computerName,
    agentVersion: binding.agentVersion,
    osVersion,
    status: binding.status,
    requestedAt: binding.requestedAt.toISOString(),
    expiresAt: binding.expiresAt.toISOString(),
  }
}

/** OWNER 已绑定 / 已停用列表项：只含管理页面所需字段。 */
export function serializeManagedComputer(binding: ComputerBinding) {
  return {
    computerId: binding.id,
    computerName: binding.computerName,
    agentVersion: binding.agentVersion,
    boundAt: binding.boundAt?.toISOString() ?? null,
    disabledAt: binding.disabledAt?.toISOString() ?? null,
    status: binding.disabledAt ? 'DISABLED' : 'ACTIVE',
  }
}

/** 校验并规范化提交上来的申请字段 */
export function normalizeSubmitInput(body: Record<string, unknown>) {
  const storeCode = typeof body.storeCode === 'string' ? body.storeCode.trim() : ''
  const computerName =
    typeof body.computerName === 'string' ? body.computerName.trim().slice(0, 64) : ''
  const agentVersion =
    typeof body.agentVersion === 'string' ? body.agentVersion.trim().slice(0, 32) : null

  const rawInfo = (body.deviceInfo ?? {}) as Record<string, unknown>
  const pick = (key: string) => {
    const value = rawInfo[key]
    return typeof value === 'string' ? value.slice(0, 128) : undefined
  }
  // 只保留审批展示需要的字段，其余一律丢弃
  const deviceInfo = {
    osVersion: pick('osVersion'),
    arch: pick('arch'),
    timeZone: pick('timeZone'),
  }

  return { storeCode, computerName, agentVersion, deviceInfo }
}

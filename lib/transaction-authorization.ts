import { NextRequest, NextResponse } from 'next/server'
import { getContext, type RequestContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import { getDesktopDeviceContext } from '@/lib/desktop-activation/auth'
import { authorizeBrowserPosDevice, type BrowserPosStoreScope } from '@/lib/browser-pos-device'
import {
  isPersonnelTransactionOperation,
  isPosDeviceOperation,
  type PosDeviceOperation,
  type TransactionOperation,
} from '@/lib/transaction-policy-types'

export type CanonicalTransactionStore = BrowserPosStoreScope

export type TransactionActorType = 'OWNER' | 'STAFF' | 'BROWSER_POS_DEVICE' | 'DESKTOP_POS_DEVICE'
export type TransactionAuthorizationSource = 'AUTH_SESSION' | 'POS_DEVICE_V1' | 'DESKTOP_EDT_V1'

export type TransactionAuthorization = {
  actorType: TransactionActorType
  actorId: string
  /** Legacy required User FK used by current SaleRecord/PaymentIntent rows. */
  userId: string
  tenantId: string
  storeId: string
  storeCode: string | null
  role: 'OWNER' | 'STAFF' | null
  deviceType: 'BROWSER_POS' | 'DESKTOP' | null
  deviceId: string | null
  scopes: readonly string[]
  source: TransactionAuthorizationSource
  authorizedByUserId: string | null
  legacyOperatorUserId: string
  tokenStatus: 'ACTIVE'
}

export type TransactionAuthorizationFailure = {
  ok: false
  status: 401 | 403 | 503
  error: string
  message: string
}

export type TransactionAuthorizationResult =
  | { ok: true; authorization: TransactionAuthorization }
  | TransactionAuthorizationFailure

function failure(status: 401 | 403 | 503, error: string, message: string): TransactionAuthorizationFailure {
  return { ok: false, status, error, message }
}

export function transactionAuthorizationErrorResponse(result: TransactionAuthorizationFailure) {
  return NextResponse.json({ error: result.error, message: result.message }, { status: result.status })
}

export function hasDesktopDeviceCredential(req: NextRequest) {
  return /^Bearer\s+\S+$/i.test(req.headers.get('authorization')?.trim() ?? '')
}

export function hasBrowserDeviceCredential(req: NextRequest) {
  return Boolean(req.headers.get('x-pos-device-token')?.trim() || req.headers.get('x-pos-device-id')?.trim())
}

async function authorizePersonnel(
  ctx: RequestContext,
  expectedStore?: CanonicalTransactionStore,
): Promise<TransactionAuthorizationResult> {
  if (expectedStore && ctx.tenantId !== expectedStore.tenantId) {
    return failure(403, 'DEVICE_STORE_MISMATCH', '当前身份无权访问该门店。')
  }
  if (ctx.role === 'STAFF') {
    const storeId = expectedStore?.storeId ?? ctx.storeId
    if (ctx.storeId !== storeId) {
      return failure(403, 'DEVICE_STORE_MISMATCH', '员工只能操作所属门店。')
    }
    const activeRole = await prisma.userStoreRole.findFirst({
      where: {
        tenantId: expectedStore?.tenantId ?? ctx.tenantId,
        storeId,
        userId: ctx.userId,
        status: 'ACTIVE',
      },
      select: { id: true, role: true },
    })
    if (!activeRole) return failure(403, 'TRANSACTION_SCOPE_FORBIDDEN', '员工门店权限已失效。')
  }

  return {
    ok: true,
    authorization: {
      actorType: ctx.role,
      actorId: ctx.userId,
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      storeId: expectedStore?.storeId ?? ctx.storeId,
      storeCode: expectedStore?.storeCode ?? null,
      role: ctx.role,
      deviceType: null,
      deviceId: null,
      scopes: ['PERSONNEL_TRANSACTION'],
      source: 'AUTH_SESSION',
      authorizedByUserId: ctx.userId,
      legacyOperatorUserId: ctx.userId,
      tokenStatus: 'ACTIVE',
    },
  }
}

async function validateDeviceOperator(input: {
  tenantId: string
  storeId: string
  userId: string | null
}): Promise<string | null> {
  if (!input.userId) return null
  const role = await prisma.userStoreRole.findFirst({
    where: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      userId: input.userId,
      status: 'ACTIVE',
      user: { status: 'ACTIVE' },
    },
    select: { userId: true },
  })
  return role?.userId ?? null
}

async function resolveDesktopAuthorizedByUser(deviceId: string, tenantId: string, storeId: string) {
  const activation = await prisma.desktopActivationPin.findFirst({
    where: {
      tenantId,
      storeId,
      usedByDeviceId: deviceId,
    },
    orderBy: { usedAt: 'desc' },
    select: { createdByUserId: true },
  })
  return validateDeviceOperator({ tenantId, storeId, userId: activation?.createdByUserId ?? null })
}

/**
 * The only transaction identity gate. Weak request hints never enter this decision:
 * a store is resolved server-side and callers must pass its canonical identity.
 */
export async function authorizeTransaction(
  req: NextRequest,
  input: { operation: TransactionOperation; store?: CanonicalTransactionStore },
): Promise<TransactionAuthorizationResult> {
  const expectedStore = input.store
  const session = await getContext(req)

  if (isPersonnelTransactionOperation(input.operation)) {
    if (!session) return failure(401, 'TRANSACTION_AUTH_REQUIRED', '请先完成账号验证。')
    return authorizePersonnel(session, expectedStore)
  }

  if (!isPosDeviceOperation(input.operation)) {
    return failure(403, 'TRANSACTION_SCOPE_FORBIDDEN', '该交易操作未配置授权策略。')
  }
  if (!expectedStore) return failure(403, 'TRANSACTION_STORE_REQUIRED', '交易授权必须绑定明确门店。')

  // A valid personnel session remains a valid existing POS path. It does not turn
  // device headers into authority, and its store membership is checked above.
  if (session) return authorizePersonnel(session, expectedStore)

  const desktopCredential = hasDesktopDeviceCredential(req)
  const browserCredential = hasBrowserDeviceCredential(req)
  if (desktopCredential && browserCredential) {
    return failure(403, 'TRANSACTION_AUTH_CONFLICT', '同一请求不能混用 Browser 与 Desktop 设备凭证。')
  }

  if (desktopCredential) {
    const desktop = await getDesktopDeviceContext(req, { updateLastSeen: true })
    if (!desktop.ok) return failure(desktop.status as 401 | 403 | 503, desktop.error, 'Desktop 设备当前不可用于交易。')
    if (desktop.context.tenantId !== expectedStore.tenantId || desktop.context.storeId !== expectedStore.storeId) {
      return failure(403, 'DEVICE_STORE_MISMATCH', 'Desktop 设备与交易门店不匹配。')
    }
    const authorizedByUserId = await resolveDesktopAuthorizedByUser(
      desktop.context.deviceId,
      desktop.context.tenantId,
      desktop.context.storeId,
    )
    if (!authorizedByUserId) {
      return failure(403, 'DESKTOP_DEVICE_OPERATOR_UNAVAILABLE', 'Desktop 设备缺少有效的门店授权人。')
    }
    return {
      ok: true,
      authorization: {
        actorType: 'DESKTOP_POS_DEVICE',
        actorId: desktop.context.deviceId,
        userId: authorizedByUserId,
        tenantId: desktop.context.tenantId,
        storeId: desktop.context.storeId,
        storeCode: expectedStore.storeCode,
        role: null,
        deviceType: 'DESKTOP',
        deviceId: desktop.context.deviceId,
        scopes: [input.operation],
        source: 'DESKTOP_EDT_V1',
        authorizedByUserId,
        legacyOperatorUserId: authorizedByUserId,
        tokenStatus: 'ACTIVE',
      },
    }
  }

  if (browserCredential) {
    const browser = await authorizeBrowserPosDevice(req, expectedStore, input.operation as PosDeviceOperation)
    if (!browser.ok) return failure(browser.status, browser.error, 'Browser POS 设备当前不可用于交易。')
    const legacyOperatorUserId = await validateDeviceOperator({
      tenantId: browser.authorization.tenantId,
      storeId: browser.authorization.storeId,
      userId: browser.authorization.authorizedByUserId,
    })
    if (!legacyOperatorUserId) {
      return failure(403, 'BROWSER_DEVICE_OPERATOR_UNAVAILABLE', 'Browser POS 设备缺少有效的门店授权人。')
    }
    return {
      ok: true,
      authorization: {
        actorType: 'BROWSER_POS_DEVICE',
        actorId: browser.authorization.principalId,
        userId: legacyOperatorUserId,
        tenantId: browser.authorization.tenantId,
        storeId: browser.authorization.storeId,
        storeCode: browser.authorization.storeCode,
        role: null,
        deviceType: 'BROWSER_POS',
        deviceId: browser.authorization.browserDeviceId,
        scopes: browser.authorization.scopes,
        source: browser.authorization.source,
        authorizedByUserId: browser.authorization.authorizedByUserId,
        legacyOperatorUserId,
        tokenStatus: 'ACTIVE',
      },
    }
  }

  return failure(401, 'TRANSACTION_AUTH_REQUIRED', '请先完成账号验证或设备授权。')
}

/** Enforces the server-resolved store after a resource lookup for personnel-only routes. */
export async function authorizeTransactionForStore(
  req: NextRequest,
  input: { operation: TransactionOperation; store: CanonicalTransactionStore },
) {
  return authorizeTransaction(req, input)
}

export function transactionActorAuditData(authorization: TransactionAuthorization) {
  return {
    transactionActorType: authorization.actorType,
    transactionActorId: authorization.actorId,
    authorizedByUserId: authorization.authorizedByUserId,
  }
}

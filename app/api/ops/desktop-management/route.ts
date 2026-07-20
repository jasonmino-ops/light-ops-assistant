import type { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkOpsAuthContext, hasOpsRole } from '@/lib/ops-auth'
import { computeDesktopSubscriptionAccess } from '@/lib/desktop-activation/subscription-access'
import { apiError, noStoreJson, withDesktopApiError } from '@/lib/desktop-activation/http'
import {
  CURRENT_DESKTOP_VERSION,
  DESKTOP_ACTIVATION_RUNTIME_VERSION,
  currentPinStatus,
  deriveDesktopManagementStatus,
  desktopAuditCategory,
  desktopAuditEventLabel,
  shortDeviceReference,
} from '@/lib/ops-desktop-management'

const MAX_PAGE_SIZE = 50
const AUDIT_LOOKBACK_LIMIT = 500

async function requireOpsAdmin(req: NextRequest) {
  const ops = await checkOpsAuthContext(req)
  if (!ops) return { ok: false as const, response: apiError('FORBIDDEN', 403) }
  if (!hasOpsRole(ops.role, 'OPS_ADMIN')) {
    return { ok: false as const, response: apiError('OPS_ADMIN_REQUIRED', 403) }
  }
  return { ok: true as const, ops }
}

function cleanQuery(value: string | null) {
  return (value ?? '').trim().slice(0, 100)
}

function positiveInt(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(parsed, max)
}

function pageInput(req: NextRequest) {
  return {
    page: positiveInt(req.nextUrl.searchParams.get('page'), 1),
    pageSize: positiveInt(req.nextUrl.searchParams.get('pageSize'), 12, MAX_PAGE_SIZE),
  }
}

function storeSearchWhere(query: string): Prisma.StoreWhereInput {
  if (!query) return {}
  return {
    OR: [
      { code: { contains: query, mode: 'insensitive' } },
      { name: { contains: query, mode: 'insensitive' } },
      { tenant: { name: { contains: query, mode: 'insensitive' } } },
    ],
  }
}

function deviceSearchWhere(query: string): Prisma.DesktopDeviceWhereInput {
  if (!query) return {}
  return {
    OR: [
      { store: { code: { contains: query, mode: 'insensitive' } } },
      { store: { name: { contains: query, mode: 'insensitive' } } },
      { tenant: { name: { contains: query, mode: 'insensitive' } } },
    ],
  }
}

function auditSearchWhere(query: string): Prisma.DesktopActivationAuditWhereInput {
  if (!query) return {}
  return {
    OR: [
      { store: { code: { contains: query, mode: 'insensitive' } } },
      { store: { name: { contains: query, mode: 'insensitive' } } },
      { tenant: { name: { contains: query, mode: 'insensitive' } } },
    ],
  }
}

async function storesView(req: NextRequest) {
  const query = cleanQuery(req.nextUrl.searchParams.get('query'))
  const { page, pageSize } = pageInput(req)
  const where = storeSearchWhere(query)
  const [total, stores] = await prisma.$transaction([
    prisma.store.count({ where }),
    prisma.store.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        tenant: {
          select: {
            id: true,
            name: true,
            status: true,
            subscription: {
              select: { status: true, trialEndsAt: true, currentPeriodEndsAt: true },
            },
          },
        },
        desktopDevices: {
          select: {
            status: true,
            tokenExpiresAt: true,
            lastSeenAt: true,
            activatedAt: true,
          },
          orderBy: { activatedAt: 'desc' },
        },
        desktopActivationPins: {
          select: { status: true, expiresAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: [{ tenant: { name: 'asc' } }, { code: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  const now = new Date()
  return noStoreJson({
    view: 'stores',
    query,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    stores: stores.map((store) => {
      const subscription = computeDesktopSubscriptionAccess(store.tenant.subscription?.status ?? 'ACTIVE')
      const activeDevices = store.desktopDevices.filter((device) => device.status === 'ACTIVE')
      const lastVerification = store.desktopDevices
        .map((device) => device.lastSeenAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
      const blocked = store.status !== 'ACTIVE'
        || store.tenant.status !== 'ACTIVE'
        || subscription.accessState !== 'ALLOWED'

      return {
        storeId: store.id,
        storeCode: store.code,
        storeName: store.name,
        storeStatus: store.status,
        tenantId: store.tenant.id,
        tenantName: store.tenant.name,
        tenantStatus: store.tenant.status,
        subscription: {
          status: subscription.status,
          accessState: subscription.accessState,
          trialEndsAt: store.tenant.subscription?.trialEndsAt?.toISOString() ?? null,
          currentPeriodEndsAt: store.tenant.subscription?.currentPeriodEndsAt?.toISOString() ?? null,
        },
        desktopCount: store.desktopDevices.length,
        activeDesktopCount: activeDevices.length,
        activationStatus: blocked ? 'BLOCKED' : activeDevices.length > 0 ? 'ACTIVE' : 'NOT_ACTIVATED',
        lastVerification: lastVerification?.toISOString() ?? null,
        currentPinStatus: currentPinStatus(store.desktopActivationPins[0] ?? null, now),
        currentRuntimeVersion: DESKTOP_ACTIVATION_RUNTIME_VERSION,
        currentDesktopVersion: CURRENT_DESKTOP_VERSION,
      }
    }),
  })
}

async function devicesView(req: NextRequest) {
  const query = cleanQuery(req.nextUrl.searchParams.get('query'))
  const requestedStatus = cleanQuery(req.nextUrl.searchParams.get('status')).toUpperCase()
  const { page, pageSize } = pageInput(req)
  const rows = await prisma.desktopDevice.findMany({
    where: deviceSearchWhere(query),
    select: {
      id: true,
      status: true,
      tokenExpiresAt: true,
      lastSeenAt: true,
      activatedAt: true,
      revokedAt: true,
      store: { select: { code: true, name: true, status: true } },
      tenant: {
        select: {
          name: true,
          status: true,
          subscription: { select: { status: true } },
        },
      },
    },
    orderBy: [{ activatedAt: 'desc' }],
  })

  const now = new Date()
  const devices = rows.map((device) => {
    const subscription = computeDesktopSubscriptionAccess(device.tenant.subscription?.status ?? 'ACTIVE')
    const status = deriveDesktopManagementStatus({
      sourceStatus: device.status,
      tenantStatus: device.tenant.status,
      storeStatus: device.store.status,
      subscriptionAccessState: subscription.accessState,
      tokenExpiresAt: device.tokenExpiresAt,
      lastSeenAt: device.lastSeenAt,
      now,
    })
    const deviceRef = shortDeviceReference(device.id)
    return {
      deviceRef,
      deviceName: `Desktop ${deviceRef}`,
      storeCode: device.store.code,
      storeName: device.store.name,
      tenantName: device.tenant.name,
      subscriptionStatus: subscription.status,
      status,
      activatedAt: device.activatedAt.toISOString(),
      lastVerification: device.lastSeenAt?.toISOString() ?? null,
      desktopVersion: null,
      windowsVersion: null,
      revokedAt: device.revokedAt?.toISOString() ?? null,
      canRevoke: device.status === 'ACTIVE',
    }
  }).filter((device) => !requestedStatus || requestedStatus === 'ALL' || device.status === requestedStatus)

  const total = devices.length
  const offset = (page - 1) * pageSize
  return noStoreJson({
    view: 'devices',
    query,
    status: requestedStatus || 'ALL',
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    devices: devices.slice(offset, offset + pageSize),
  })
}

async function auditView(req: NextRequest) {
  const query = cleanQuery(req.nextUrl.searchParams.get('query'))
  const requestedCategory = cleanQuery(req.nextUrl.searchParams.get('category')).toUpperCase()
  const { page, pageSize } = pageInput(req)
  const [audits, verifiedDevices] = await prisma.$transaction([
    prisma.desktopActivationAudit.findMany({
      where: auditSearchWhere(query),
      select: {
        eventType: true,
        result: true,
        reasonCode: true,
        createdAt: true,
        device: { select: { id: true } },
        store: { select: { code: true, name: true } },
        tenant: { select: { name: true } },
        actorUser: { select: { displayName: true, username: true, role: true } },
        actorOpsAdmin: { select: { name: true, username: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: AUDIT_LOOKBACK_LIMIT,
    }),
    prisma.desktopDevice.findMany({
      where: { ...deviceSearchWhere(query), lastSeenAt: { not: null } },
      select: {
        id: true,
        lastSeenAt: true,
        store: { select: { code: true, name: true } },
        tenant: { select: { name: true } },
      },
      orderBy: { lastSeenAt: 'desc' },
      take: AUDIT_LOOKBACK_LIMIT,
    }),
  ])

  const persisted = audits.map((audit) => ({
    eventKey: `${audit.createdAt.toISOString()}:${audit.eventType}:${audit.store.code}:${audit.device ? shortDeviceReference(audit.device.id) : 'store'}`,
    eventType: audit.eventType,
    category: desktopAuditCategory(audit.eventType, audit.reasonCode),
    label: desktopAuditEventLabel(audit.eventType, audit.reasonCode),
    result: audit.result,
    reasonCode: audit.reasonCode,
    createdAt: audit.createdAt.toISOString(),
    storeCode: audit.store.code,
    storeName: audit.store.name,
    tenantName: audit.tenant.name,
    deviceRef: audit.device ? shortDeviceReference(audit.device.id) : null,
    actor: audit.actorOpsAdmin
      ? `${audit.actorOpsAdmin.name} · ${audit.actorOpsAdmin.role}`
      : audit.actorUser
        ? `${audit.actorUser.displayName || audit.actorUser.username} · ${audit.actorUser.role}`
        : 'System',
    derived: false,
  }))
  const derivedVerifications = verifiedDevices.map((device) => ({
    eventKey: `${device.lastSeenAt?.toISOString()}:DESKTOP_VERIFIED:${device.store.code}:${shortDeviceReference(device.id)}`,
    eventType: 'DESKTOP_VERIFIED',
    category: 'VERIFICATION',
    label: 'Verification',
    result: 'SUCCESS',
    reasonCode: null,
    createdAt: device.lastSeenAt!.toISOString(),
    storeCode: device.store.code,
    storeName: device.store.name,
    tenantName: device.tenant.name,
    deviceRef: shortDeviceReference(device.id),
    actor: 'Desktop Runtime',
    derived: true,
  }))
  const events = [...persisted, ...derivedVerifications]
    .filter((event) => !requestedCategory || requestedCategory === 'ALL' || event.category === requestedCategory)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const total = events.length
  const offset = (page - 1) * pageSize

  return noStoreJson({
    view: 'audit',
    query,
    category: requestedCategory || 'ALL',
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    events: events.slice(offset, offset + pageSize),
  })
}

async function runtimeView(req: NextRequest) {
  const query = cleanQuery(req.nextUrl.searchParams.get('query'))
  const devices = await prisma.desktopDevice.findMany({
    where: deviceSearchWhere(query),
    select: {
      status: true,
      tokenExpiresAt: true,
      lastSeenAt: true,
      store: { select: { status: true } },
      tenant: {
        select: {
          status: true,
          subscription: { select: { status: true } },
        },
      },
    },
  })
  const now = new Date()
  const statuses = devices.map((device) => {
    const subscription = computeDesktopSubscriptionAccess(device.tenant.subscription?.status ?? 'ACTIVE')
    return deriveDesktopManagementStatus({
      sourceStatus: device.status,
      tenantStatus: device.tenant.status,
      storeStatus: device.store.status,
      subscriptionAccessState: subscription.accessState,
      tokenExpiresAt: device.tokenExpiresAt,
      lastSeenAt: device.lastSeenAt,
      now,
    })
  })
  const counts = { ACTIVE: 0, OFFLINE: 0, BLOCKED: 0, REVOKED: 0 }
  for (const status of statuses) counts[status] += 1
  const lastVerification = devices
    .map((device) => device.lastSeenAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  return noStoreJson({
    view: 'runtime',
    query,
    runtimeVersion: DESKTOP_ACTIVATION_RUNTIME_VERSION,
    currentDesktopVersion: CURRENT_DESKTOP_VERSION,
    deviceCount: devices.length,
    statusCounts: counts,
    lastVerification: lastVerification?.toISOString() ?? null,
    desktopTelemetry: 'NOT_REPORTED',
    windowsTelemetry: 'NOT_REPORTED',
  })
}

export async function GET(req: NextRequest) {
  return withDesktopApiError(async () => {
    const auth = await requireOpsAdmin(req)
    if (!auth.ok) return auth.response

    const view = cleanQuery(req.nextUrl.searchParams.get('view')).toLowerCase() || 'stores'
    if (view === 'stores' || view === 'activation') return storesView(req)
    if (view === 'devices') return devicesView(req)
    if (view === 'audit') return auditView(req)
    if (view === 'runtime') return runtimeView(req)
    return apiError('INVALID_VIEW', 400)
  })
}

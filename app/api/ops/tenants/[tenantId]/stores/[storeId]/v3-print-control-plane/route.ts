import { NextRequest, NextResponse } from 'next/server'
import { getFkBackedOpsAdminIdentity } from '@/lib/ops-auth'
import { prisma } from '@/lib/prisma'
import {
  parseOpsPrintModeCommand,
  readOpsPrintModeState,
  resolveOpsPrintStoreAccess,
  runOpsPrintModeAction,
  validateOpsPrintMutationRequest,
  type OpsPrintControlDb,
} from './service'

export const runtime = 'nodejs'

const db = prisma as unknown as OpsPrintControlDb

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  headers.set('Cache-Control', 'private, no-store')
  return NextResponse.json(body, { ...init, headers })
}

function serverFailure(error: unknown) {
  const value = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown } : null
  const name = typeof value?.name === 'string' ? value.name : ''
  const code = typeof value?.code === 'string' ? value.code : ''
  const unavailable = name === 'PrismaClientInitializationError' || name === 'PrismaClientRustPanicError' ||
    /^P10(?:0[0-9]|1[0-7])$/.test(code) || code === 'P2024' ||
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)
  return unavailable
    ? noStoreJson({ ok: false, error: 'CONTROL_PLANE_UNAVAILABLE' }, { status: 503 })
    : noStoreJson({ ok: false, error: 'UNEXPECTED_SERVER_ERROR' }, { status: 500 })
}

async function authorizeStore(
  req: NextRequest,
  params: Promise<{ tenantId: string; storeId: string }>,
): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; operator: { id: string; role: string }; store: { id: string; tenantId: string; code: string } }
> {
  const scope = await params
  const result = await resolveOpsPrintStoreAccess(req, scope, {
    authenticate: (request) => getFkBackedOpsAdminIdentity(request, 'OPS_ADMIN'),
    findActiveStore: ({ tenantId, storeId }) => prisma.store.findFirst({
      where: { id: storeId, tenantId, status: 'ACTIVE' },
      select: { id: true, tenantId: true, code: true },
    }),
  })
  if (!result.ok) {
    const status = result.code === 'FORBIDDEN' ? 403 : 404
    return { ok: false, response: noStoreJson({ ok: false, error: result.code }, { status }) } as const
  }
  return { ok: true, operator: result.operator, store: result.store } as const
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; storeId: string }> },
) {
  try {
    const auth = await authorizeStore(req, params)
    if (!auth.ok) return auth.response
    return noStoreJson({ ok: true, state: await readOpsPrintModeState(db, {
      tenantId: auth.store.tenantId,
      storeId: auth.store.id,
    }) })
  } catch (error) {
    return serverFailure(error)
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; storeId: string }> },
) {
  const requestSafety = validateOpsPrintMutationRequest(req)
  if (!requestSafety.ok) {
    return noStoreJson({ ok: false, error: requestSafety.code }, {
      status: requestSafety.code === 'INVALID_CONTENT_TYPE' ? 415 : 403,
    })
  }
  try {
    const auth = await authorizeStore(req, params)
    if (!auth.ok) return auth.response
    const command = parseOpsPrintModeCommand(await req.json().catch(() => null))
    if (!command.ok) return noStoreJson({ ok: false, error: command.code }, { status: 400 })
    const result = await runOpsPrintModeAction(db, {
      tenantId: auth.store.tenantId,
      storeId: auth.store.id,
      operatorAdminId: auth.operator.id,
      operatorRole: auth.operator.role,
      expectedStateVersion: command.value.expectedStateVersion,
      action: command.value.action,
    })
    const state = await readOpsPrintModeState(db, {
      tenantId: auth.store.tenantId,
      storeId: auth.store.id,
    })
    return result.ok
      ? noStoreJson({ ok: true, requestId: result.requestId, state })
      : noStoreJson({ ok: false, error: result.code, state }, { status: 409 })
  } catch (error) {
    return serverFailure(error)
  }
}

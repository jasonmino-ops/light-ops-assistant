import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { DiningCommandError, asJson } from './types'

export const noStore = { 'Cache-Control': 'private, no-store' }

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore })
}

export function storeCodeFrom(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get('storeCode')?.trim() || null
}

export async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  let parsed: unknown
  try { parsed = await req.json() } catch { throw new DiningCommandError('INVALID_JSON', 400) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new DiningCommandError('INVALID_JSON', 400)
  return parsed as Record<string, unknown>
}

/**
 * Turns a refusal into a response. Refusals flagged for audit leave a FAILED
 * OperationLog row here, after the business transaction has rolled back.
 */
export async function errorResponse(
  error: unknown,
  context?: { tenantId: string; storeId: string; userId: string },
) {
  if (error instanceof DiningCommandError) {
    if (error.audit && context) {
      await prisma.operationLog.create({
        data: {
          tenantId: context.tenantId,
          storeId: context.storeId,
          userId: context.userId,
          actionType: error.audit.actionType,
          targetType: error.audit.targetType,
          targetId: error.audit.targetId,
          requestId: error.audit.requestId ?? null,
          status: 'FAILED',
          message: error.code,
          // Never the response details: those may carry an amount, and money has one home.
          payloadSnapshot: asJson(error.audit.payload ?? {}),
        },
      }).catch((auditError) => console.error('[dine-in] refusal audit failed', auditError))
    }
    return json({ error: error.code, ...(error.details === undefined ? {} : { details: error.details }) }, error.status)
  }
  console.error('[dine-in] request failed', error)
  return json({ error: 'INTERNAL_ERROR' }, 500)
}

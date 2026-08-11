import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import type { DesktopDeviceContext } from '@/lib/desktop-activation/auth'
import {
  type StoreRuntimePrintTaskCreateInput,
  type StoreRuntimePrinterBindingInput,
  type StoreRuntimeTaskProgressInput,
} from './contract'

const TASK_LEASE_MS = 30_000

export class StoreRuntimeServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code)
    this.name = 'StoreRuntimeServiceError'
  }
}

export type StoreRuntimeActorContext = {
  tenantId: string
  storeId: string
  userId: string
  role: 'OWNER' | 'STAFF'
}

export function serializeStoreRuntimePrinterBinding(binding: {
  id: string
  tenantId: string
  storeId: string
  targetType: string
  printerName: string
  enabled: boolean
  version: number
  updatedAt: Date
} | null) {
  if (!binding) return null
  return {
    id: binding.id,
    tenantId: binding.tenantId,
    storeId: binding.storeId,
    targetType: binding.targetType,
    printerName: binding.printerName,
    enabled: binding.enabled,
    version: binding.version,
    updatedAt: binding.updatedAt.toISOString(),
  }
}

function serializeStoreRuntimePrintTask(task: {
  id: string
  tenantId: string
  storeId: string
  bindingId: string
  bindingVersion: number
  printerName: string
  taskType: string
  schemaVersion: number
  idempotencyKey: string
  payload: Prisma.JsonValue
  status: string
  claimedByDeviceId: string | null
  leaseExpiresAt: Date | null
  attemptCount: number
  acceptedAt: Date | null
  executingAt: Date | null
  completedAt: Date | null
  resultStatus: string | null
  resultCode: string | null
  resultMessage: string | null
  effectBoundary: string | null
  physicalCompletionKnown: boolean | null
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: task.id,
    tenantId: task.tenantId,
    storeId: task.storeId,
    taskType: task.taskType,
    schemaVersion: task.schemaVersion,
    idempotencyKey: task.idempotencyKey,
    payload: task.payload,
    printerBinding: {
      id: task.bindingId,
      version: task.bindingVersion,
      targetType: 'WINDOWS_QUEUE',
      printerName: task.printerName,
    },
    status: task.status,
    claimedByDeviceId: task.claimedByDeviceId,
    leaseExpiresAt: task.leaseExpiresAt?.toISOString() ?? null,
    attemptCount: task.attemptCount,
    acceptedAt: task.acceptedAt?.toISOString() ?? null,
    executingAt: task.executingAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    result: task.resultStatus ? {
      status: task.resultStatus,
      code: task.resultCode,
      message: task.resultMessage,
      effectBoundary: task.effectBoundary,
      physicalCompletionKnown: task.physicalCompletionKnown,
    } : null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

export async function getStoreRuntimePrinterBinding(tenantId: string, storeId: string) {
  const binding = await prisma.storeRuntimePrinterBinding.findFirst({
    where: { tenantId, storeId },
  })
  return serializeStoreRuntimePrinterBinding(binding)
}

export async function upsertStoreRuntimePrinterBinding(
  context: StoreRuntimeActorContext,
  input: StoreRuntimePrinterBindingInput,
) {
  if (context.role !== 'OWNER') throw new StoreRuntimeServiceError('FORBIDDEN', 403)
  const store = await prisma.store.findFirst({
    where: { id: context.storeId, tenantId: context.tenantId, status: 'ACTIVE' },
    select: { id: true },
  })
  if (!store) throw new StoreRuntimeServiceError('STORE_NOT_FOUND', 404)

  const binding = await prisma.$transaction(async (tx) => {
    const existing = await tx.storeRuntimePrinterBinding.findUnique({ where: { storeId: context.storeId } })
    const next = existing
      ? await tx.storeRuntimePrinterBinding.update({
          where: { id: existing.id },
          data: {
            printerName: input.printerName,
            targetType: input.targetType,
            enabled: input.enabled,
            version: { increment: 1 },
            updatedByUserId: context.userId,
          },
        })
      : await tx.storeRuntimePrinterBinding.create({
          data: {
            tenantId: context.tenantId,
            storeId: context.storeId,
            printerName: input.printerName,
            targetType: input.targetType,
            enabled: input.enabled,
            updatedByUserId: context.userId,
          },
        })

    // Never silently reroute work created for an older printer binding.
    await tx.storeRuntimePrintTask.updateMany({
      where: {
        tenantId: context.tenantId,
        storeId: context.storeId,
        status: 'PENDING',
        bindingVersion: { lt: next.version },
      },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        resultStatus: 'FAILURE',
        resultCode: 'PRINTER_BINDING_CHANGED_BEFORE_EXECUTION',
        resultMessage: 'Printer binding changed before task acceptance.',
        effectBoundary: 'NOT_CROSSED',
        physicalCompletionKnown: false,
      },
    })
    return next
  })
  return serializeStoreRuntimePrinterBinding(binding)
}

function canonicalJson(value: Prisma.JsonValue | Prisma.InputJsonValue): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalJson(entry))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJson(entry as Prisma.JsonValue)]),
    )
  }
  return value
}

function jsonEqual(left: Prisma.JsonValue, right: Prisma.InputJsonValue) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
}

export async function createStoreRuntimePrintTask(
  context: StoreRuntimeActorContext,
  input: StoreRuntimePrintTaskCreateInput,
) {
  const store = await prisma.store.findFirst({
    where: { id: context.storeId, tenantId: context.tenantId, status: 'ACTIVE' },
    select: { id: true, code: true },
  })
  if (!store) throw new StoreRuntimeServiceError('STORE_NOT_FOUND', 404)
  if (input.receipt.storeCode !== store.code) {
    throw new StoreRuntimeServiceError('STORE_RUNTIME_STORE_MISMATCH', 409)
  }
  const binding = await prisma.storeRuntimePrinterBinding.findFirst({
    where: { tenantId: context.tenantId, storeId: context.storeId, enabled: true },
  })
  if (!binding) throw new StoreRuntimeServiceError('STORE_RUNTIME_PRINTER_NOT_CONFIGURED', 409)

  const payload: Prisma.InputJsonValue = { receipt: input.receipt as unknown as Prisma.InputJsonObject }
  try {
    const task = await prisma.storeRuntimePrintTask.create({
      data: {
        tenantId: context.tenantId,
        storeId: context.storeId,
        bindingId: binding.id,
        bindingVersion: binding.version,
        printerName: binding.printerName,
        taskType: input.taskType,
        schemaVersion: input.schemaVersion,
        idempotencyKey: input.idempotencyKey,
        payload,
      },
    })
    return { created: true, task: serializeStoreRuntimePrintTask(task) }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await prisma.storeRuntimePrintTask.findUnique({
      where: { storeId_idempotencyKey: { storeId: context.storeId, idempotencyKey: input.idempotencyKey } },
    })
    if (!existing) throw error
    if (!jsonEqual(existing.payload, payload)) {
      throw new StoreRuntimeServiceError('STORE_RUNTIME_IDEMPOTENCY_CONFLICT', 409)
    }
    return { created: false, task: serializeStoreRuntimePrintTask(existing) }
  }
}

export async function claimStoreRuntimePrintTask(context: DesktopDeviceContext, now = new Date()) {
  const binding = await prisma.storeRuntimePrinterBinding.findFirst({
    where: { tenantId: context.tenantId, storeId: context.storeId, enabled: true },
  })
  if (!binding) return { binding: null, task: null }

  const leaseExpiresAt = new Date(now.getTime() + TASK_LEASE_MS)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = await prisma.storeRuntimePrintTask.findFirst({
      where: {
        tenantId: context.tenantId,
        storeId: context.storeId,
        bindingId: binding.id,
        bindingVersion: binding.version,
        OR: [
          { status: 'PENDING' },
          { status: 'ACCEPTED', leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (!candidate) return { binding: serializeStoreRuntimePrinterBinding(binding), task: null }

    const claimed = await prisma.storeRuntimePrintTask.updateMany({
      where: {
        id: candidate.id,
        tenantId: context.tenantId,
        storeId: context.storeId,
        OR: [
          { status: 'PENDING' },
          { status: 'ACCEPTED', leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: 'ACCEPTED',
        claimedByDeviceId: context.deviceId,
        acceptedAt: now,
        leaseExpiresAt,
        attemptCount: { increment: 1 },
        resultStatus: null,
        resultCode: null,
        resultMessage: null,
        effectBoundary: null,
        physicalCompletionKnown: null,
      },
    })
    if (claimed.count !== 1) continue
    const task = await prisma.storeRuntimePrintTask.findUniqueOrThrow({ where: { id: candidate.id } })
    return { binding: serializeStoreRuntimePrinterBinding(binding), task: serializeStoreRuntimePrintTask(task) }
  }
  return { binding: serializeStoreRuntimePrinterBinding(binding), task: null }
}

export async function updateStoreRuntimePrintTask(
  context: DesktopDeviceContext,
  taskId: string,
  input: StoreRuntimeTaskProgressInput,
  now = new Date(),
) {
  if (input.state === 'EXECUTING') {
    const updated = await prisma.storeRuntimePrintTask.updateMany({
      where: {
        id: taskId,
        tenantId: context.tenantId,
        storeId: context.storeId,
        claimedByDeviceId: context.deviceId,
        status: 'ACCEPTED',
        leaseExpiresAt: { gt: now },
      },
      data: {
        status: 'EXECUTING',
        executingAt: now,
        leaseExpiresAt: null,
      },
    })
    if (updated.count !== 1) {
      const existing = await prisma.storeRuntimePrintTask.findFirst({
        where: { id: taskId, tenantId: context.tenantId, storeId: context.storeId, claimedByDeviceId: context.deviceId },
      })
      if (!existing || !['EXECUTING', 'SUCCEEDED', 'FAILED'].includes(existing.status)) {
        throw new StoreRuntimeServiceError('STORE_RUNTIME_TASK_NOT_EXECUTABLE', 409)
      }
    }
  } else {
    const updated = await prisma.storeRuntimePrintTask.updateMany({
      where: {
        id: taskId,
        tenantId: context.tenantId,
        storeId: context.storeId,
        claimedByDeviceId: context.deviceId,
        status: 'EXECUTING',
      },
      data: {
        status: input.state,
        completedAt: now,
        resultStatus: input.state === 'SUCCEEDED' ? 'SUCCESS' : 'FAILURE',
        resultCode: input.resultCode,
        resultMessage: input.message ?? null,
        effectBoundary: input.effectBoundary,
        physicalCompletionKnown: input.physicalCompletionKnown,
      },
    })
    if (updated.count !== 1) {
      const existing = await prisma.storeRuntimePrintTask.findFirst({
        where: { id: taskId, tenantId: context.tenantId, storeId: context.storeId, claimedByDeviceId: context.deviceId },
      })
      if (!existing || !['SUCCEEDED', 'FAILED'].includes(existing.status)) {
        throw new StoreRuntimeServiceError('STORE_RUNTIME_TASK_NOT_EXECUTING', 409)
      }
      const sameTerminalResult =
        existing.status === input.state &&
        existing.resultCode === input.resultCode &&
        existing.resultMessage === (input.message ?? null) &&
        existing.effectBoundary === input.effectBoundary &&
        existing.physicalCompletionKnown === input.physicalCompletionKnown
      if (!sameTerminalResult) {
        throw new StoreRuntimeServiceError('STORE_RUNTIME_RESULT_CONFLICT', 409)
      }
    }
  }
  const task = await prisma.storeRuntimePrintTask.findFirst({
    where: { id: taskId, tenantId: context.tenantId, storeId: context.storeId },
  })
  if (!task) throw new StoreRuntimeServiceError('STORE_RUNTIME_TASK_NOT_FOUND', 404)
  return serializeStoreRuntimePrintTask(task)
}

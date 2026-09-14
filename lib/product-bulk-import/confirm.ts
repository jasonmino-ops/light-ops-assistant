import { createHash } from 'node:crypto'
import { Prisma, type Product, type ProductBulkImportRow } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deleteObject, downloadObject, uploadObject } from '@/lib/supabase-storage'
import {
  PRODUCT_IMPORT_CONFIRM_BATCH_SIZE,
  PRODUCT_IMPORT_MAX_IMAGES,
  PRODUCT_IMPORT_MAX_SOURCE_BYTES,
  type ProductImportImageCandidate,
  type ProductImportImagePlan,
  type ProductImportImageResult,
  type ProductImportPreviewPayload,
} from './contract'
import {
  createProductImportImageLimiter,
  deterministicProductImageKey,
  materializeImportImage,
  type ProductImportImageLimiter,
} from './images'
import {
  cleanupProductImportStaging,
  getProductImportJob,
  PRODUCT_IMPORT_STAGING_BUCKET,
  ProductImportError,
} from './jobs'
import { unzipOfficeEntries, type OfficeEntries } from './xlsx'

const PRODUCT_IMAGES_BUCKET = 'product-images'

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && !!item) : []
  } catch {
    return []
  }
}

function imageCandidates(row: ProductBulkImportRow): ProductImportImageCandidate[] {
  const candidates = object(row.imagePlan).candidates
  if (!Array.isArray(candidates)) return []
  return candidates.filter((candidate): candidate is ProductImportImageCandidate => {
    if (!candidate || typeof candidate !== 'object') return false
    const item = candidate as Record<string, unknown>
    return ['XLSX_EMBEDDED', 'EXTERNAL_URL', 'PDF_CANDIDATE'].includes(String(item.kind)) && typeof item.source === 'string'
  }).slice(0, PRODUCT_IMPORT_MAX_IMAGES)
}

function productData(preview: ProductImportPreviewPayload) {
  return {
    sku: preview.sku,
    name: preview.name.trim(),
    nameZh: preview.nameZh,
    nameEn: preview.nameEn,
    nameKm: preview.nameKm,
    descZh: preview.descZh,
    descEn: preview.descEn,
    descKm: preview.descKm,
    spec: preview.spec,
    sellPrice: String(preview.sellPrice),
    status: preview.status,
    categoryId: preview.categoryId,
  }
}

function productUpdateData(preview: ProductImportPreviewPayload) {
  return {
    name: preview.name.trim(),
    sellPrice: String(preview.sellPrice),
    ...(preview.sku ? { sku: preview.sku } : {}),
    ...(preview.nameZh ? { nameZh: preview.nameZh } : {}),
    ...(preview.nameEn ? { nameEn: preview.nameEn } : {}),
    ...(preview.nameKm ? { nameKm: preview.nameKm } : {}),
    ...(preview.descZh ? { descZh: preview.descZh } : {}),
    ...(preview.descEn ? { descEn: preview.descEn } : {}),
    ...(preview.descKm ? { descKm: preview.descKm } : {}),
    ...(preview.spec ? { spec: preview.spec } : {}),
    ...(preview.statusProvided ? { status: preview.status } : {}),
    ...(preview.categoryId ? { categoryId: preview.categoryId } : {}),
  }
}

type UploadedImage = { key: string; url: string }

async function compensate(keys: string[]): Promise<string[]> {
  const uniqueKeys = [...new Set(keys)]
  const results = await Promise.allSettled(uniqueKeys.map((key) => deleteObject(PRODUCT_IMAGES_BUCKET, key)))
  return uniqueKeys.filter((_, index) => {
    const result = results[index]
    return result.status === 'rejected' || result.value !== true
  })
}

async function setFailedRow(row: ProductBulkImportRow, error: unknown, uploadedKeys: string[]) {
  await compensate(uploadedKeys)
  const message = error instanceof Error ? error.message.slice(0, 2_000) : 'CONFIRM_FAILED'
  const code = message.split(':')[0].slice(0, 64)
  const imageResult: ProductImportImageResult = {
    uploadIntentKeys: [],
    uploadedKeys,
    // Keep all intents as tombstones through the request quiescence window.
    // The first DELETE may have raced a Storage PUT whose response was lost.
    compensationPendingKeys: uploadedKeys,
    lastError: message,
    cleanupAttempts: 1,
  }
  const failed = await prisma.productBulkImportRow.updateMany({
    where: { id: row.id, jobId: row.jobId, tenantId: row.tenantId, status: 'CONFIRMING' },
    data: {
      status: uploadedKeys.length > 0 ? 'COMPENSATION_REQUIRED' : 'FAILED',
      imageResult: json(imageResult),
      lastErrorCode: uploadedKeys.length > 0 ? 'UPLOAD_QUIESCENCE_REQUIRED' : code,
      lastErrorMessage: message,
      version: { increment: 1 },
    },
  })
  if (failed.count === 0) {
    const latest = await prisma.productBulkImportRow.findUnique({ where: { id: row.id }, select: { status: true } })
    if (latest && ['CANCELLED', 'COMPENSATION_REQUIRED'].includes(latest.status)) {
      await settleCancelledRow(row, uploadedKeys)
    }
  }
}

async function settleCancelledRow(row: ProductBulkImportRow, uploadedKeys: string[]) {
  await compensate(uploadedKeys)
  await prisma.productBulkImportRow.updateMany({
    where: { id: row.id, status: { in: ['CANCELLED', 'COMPENSATION_REQUIRED'] } },
    data: {
      status: uploadedKeys.length > 0 ? 'COMPENSATION_REQUIRED' : 'CANCELLED',
      imageResult: uploadedKeys.length > 0
        ? json({ uploadIntentKeys: [], uploadedKeys, compensationPendingKeys: uploadedKeys, cleanupAttempts: 1 })
        : Prisma.DbNull,
      lastErrorCode: uploadedKeys.length > 0 ? 'CANCEL_UPLOAD_QUIESCENCE_REQUIRED' : null,
      lastErrorMessage: uploadedKeys.length > 0 ? 'Cancelled upload intents await the request quiescence window' : null,
      version: { increment: 1 },
    },
  })
}

function isDefiniteDatabaseRollback(error: unknown): boolean {
  return error instanceof ProductImportError
    || error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientValidationError
}

async function confirmRow(input: {
  tenantId: string
  jobId: string
  row: ProductBulkImportRow
  workbookEntries?: OfficeEntries
  imageLimiter: ProductImportImageLimiter
}) {
  const { tenantId, jobId, row, workbookEntries, imageLimiter } = input
  const preview = object(row.previewPayload) as ProductImportPreviewPayload
  if (!row.assignedBarcode || !preview.name?.trim() || !(preview.sellPrice > 0)) {
    throw new ProductImportError('ROW_VALIDATION_FAILED', '确认前校验失败', 409)
  }
  if (preview.categoryId) {
    const category = await prisma.productCategory.findFirst({ where: { id: preview.categoryId, tenantId }, select: { id: true } })
    if (!category) throw new ProductImportError('CATEGORY_NOT_FOUND', '分类不属于当前租户', 409)
  }
  const uploaded: UploadedImage[] = []
  let uploadIntentKeys: string[] = []
  let committed: { productId: string; imageResult: ProductImportImageResult }
  let transactionStarted = false
  try {
    const candidates = imageCandidates(row)
    const prepared: Array<{ key: string; buffer: Buffer; contentType: 'image/webp' }> = []
    const normalizedImages = await Promise.all(candidates.map((candidate) => (
      imageLimiter(() => materializeImportImage(candidate, workbookEntries))
    )))
    for (let slot = 0; slot < normalizedImages.length; slot += 1) {
      const normalized = normalizedImages[slot]
      if (candidates[slot].kind === 'EXTERNAL_URL' && (!candidates[slot].imageHash || candidates[slot].imageHash !== normalized.imageHash)) {
        throw new ProductImportError('EXTERNAL_IMAGE_CHANGED', '外链图片在 Analyze 后发生变化，已停止导入', 409)
      }
      const key = deterministicProductImageKey({
        tenantId,
        jobId,
        rowIdentity: row.stableSourceRowIdentity,
        imageHash: normalized.imageHash,
        slot,
      })
      prepared.push({ key, buffer: normalized.buffer, contentType: normalized.contentType })
    }
    if (prepared.length > 0) {
      uploadIntentKeys = prepared.map((image) => image.key)
      const intentSaved = await prisma.productBulkImportRow.updateMany({
        where: { id: row.id, jobId, tenantId, status: 'CONFIRMING' },
        data: { imageResult: json({ uploadIntentKeys }) },
      })
      if (intentSaved.count !== 1) throw new ProductImportError('ROW_CONFIRM_STATE_CHANGED', '导入行状态已变化', 409)
    }
    const uploadResults = await Promise.allSettled(prepared.map(async (image) => ({
      key: image.key,
      url: await uploadObject(PRODUCT_IMAGES_BUCKET, image.key, image.buffer, image.contentType),
    })))
    for (const result of uploadResults) {
      if (result.status === 'fulfilled') uploaded.push(result.value)
    }
    const uploadFailure = uploadResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (uploadFailure) {
      throw uploadFailure.reason
    }

    transactionStarted = true
    committed = await prisma.$transaction(async (tx) => {
      // Lock and re-check the row before changing Product. If cancellation won
      // the race, no product write is allowed. Holding this row lock also makes
      // cancellation wait until an in-flight commit has a definite outcome.
      const rowLock = await tx.productBulkImportRow.updateMany({
        where: { id: row.id, jobId, tenantId, status: 'CONFIRMING' },
        data: { version: { increment: 1 } },
      })
      if (rowLock.count !== 1) throw new ProductImportError('ROW_CONFIRM_STATE_CHANGED', '导入行状态已变化', 409)
      const existing = await tx.product.findUnique({
        where: { tenantId_barcode: { tenantId, barcode: row.assignedBarcode! } },
      })
      const imageFields = uploaded.length > 0 ? {
        imageUrl: uploaded[0].url,
        imageStorageKey: uploaded[0].key,
        imageUrls: JSON.stringify(uploaded.map((image) => image.url)),
        imageStorageKeys: JSON.stringify(uploaded.map((image) => image.key)),
        imageUpdatedAt: new Date(),
      } : {}
      let product: Product
      if (existing) {
        product = await tx.product.update({
          where: { id: existing.id },
          data: { ...productUpdateData(preview), ...imageFields },
        })
      } else {
        product = await tx.product.create({
          data: {
            tenantId,
            barcode: row.assignedBarcode!,
            ...productData(preview),
            ...imageFields,
          },
        })
      }
      const oldKeys = existing && uploaded.length > 0
        ? stringArray(existing.imageStorageKeys).length > 0
          ? stringArray(existing.imageStorageKeys)
          : existing.imageStorageKey ? [existing.imageStorageKey] : []
        : []
      const result: ProductImportImageResult = {
        uploadIntentKeys: [],
        uploadedUrls: uploaded.map((image) => image.url),
        uploadedKeys: uploaded.map((image) => image.key),
        oldKeysPendingCleanup: oldKeys.filter((key) => !uploaded.some((image) => image.key === key)),
      }
      await tx.productBulkImportRow.update({
        where: { id: row.id },
        data: {
          action: existing ? 'UPDATE' : 'CREATE',
          status: 'CONFIRMED',
          imageResult: json(result),
          confirmedAt: new Date(),
          lastErrorCode: result.oldKeysPendingCleanup?.length ? 'OLD_IMAGE_CLEANUP_PENDING' : null,
          lastErrorMessage: result.oldKeysPendingCleanup?.length ? '商品已提交；旧图片等待后台清理' : null,
          version: { increment: 1 },
        },
      })
      return { productId: product.id, imageResult: result }
    })

  } catch (error) {
    // A database client can lose the commit response after PostgreSQL has
    // committed. The row and Product are changed in one transaction, so a
    // confirmed row is authoritative and its referenced objects must remain.
    let reconciled: { status: string; imageResult: Prisma.JsonValue | null } | null
    try {
      reconciled = await prisma.productBulkImportRow.findFirst({
        where: { id: row.id, jobId, tenantId },
        select: { status: true, imageResult: true },
      })
    } catch {
      // The commit outcome is still unknown. Keep the persisted intent and the
      // row in CONFIRMING so a later retry can reconcile before deleting.
      throw error
    }
    if (reconciled?.status === 'CONFIRMED') {
      const product = await prisma.product.findUnique({
        where: { tenantId_barcode: { tenantId, barcode: row.assignedBarcode! } },
        select: { id: true },
      })
      if (product) {
        committed = { productId: product.id, imageResult: object(reconciled.imageResult) as ProductImportImageResult }
      } else {
        throw error
      }
    } else if (
      error instanceof ProductImportError
      && error.code === 'ROW_CONFIRM_STATE_CHANGED'
      && reconciled
      && ['CANCELLED', 'COMPENSATION_REQUIRED'].includes(reconciled.status)
    ) {
      await settleCancelledRow(row, uploadIntentKeys)
      throw error
    } else if (!transactionStarted || isDefiniteDatabaseRollback(error)) {
    // Compensate every intent, including an upload whose HTTP response was
    // lost after Storage accepted the object.
      await setFailedRow(row, error, uploadIntentKeys)
      throw error
    } else {
      // An unknown transaction error may be a lost commit response. Defer
      // compensation until the stale-row retry can observe the durable state.
      throw error
    }
  }

  // The product now references the new objects. Cleanup failures after this
  // point must be tracked for retry and must never compensate the new images.
  const failedOldDeletes = await compensate(committed.imageResult.oldKeysPendingCleanup ?? [])
  if ((committed.imageResult.oldKeysPendingCleanup?.length ?? 0) > 0) {
    await prisma.productBulkImportRow.update({
      where: { id: row.id },
      data: {
        imageResult: json({ ...committed.imageResult, oldKeysPendingCleanup: failedOldDeletes, cleanupAttempts: 1 }),
        lastErrorCode: failedOldDeletes.length > 0 ? 'OLD_IMAGE_CLEANUP_PENDING' : null,
        lastErrorMessage: failedOldDeletes.length > 0 ? '商品已提交；旧图片等待后台清理' : null,
      },
    }).catch((error) => console.error('[product-import] failed to persist old image cleanup state', row.id, error))
  }
  return committed.productId
}

async function rowStatusCounts(jobId: string, tenantId: string) {
  const groups = await prisma.productBulkImportRow.groupBy({
    by: ['status'], where: { jobId, tenantId }, _count: { _all: true },
  })
  return new Map(groups.map((group) => [group.status, group._count._all]))
}

export async function confirmProductImportJob(tenantId: string, jobId: string) {
  const job = await prisma.productBulkImportJob.findFirst({ where: { id: jobId, tenantId } })
  if (!job) throw new ProductImportError('JOB_NOT_FOUND', '导入任务不存在', 404)
  if (job.status === 'COMPLETED') return getProductImportJob(tenantId, jobId)
  if (job.expiresAt <= new Date()) throw new ProductImportError('JOB_EXPIRED', '导入任务已过期', 410)
  const staleConfirmBefore = new Date(Date.now() - 10 * 60 * 1000)
  const claimable = ['PREVIEW_READY', 'CONFIRMING'].includes(job.status)
    || (job.status === 'CONFIRMING_ACTIVE' && job.updatedAt < staleConfirmBefore)
  if (!claimable) {
    throw new ProductImportError('JOB_NOT_CONFIRMABLE', '任务尚未完成 Preview 或已终止', 409)
  }
  const jobClaim = await prisma.productBulkImportJob.updateMany({
    where: {
      id: job.id,
      tenantId,
      status: job.status,
      version: job.version,
      ...(job.status === 'CONFIRMING_ACTIVE' ? { updatedAt: { lt: staleConfirmBefore } } : {}),
    },
    data: {
      status: 'CONFIRMING_ACTIVE',
      confirmAttemptCount: { increment: 1 },
      lastErrorCode: null,
      lastErrorMessage: null,
      version: { increment: 1 },
    },
  })
  if (jobClaim.count !== 1) throw new ProductImportError('CONFIRM_ALREADY_RUNNING', '另一个 Confirm 批次已接管任务', 409)
  const leaseVersion = job.version + 1
  const candidates = await prisma.productBulkImportRow.findMany({
    where: { jobId, tenantId, status: 'READY' },
    orderBy: { sourceOrdinal: 'asc' },
    take: PRODUCT_IMPORT_CONFIRM_BATCH_SIZE,
  })
  const claimed: ProductBulkImportRow[] = []
  for (const row of candidates) {
    const result = await prisma.productBulkImportRow.updateMany({
      where: { id: row.id, tenantId, status: 'READY' },
      data: { status: 'CONFIRMING', attemptCount: { increment: 1 }, version: { increment: 1 } },
    })
    if (result.count === 1) claimed.push({ ...row, status: 'CONFIRMING' })
  }

  let workbookEntries: OfficeEntries | undefined
  if (claimed.some((row) => imageCandidates(row).some((candidate) => candidate.kind === 'XLSX_EMBEDDED'))) {
    try {
      const source = await downloadObject(PRODUCT_IMPORT_STAGING_BUCKET, job.stagingStorageKey, PRODUCT_IMPORT_MAX_SOURCE_BYTES)
      if (source.length !== job.sourceFileSize || !job.sourceFileHash || createHash('sha256').update(source).digest('hex') !== job.sourceFileHash) {
        throw new ProductImportError('SOURCE_CHANGED', 'Preview 后原始 staging 文件发生变化', 409)
      }
      workbookEntries = unzipOfficeEntries(source)
    } catch (error) {
      const code = error instanceof ProductImportError ? error.code : 'SOURCE_READ_FAILED'
      await prisma.productBulkImportRow.updateMany({
        where: { id: { in: claimed.map((row) => row.id) }, tenantId, status: 'CONFIRMING' },
        data: { status: 'READY', lastErrorCode: code, lastErrorMessage: error instanceof Error ? error.message.slice(0, 2_000) : code },
      })
      await prisma.productBulkImportJob.updateMany({
        where: { id: job.id, tenantId, status: 'CONFIRMING_ACTIVE', version: leaseVersion },
        data: {
          status: 'PREVIEW_READY',
          lastErrorCode: code,
          lastErrorMessage: error instanceof Error ? error.message.slice(0, 2_000) : code,
          version: { increment: 1 },
        },
      })
      throw error
    }
  }
  const imageLimiter = createProductImportImageLimiter(2)
  const confirmResults = await Promise.allSettled(
    claimed.map((row) => confirmRow({ tenantId, jobId, row, workbookEntries, imageLimiter })),
  )
  const succeeded = confirmResults.filter((result) => result.status === 'fulfilled').length
  const failed = confirmResults.length - succeeded

  const latestJob = await prisma.productBulkImportJob.findFirst({ where: { id: jobId, tenantId } })
  if (latestJob && (latestJob.status === 'CANCELLED' || latestJob.lastErrorCode === 'CANCEL_COMPENSATION_REQUIRED')) {
    const cancellationPending = await prisma.productBulkImportRow.count({ where: { jobId, tenantId, status: 'COMPENSATION_REQUIRED' } })
    if (cancellationPending > 0) {
      await prisma.productBulkImportJob.updateMany({
        where: { id: jobId, tenantId, status: 'CANCELLED' },
        data: {
          status: 'COMPENSATION_REQUIRED',
          lastErrorCode: 'CANCEL_COMPENSATION_REQUIRED',
          lastErrorMessage: 'Cancelled import cleanup still pending',
        },
      })
    }
    return { batch: { claimed: claimed.length, succeeded, failed }, ...(await getProductImportJob(tenantId, jobId)) }
  }

  const counts = await rowStatusCounts(jobId, tenantId)
  const ready = counts.get('READY') ?? 0
  const confirming = counts.get('CONFIRMING') ?? 0
  const invalid = counts.get('INVALID') ?? 0
  const confirmed = counts.get('CONFIRMED') ?? 0
  const failedRows = counts.get('FAILED') ?? 0
  const compensation = counts.get('COMPENSATION_REQUIRED') ?? 0
  const oldImageCleanupPending = await prisma.productBulkImportRow.count({
    where: { jobId, tenantId, status: 'CONFIRMED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
  })
  const nextStatus = compensation > 0 || oldImageCleanupPending > 0 ? 'COMPENSATION_REQUIRED'
    : failedRows > 0 ? 'FAILED'
      : ready > 0 || confirming > 0 ? 'CONFIRMING'
        : 'COMPLETED'
  const resultSummary = { total: job.totalRowCount, confirmed, invalid, failed: failedRows, compensationRequired: compensation + oldImageCleanupPending }
  const settled = await prisma.productBulkImportJob.updateMany({
    where: { id: job.id, tenantId, status: 'CONFIRMING_ACTIVE', version: leaseVersion },
    data: {
      status: nextStatus,
      readyRowCount: ready,
      invalidRowCount: invalid,
      confirmedRowCount: confirmed,
      failedRowCount: failedRows + compensation + oldImageCleanupPending,
      resultSummary: json(resultSummary),
      lastErrorCode: oldImageCleanupPending > 0
        ? 'OLD_IMAGE_CLEANUP_PENDING'
        : compensation > 0
          ? 'STORAGE_COMPENSATION_REQUIRED'
          : null,
      lastErrorMessage: oldImageCleanupPending > 0
        ? '商品已提交；旧图片等待后台清理'
        : compensation > 0
          ? 'Storage compensation still pending'
          : null,
      confirmedAt: confirmed > 0 ? new Date() : job.confirmedAt,
      completedAt: nextStatus === 'COMPLETED' ? new Date() : null,
      version: { increment: 1 },
    },
  })
  if (settled.count !== 1) {
    return { batch: { claimed: claimed.length, succeeded, failed }, ...(await getProductImportJob(tenantId, jobId)) }
  }
  if (nextStatus === 'COMPLETED') {
    const currentJob = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: job.id } })
    // Immediate best-effort cleanup plus a mandatory expiry sweep. The marker
    // remains null so a late PUT via an earlier signed URL is reaped at expiry.
    await cleanupProductImportStaging(currentJob)
  }
  return { batch: { claimed: claimed.length, succeeded, failed }, ...(await getProductImportJob(tenantId, jobId)) }
}

function imageResult(value: unknown): ProductImportImageResult {
  return object(value) as ProductImportImageResult
}

export async function retryProductImportJob(tenantId: string, jobId: string) {
  const job = await prisma.productBulkImportJob.findFirst({ where: { id: jobId, tenantId } })
  if (!job) throw new ProductImportError('JOB_NOT_FOUND', '导入任务不存在', 404)
  if (['CANCELLED', 'EXPIRED', 'COMPLETED'].includes(job.status)) throw new ProductImportError('JOB_NOT_RETRYABLE', '当前任务不能重试', 409)
  if (job.expiresAt <= new Date()) throw new ProductImportError('JOB_EXPIRED', '导入任务已过期', 410)
  if (!['FAILED', 'COMPENSATION_REQUIRED', 'CONFIRMING', 'CONFIRMING_ACTIVE', 'RETRYING_ACTIVE'].includes(job.status)) {
    throw new ProductImportError('JOB_NOT_RETRYABLE', 'Analyze 未完成的任务必须继续 Analyze，不能走 Confirm retry', 409)
  }
  const resumeCancellation = job.lastErrorCode === 'CANCEL_COMPENSATION_REQUIRED'
  const staleRetryBefore = new Date(Date.now() - 10 * 60 * 1000)
  const rows = await prisma.productBulkImportRow.findMany({
    where: {
      jobId,
      tenantId,
      OR: [
        { status: { in: ['FAILED', 'COMPENSATION_REQUIRED'] } },
        { status: 'CONFIRMING', updatedAt: { lt: staleRetryBefore } },
        { status: 'RETRYING', updatedAt: { lt: staleRetryBefore } },
        { status: 'CONFIRMED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
        ...(resumeCancellation ? [{ status: 'CANCELLED', imageResult: { not: Prisma.DbNull } }] : []),
      ],
    },
    orderBy: { sourceOrdinal: 'asc' },
    take: PRODUCT_IMPORT_CONFIRM_BATCH_SIZE,
  })
  const beforeCounts = await rowStatusCounts(jobId, tenantId)
  if (job.status === 'FAILED' && rows.length === 0) {
    throw new ProductImportError('JOB_RETRY_REQUIRES_ANALYZE', '该失败发生在 Analyze 阶段，请继续 Analyze', 409)
  }
  if (!resumeCancellation && rows.length === 0 && (beforeCounts.get('CONFIRMING') ?? 0) > 0) {
    throw new ProductImportError('RETRY_NOT_READY', '仍有确认批次在执行；10 分钟后才可接管恢复', 409)
  }
  if (rows.some((row) => {
    if (row.status === 'CONFIRMED' || row.updatedAt < staleRetryBefore) return false
    const result = imageResult(row.imageResult)
    return [...(result.compensationPendingKeys ?? []), ...(result.uploadIntentKeys ?? [])].length > 0
  })) {
    throw new ProductImportError('RETRY_NOT_READY', '图片上传请求仍可能在途；10 分钟静默期后才可安全重复删除', 409)
  }
  if (!resumeCancellation && job.totalRowCount === 0) {
    throw new ProductImportError('JOB_RETRY_REQUIRES_ANALYZE', '该任务需要重新执行 Analyze', 409)
  }
  const activeStatus = ['CONFIRMING_ACTIVE', 'RETRYING_ACTIVE'].includes(job.status)
  if (activeStatus && job.updatedAt >= staleRetryBefore) {
    throw new ProductImportError('RETRY_ALREADY_RUNNING', '另一个确认或恢复批次仍在执行', 409)
  }
  const jobClaim = await prisma.productBulkImportJob.updateMany({
    where: {
      id: job.id,
      tenantId,
      status: job.status,
      version: job.version,
      ...(activeStatus ? { updatedAt: { lt: staleRetryBefore } } : {}),
    },
    data: { status: 'RETRYING_ACTIVE', version: { increment: 1 } },
  })
  if (jobClaim.count !== 1) throw new ProductImportError('RETRY_ALREADY_RUNNING', '另一个恢复请求已接管任务', 409)
  const leaseVersion = job.version + 1
  let reset = 0
  let pending = 0
  for (const row of rows) {
    const result = imageResult(row.imageResult)
    if (row.status !== 'CONFIRMED') {
      const rowClaim = await prisma.productBulkImportRow.updateMany({
        where: { id: row.id, jobId, tenantId, status: row.status, version: row.version },
        data: { status: 'RETRYING', version: { increment: 1 } },
      })
      if (rowClaim.count !== 1) continue
    }
    const cleanupKeys = row.status === 'CONFIRMED'
      ? result.oldKeysPendingCleanup ?? []
      : [...new Set([...(result.compensationPendingKeys ?? []), ...(result.uploadIntentKeys ?? [])])]
    const remaining = await compensate(cleanupKeys)
    if (row.status === 'CONFIRMED') {
      const updated = await prisma.productBulkImportRow.updateMany({
        where: { id: row.id, jobId, tenantId, status: 'CONFIRMED', version: row.version },
        data: {
          imageResult: json({ ...result, oldKeysPendingCleanup: remaining, cleanupAttempts: (result.cleanupAttempts ?? 0) + 1 }),
          lastErrorCode: remaining.length > 0 ? 'OLD_IMAGE_CLEANUP_PENDING' : null,
          lastErrorMessage: remaining.length > 0 ? '商品已提交；旧图片等待后台清理' : null,
        },
      })
      if (updated.count === 1 && remaining.length > 0) pending += 1
      continue
    }
    const updated = await prisma.productBulkImportRow.updateMany({
      where: { id: row.id, jobId, tenantId, status: 'RETRYING', version: row.version + 1 },
      data: {
        status: remaining.length > 0 ? 'COMPENSATION_REQUIRED' : resumeCancellation ? 'CANCELLED' : 'READY',
        imageResult: remaining.length > 0
          ? json({ ...result, uploadIntentKeys: [], compensationPendingKeys: remaining, cleanupAttempts: (result.cleanupAttempts ?? 0) + 1 })
          : Prisma.DbNull,
        lastErrorCode: remaining.length > 0 ? 'STORAGE_COMPENSATION_REQUIRED' : null,
        lastErrorMessage: remaining.length > 0 ? 'Storage compensation still pending' : null,
        version: { increment: 1 },
      },
    })
    if (updated.count === 1) {
      if (remaining.length > 0) pending += 1
      else reset += 1
    }
  }
  const currentJob = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: job.id } })
  const stagingCleaned = resumeCancellation
    ? currentJob.stagingCleanedAt != null || await cleanupProductImportStaging(currentJob)
    : false
  const remainingCancellationRows = resumeCancellation
    ? await prisma.productBulkImportRow.count({
      where: {
        jobId,
        tenantId,
        OR: [
          { status: 'COMPENSATION_REQUIRED' },
          { status: 'CANCELLED', imageResult: { not: Prisma.DbNull } },
          { status: 'RETRYING' },
        ],
      },
    })
    : 0
  const cancellationPending = resumeCancellation && (pending > 0 || remainingCancellationRows > 0 || !stagingCleaned)
  const counts = await rowStatusCounts(jobId, tenantId)
  const ready = counts.get('READY') ?? 0
  const invalid = counts.get('INVALID') ?? 0
  const confirmed = counts.get('CONFIRMED') ?? 0
  const failedRows = counts.get('FAILED') ?? 0
  const compensationRows = counts.get('COMPENSATION_REQUIRED') ?? 0
  const confirming = counts.get('CONFIRMING') ?? 0
  const oldImageCleanupPending = await prisma.productBulkImportRow.count({
    where: { jobId, tenantId, status: 'CONFIRMED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
  })
  const nextStatus = cancellationPending ? 'COMPENSATION_REQUIRED'
    : resumeCancellation ? 'CANCELLED'
      : pending > 0 || compensationRows > 0 || oldImageCleanupPending > 0 ? 'COMPENSATION_REQUIRED'
        : failedRows > 0 ? 'FAILED'
          : ready > 0 ? 'PREVIEW_READY'
            : confirming > 0 ? 'CONFIRMING'
              : 'COMPLETED'
  const resultSummary = {
    total: job.totalRowCount,
    confirmed,
    invalid,
    failed: failedRows,
    compensationRequired: compensationRows + oldImageCleanupPending,
  }
  await prisma.productBulkImportJob.updateMany({
    where: { id: job.id, tenantId, status: 'RETRYING_ACTIVE', version: leaseVersion },
    data: {
      status: nextStatus,
      readyRowCount: ready,
      invalidRowCount: invalid,
      confirmedRowCount: confirmed,
      failedRowCount: failedRows + compensationRows + oldImageCleanupPending,
      resultSummary: json(resultSummary),
      lastErrorCode: cancellationPending
        ? 'CANCEL_COMPENSATION_REQUIRED'
        : oldImageCleanupPending > 0
          ? 'OLD_IMAGE_CLEANUP_PENDING'
          : pending > 0 || compensationRows > 0
            ? 'STORAGE_COMPENSATION_REQUIRED'
            : null,
      lastErrorMessage: cancellationPending
        ? 'Cancelled import cleanup still pending'
        : oldImageCleanupPending > 0
          ? '商品已提交；旧图片等待后台清理'
          : pending > 0 || compensationRows > 0
            ? 'Storage compensation still pending'
            : null,
      ...(nextStatus === 'COMPLETED' ? { completedAt: new Date() } : {}),
      version: { increment: 1 },
    },
  })
  if (nextStatus === 'COMPLETED') {
    const completedJob = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: job.id } })
    await cleanupProductImportStaging(completedJob)
  }
  return { reset, pending, ...(await getProductImportJob(tenantId, jobId)) }
}

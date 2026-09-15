import { createHash, randomUUID } from 'node:crypto'
import { Prisma, type ProductBulkImportJob } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  createSignedUploadUrl,
  deleteObject,
  deleteObjects,
  downloadObject,
  ensurePrivateBucket,
  uploadObject,
} from '@/lib/supabase-storage'
import { createProductImportAiProvider, type ProductImportAiPdfBlock } from './ai'
import { internalEan13Candidate } from './barcode'
import { resolveExistingCategory } from './categories'
import { materializeImportImage } from './images'
import {
  PRODUCT_IMPORT_ANALYZE_BATCH_SIZE,
  PRODUCT_IMPORT_CONFIRM_BATCH_SIZE,
  PRODUCT_IMPORT_MAX_SOURCE_BYTES,
  importFormatFromFile,
  isBlockingIssue,
  type ParsedProductImportRow,
  type ProductImportFieldMapping,
  type ProductImportFormat,
  type ProductImportImageCandidate,
  type ProductImportIssue,
  type ProductImportImageResult,
  type ProductImportParseResult,
  type ProductImportPreviewPayload,
} from './contract'
import { pdfBlocksToRows } from './pdf'
import { inspectSpreadsheetBuffer, parseSpreadsheetBuffer, unzipOfficeEntries, type SpreadsheetParseCursor } from './xlsx'

export const PRODUCT_IMPORT_STAGING_BUCKET = 'product-import-staging'
const STAGING_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'application/csv',
  'application/pdf',
  'application/json',
]
const ANALYSIS_ARTIFACT_MAX_BYTES = 8 * 1024 * 1024
const ANALYSIS_ARTIFACT_JOB_MAX_BYTES = 256 * 1024 * 1024
const ANALYSIS_ARTIFACT_QUIESCENCE_MS = 2 * 60 * 1000
// Keep row persistence comfortably below the interactive-transaction deadline.
// Parse artifacts stay larger so XLSX/OOXML work is not repeated for every DB batch.
const ANALYSIS_DB_PERSIST_BATCH_SIZE = 50

export class ProductImportError extends Error {
  constructor(readonly code: string, message = code, readonly status = 400) {
    super(message)
    this.name = 'ProductImportError'
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function extensionFor(format: ProductImportFormat): string {
  return format.toLowerCase()
}

function canonicalMimeType(format: ProductImportFormat): string {
  if (format === 'XLSX') return STAGING_MIME_TYPES[0]
  if (format === 'CSV') return 'text/csv'
  return 'application/pdf'
}

export type CreateProductImportJobInput = {
  fileName: string
  mimeType: string
  fileSize: number
}

export async function createProductImportJob(tenantId: string, input: CreateProductImportJobInput) {
  const fileName = input.fileName.trim().slice(0, 255)
  const suppliedMimeType = input.mimeType.trim().slice(0, 127)
  const format = importFormatFromFile(fileName, suppliedMimeType)
  if (!format) throw new ProductImportError('UNSUPPORTED_FILE_TYPE', '仅支持 XLSX / CSV / PDF')
  if (!Number.isInteger(input.fileSize) || input.fileSize <= 0 || input.fileSize > PRODUCT_IMPORT_MAX_SOURCE_BYTES) {
    throw new ProductImportError('FILE_TOO_LARGE', '原始文件必须大于 0 且不超过 50MB')
  }
  const id = randomUUID()
  const mimeType = canonicalMimeType(format)
  const stagingStorageKey = `tenants/${tenantId}/product-import-jobs/${id}/source.${extensionFor(format)}`
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await prisma.productBulkImportJob.create({
    data: {
      id,
      tenantId,
      sourceFileName: fileName,
      sourceMimeType: mimeType,
      sourceFormat: format,
      sourceFileSize: input.fileSize,
      stagingStorageKey,
      expiresAt,
    },
  })
  try {
    await ensurePrivateBucket(PRODUCT_IMPORT_STAGING_BUCKET, {
      fileSizeLimit: PRODUCT_IMPORT_MAX_SOURCE_BYTES,
      allowedMimeTypes: STAGING_MIME_TYPES,
    })
    const uploadUrl = await createSignedUploadUrl(PRODUCT_IMPORT_STAGING_BUCKET, stagingStorageKey)
    return { jobId: id, uploadUrl, uploadMimeType: mimeType, storageKey: stagingStorageKey, expiresAt }
  } catch (error) {
    await prisma.productBulkImportJob.update({
      where: { id },
      data: {
        status: 'FAILED',
        lastErrorCode: 'STAGING_SIGN_FAILED',
        lastErrorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'STAGING_SIGN_FAILED',
      },
    })
    throw error
  }
}

async function tenantJob(tenantId: string, jobId: string): Promise<ProductBulkImportJob> {
  const job = await prisma.productBulkImportJob.findFirst({ where: { id: jobId, tenantId } })
  if (!job) throw new ProductImportError('JOB_NOT_FOUND', '导入任务不存在', 404)
  return job
}

export async function resignProductImportUpload(tenantId: string, jobId: string) {
  const job = await tenantJob(tenantId, jobId)
  const staleUploadSigningBefore = new Date(Date.now() - 2 * 60 * 1000)
  const staleUploadSigning = job.status === 'UPLOAD_SIGNING' && job.updatedAt <= staleUploadSigningBefore
  const failedBeforeAnalysis = job.status === 'FAILED'
    && !job.sourceFileHash
    && job.totalRowCount === 0
    && job.analyzedRowCount === 0
  if (job.status !== 'AWAITING_UPLOAD' && !failedBeforeAnalysis && !staleUploadSigning) {
    throw new ProductImportError('JOB_NOT_UPLOADABLE', '当前状态不能重新签名上传', 409)
  }
  if (job.expiresAt <= new Date()) throw new ProductImportError('JOB_EXPIRED', '导入任务已过期', 410)
  const claimed = await prisma.productBulkImportJob.updateMany({
    where: {
      id: job.id,
      tenantId,
      status: job.status,
      version: job.version,
      ...(staleUploadSigning ? { updatedAt: { lte: staleUploadSigningBefore } } : {}),
    },
    data: { status: 'UPLOAD_SIGNING', version: { increment: 1 } },
  })
  if (claimed.count !== 1) throw new ProductImportError('JOB_VERSION_CONFLICT', '任务状态已变化，不能重新签名', 409)
  const leaseVersion = job.version + 1
  try {
    await ensurePrivateBucket(PRODUCT_IMPORT_STAGING_BUCKET, {
      fileSizeLimit: PRODUCT_IMPORT_MAX_SOURCE_BYTES,
      allowedMimeTypes: STAGING_MIME_TYPES,
    })
    const uploadUrl = await createSignedUploadUrl(PRODUCT_IMPORT_STAGING_BUCKET, job.stagingStorageKey)
    const released = await prisma.productBulkImportJob.updateMany({
      where: { id: job.id, tenantId, status: 'UPLOAD_SIGNING', version: leaseVersion },
      data: { status: 'AWAITING_UPLOAD', lastErrorCode: null, lastErrorMessage: null, version: { increment: 1 } },
    })
    if (released.count !== 1) throw new ProductImportError('JOB_VERSION_CONFLICT', '任务已终止，签名不会返回', 409)
    return { jobId: job.id, uploadUrl, uploadMimeType: job.sourceMimeType, storageKey: job.stagingStorageKey, expiresAt: job.expiresAt }
  } catch (error) {
    await prisma.productBulkImportJob.updateMany({
      where: { id: job.id, tenantId, status: 'UPLOAD_SIGNING', version: leaseVersion },
      data: {
        status: 'FAILED',
        lastErrorCode: 'STAGING_SIGN_FAILED',
        lastErrorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'STAGING_SIGN_FAILED',
        version: { increment: 1 },
      },
    })
    throw error
  }
}

type SavedAnalysis = {
  provider?: string
  model?: string
  spreadsheetMappings?: Array<{
    sheetIndex: number
    selected: boolean
    headerRowNumber: number
    mapping: ProductImportFieldMapping
    confidence?: number
    warnings?: string[]
  }>
  pdfBlocks?: unknown[]
  parseWarnings?: ProductImportIssue[]
  categorySuggestionError?: string
  parseArtifacts?: ParseArtifactManifest
  abandonedArtifactKeys?: string[]
  artifactCleanupNotBefore?: string
  artifactRebuildCleanupPendingKeys?: string[]
  artifactRebuildCleanupComplete?: boolean
  stagingCleanupPendingKeys?: string[]
  stagingCleanupComplete?: boolean
  spreadsheetCursor?: SpreadsheetParseCursor | null
  pdfCursor?: number
  sourceComplete?: boolean
}

type ParseArtifactChunk = {
  key: string
  startOrdinal: number
  rowCount: number
  byteSize: number
  sha256: string
}

type ParseArtifactManifest = {
  version: 1
  generation: string
  sourceFileHash: string
  totalRows: number
  sourceComplete: boolean
  ready: boolean
  chunks: ParseArtifactChunk[]
}

function parseArtifactManifest(value: unknown): ParseArtifactManifest | null {
  const candidate = record(value)
  if (
    candidate.version !== 1
    || typeof candidate.generation !== 'string'
    || !/^[a-f0-9-]{36}$/.test(candidate.generation)
    || typeof candidate.sourceFileHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(candidate.sourceFileHash)
    || !Number.isInteger(candidate.totalRows)
    || Number(candidate.totalRows) < 0
    || typeof candidate.sourceComplete !== 'boolean'
    || typeof candidate.ready !== 'boolean'
    || !Array.isArray(candidate.chunks)
  ) return null
  const chunks: ParseArtifactChunk[] = []
  for (const rawChunk of candidate.chunks) {
    const chunk = record(rawChunk)
    if (
      typeof chunk.key !== 'string'
      || !Number.isInteger(chunk.startOrdinal)
      || Number(chunk.startOrdinal) < 1
      || !Number.isInteger(chunk.rowCount)
      || Number(chunk.rowCount) < 1
      || !Number.isInteger(chunk.byteSize)
      || Number(chunk.byteSize) < 1
      || Number(chunk.byteSize) > ANALYSIS_ARTIFACT_MAX_BYTES
      || typeof chunk.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(chunk.sha256)
    ) return null
    chunks.push({
      key: chunk.key,
      startOrdinal: Number(chunk.startOrdinal),
      rowCount: Number(chunk.rowCount),
      byteSize: Number(chunk.byteSize),
      sha256: chunk.sha256,
    })
  }
  if (chunks.reduce((total, chunk) => total + chunk.byteSize, 0) > ANALYSIS_ARTIFACT_JOB_MAX_BYTES) return null
  return {
    version: 1,
    generation: candidate.generation,
    sourceFileHash: candidate.sourceFileHash,
    totalRows: Number(candidate.totalRows),
    sourceComplete: candidate.sourceComplete,
    ready: candidate.ready,
    chunks,
  }
}

function artifactKey(job: ProductBulkImportJob, generation: string, index: number) {
  const directory = job.stagingStorageKey.slice(0, job.stagingStorageKey.lastIndexOf('/'))
  return `${directory}/analysis/v1/${generation}/chunk-${String(index + 1).padStart(6, '0')}.json`
}

function serializeParseArtifactChunks(job: ProductBulkImportJob, generation: string, startIndex: number, rows: ParsedProductImportRow[]) {
  const chunks: Array<{ descriptor: ParseArtifactChunk; bytes: Buffer }> = []
  let current: ParsedProductImportRow[] = []
  const flush = () => {
    if (current.length === 0) return
    const bytes = Buffer.from(JSON.stringify(current))
    const index = startIndex + chunks.length
    chunks.push({
      descriptor: {
        key: artifactKey(job, generation, index),
        startOrdinal: current[0].sourceOrdinal,
        rowCount: current.length,
        byteSize: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      bytes,
    })
    current = []
  }
  for (const row of rows) {
    const singleBytes = Buffer.byteLength(JSON.stringify([row]))
    if (singleBytes > ANALYSIS_ARTIFACT_MAX_BYTES) {
      throw new ProductImportError('ANALYSIS_ROW_TOO_LARGE', `第 ${row.sourceOrdinal} 行解析结果过大`, 413)
    }
    const candidate = [...current, row]
    if (
      current.length > 0
      && (candidate.length > PRODUCT_IMPORT_ANALYZE_BATCH_SIZE || Buffer.byteLength(JSON.stringify(candidate)) > ANALYSIS_ARTIFACT_MAX_BYTES)
    ) flush()
    current.push(row)
  }
  flush()
  return chunks
}

async function persistParseArtifacts(
  job: ProductBulkImportJob,
  sourceFileHash: string,
  parsed: ProductImportParseResult,
  metadata: SavedAnalysis,
  lease: { version: number },
): Promise<{ manifest: ParseArtifactManifest; metadata: SavedAnalysis }> {
  const previous = parseArtifactManifest(record(job.analysisMetadata).parseArtifacts)
  const appendPrevious = previous?.ready && previous.sourceFileHash === sourceFileHash ? previous : null
  const generation = appendPrevious?.generation ?? randomUUID()
  const previousChunks = appendPrevious?.chunks ?? []
  const chunks = serializeParseArtifactChunks(job, generation, previousChunks.length, parsed.rows)
  const totalArtifactBytes = [...previousChunks, ...chunks.map((chunk) => chunk.descriptor)]
    .reduce((total, chunk) => total + chunk.byteSize, 0)
  if (totalArtifactBytes > ANALYSIS_ARTIFACT_JOB_MAX_BYTES) {
    throw new ProductImportError('ANALYSIS_ARTIFACT_LIMIT', 'Analyze 分片总大小超过 256MB', 413)
  }
  const manifest: ParseArtifactManifest = {
    version: 1,
    generation,
    sourceFileHash,
    totalRows: Math.max(appendPrevious?.totalRows ?? 0, parsed.rows.at(-1)?.sourceOrdinal ?? 0),
    sourceComplete: metadata.sourceComplete === true,
    ready: false,
    chunks: [...previousChunks, ...chunks.map((chunk) => chunk.descriptor)],
  }
  const attemptedKeys = chunks.map((chunk) => chunk.descriptor.key)
  // Register the quiescence tombstone before any PUT starts. This keeps the
  // attempted generation discoverable even if the upload and a later metadata
  // write both lose their responses.
  const savedMetadata: SavedAnalysis = {
    ...metadata,
    parseArtifacts: manifest,
    ...(attemptedKeys.length > 0 ? {
      abandonedArtifactKeys: [...new Set([...(metadata.abandonedArtifactKeys ?? []), ...attemptedKeys])],
      artifactCleanupNotBefore: new Date(Date.now() + ANALYSIS_ARTIFACT_QUIESCENCE_MS).toISOString(),
    } : {}),
  }
  const registered = await prisma.productBulkImportJob.updateMany({
    where: { id: job.id, tenantId: job.tenantId, status: 'ANALYZING', version: lease.version },
    data: {
      sourceFileHash,
      totalRowCount: manifest.totalRows,
      analysisMetadata: json(savedMetadata),
      analysisRevision: job.analysisRevision || 1,
      version: { increment: 1 },
    },
  })
  if (registered.count !== 1) throw new ProductImportError('ANALYZE_LEASE_LOST', 'Analyze 已被取消或被其他请求接管', 409)
  lease.version += 1
  try {
    for (const chunk of chunks) {
      await uploadObject(PRODUCT_IMPORT_STAGING_BUCKET, chunk.descriptor.key, chunk.bytes, 'application/json')
    }
  } catch (error) {
    // The initial ready=false registration is the durable retry/cleanup ledger.
    await deleteStorageKeys(PRODUCT_IMPORT_STAGING_BUCKET, attemptedKeys)
    throw error
  }
  manifest.ready = true
  // Once the normalized rows are durably chunked, raw PDF AI blocks are no
  // longer needed in the database metadata.
  const readyMetadata: SavedAnalysis = {
    ...savedMetadata,
    pdfBlocks: metadata.sourceComplete ? undefined : savedMetadata.pdfBlocks,
    parseArtifacts: manifest,
    abandonedArtifactKeys: undefined,
    artifactCleanupNotBefore: undefined,
  }
  const completed = await prisma.productBulkImportJob.updateMany({
    where: { id: job.id, tenantId: job.tenantId, status: 'ANALYZING', version: lease.version },
    data: { analysisMetadata: json(readyMetadata), version: { increment: 1 } },
  })
  if (completed.count !== 1) {
    const chunkKeys = chunks.map((chunk) => chunk.descriptor.key)
    const cleanupFailed = chunkKeys.length > 100
      || !await deleteObjects(PRODUCT_IMPORT_STAGING_BUCKET, chunkKeys)
    if (cleanupFailed) {
      await prisma.productBulkImportJob.updateMany({
        where: { id: job.id, tenantId: job.tenantId, status: 'CANCELLED' },
        data: {
          status: 'COMPENSATION_REQUIRED',
          lastErrorCode: 'CANCEL_COMPENSATION_REQUIRED',
          lastErrorMessage: 'Cancelled import analysis artifact cleanup still pending',
          version: { increment: 1 },
        },
      })
    }
    throw new ProductImportError('ANALYZE_LEASE_LOST', 'Analyze 已被取消或被其他请求接管', 409)
  }
  lease.version += 1
  return { manifest, metadata: readyMetadata }
}

async function readParseArtifactBatch(manifest: ParseArtifactManifest, analyzedCount: number) {
  const nextOrdinal = analyzedCount + 1
  const descriptor = manifest.chunks.find((chunk) => (
    nextOrdinal >= chunk.startOrdinal && nextOrdinal < chunk.startOrdinal + chunk.rowCount
  ))
  if (!descriptor) {
    if (analyzedCount === manifest.totalRows) return []
    throw new ProductImportError('ANALYSIS_ARTIFACT_CURSOR_INVALID', 'Analyze 分片游标不连续', 409)
  }
  try {
    const bytes = await downloadObject(PRODUCT_IMPORT_STAGING_BUCKET, descriptor.key, ANALYSIS_ARTIFACT_MAX_BYTES)
    if (bytes.length !== descriptor.byteSize || createHash('sha256').update(bytes).digest('hex') !== descriptor.sha256) {
      throw new ProductImportError('ANALYSIS_ARTIFACT_HASH_MISMATCH', 'Analyze 分片完整性校验失败', 409)
    }
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== descriptor.rowCount) {
      throw new ProductImportError('ANALYSIS_ARTIFACT_INVALID', 'Analyze 分片格式无效', 409)
    }
    const offset = nextOrdinal - descriptor.startOrdinal
    const batch = (parsed as ParsedProductImportRow[]).slice(offset, offset + ANALYSIS_DB_PERSIST_BATCH_SIZE)
    if (
      batch.length === 0
      || batch.some((row, index) => row.sourceOrdinal !== nextOrdinal + index)
    ) {
      throw new ProductImportError('ANALYSIS_ARTIFACT_CURSOR_INVALID', 'Analyze 分片行游标不连续', 409)
    }
    return batch
  } catch (error) {
    if (error instanceof ProductImportError) throw error
    throw new ProductImportError('ANALYSIS_ARTIFACT_READ_FAILED', 'Analyze 分片无法读取，将从原始文件恢复', 409)
  }
}

async function deleteParseArtifacts(job: StagingCleanupJob) {
  return cleanupTrackedStagingKeys(
    job,
    parseArtifactKeys(job),
    'artifactRebuildCleanupPendingKeys',
    'artifactRebuildCleanupComplete',
    { maxBatches: 1 },
  )
}

function parseArtifactKeys(job: Pick<ProductBulkImportJob, 'stagingStorageKey' | 'analysisMetadata'>) {
  const metadata = record(job.analysisMetadata)
  const manifest = parseArtifactManifest(metadata.parseArtifacts)
  const directory = job.stagingStorageKey.slice(0, job.stagingStorageKey.lastIndexOf('/'))
  const abandoned = Array.isArray(metadata.abandonedArtifactKeys)
    ? metadata.abandonedArtifactKeys.filter((key): key is string => typeof key === 'string')
    : []
  return [...new Set([
    ...(manifest?.chunks.map((chunk) => chunk.key) ?? []),
    ...abandoned,
  ].filter((key) => key.startsWith(`${directory}/analysis/`)))]
}

/** Delete the original source and every deterministic analysis artifact. */
export async function cleanupProductImportStaging(
  job: StagingCleanupJob,
  options: { maxBatches?: number; restart?: boolean } = {},
) {
  // Keep the signed-upload source as the final ledger item. If cleanup spans
  // batches, a late PUT cannot recreate a source key that has already fallen
  // behind the persisted cursor; the expiry sweep deletes it last.
  const keys = [...parseArtifactKeys(job), job.stagingStorageKey]
  return cleanupTrackedStagingKeys(
    job,
    keys,
    'stagingCleanupPendingKeys',
    'stagingCleanupComplete',
    options,
  )
}

type StagingCleanupJob = Pick<
  ProductBulkImportJob,
  'id' | 'tenantId' | 'status' | 'version' | 'stagingStorageKey' | 'analysisMetadata'
>

async function cleanupTrackedStagingKeys(
  job: StagingCleanupJob,
  initialKeys: string[],
  pendingField: 'artifactRebuildCleanupPendingKeys' | 'stagingCleanupPendingKeys',
  completeField: 'artifactRebuildCleanupComplete' | 'stagingCleanupComplete',
  options: { maxBatches?: number; restart?: boolean },
) {
  let metadata = record(job.analysisMetadata)
  const savedPending = Array.isArray(metadata[pendingField])
    ? (metadata[pendingField] as unknown[]).filter((key): key is string => typeof key === 'string')
    : null
  const wasComplete = metadata[completeField] === true
  if (wasComplete && !options.restart) return true
  let pending = savedPending && !wasComplete ? savedPending : [...new Set(initialKeys)]
  const directory = job.stagingStorageKey.slice(0, job.stagingStorageKey.lastIndexOf('/'))
  pending = pending.filter((key) => key === job.stagingStorageKey || key.startsWith(`${directory}/analysis/`))
  const maxBatches = Math.max(1, Math.min(7, options.maxBatches ?? 1))
  for (let batchIndex = 0; batchIndex < maxBatches && pending.length > 0; batchIndex += 1) {
    const batch = pending.slice(0, 100)
    if (!await deleteObjects(PRODUCT_IMPORT_STAGING_BUCKET, batch)) break
    pending = pending.slice(batch.length)
    metadata = { ...metadata, [pendingField]: pending, [completeField]: pending.length === 0 }
    const progressSaved = await prisma.productBulkImportJob.updateMany({
      where: { id: job.id, tenantId: job.tenantId, status: job.status, version: job.version },
      data: { analysisMetadata: json(metadata) },
    })
    if (progressSaved.count !== 1) return false
  }
  return pending.length === 0
}

async function deleteStorageKeys(bucket: string, keys: string[]): Promise<string[]> {
  const uniqueKeys = [...new Set(keys)]
  const results = await Promise.allSettled(uniqueKeys.map((key) => deleteObject(bucket, key)))
  return uniqueKeys.filter((_, index) => {
    const result = results[index]
    return result.status === 'rejected' || result.value !== true
  })
}

function mergeParseWarnings(previous: ProductImportIssue[] | undefined, next: ProductImportIssue[]) {
  const merged = new Map<string, ProductImportIssue>()
  for (const warning of [...(previous ?? []), ...next]) {
    merged.set(`${warning.code}:${warning.field ?? ''}:${warning.message}`, warning)
  }
  return [...merged.values()]
}

async function parseSource(
  job: ProductBulkImportJob,
  source: Buffer,
  startOrdinal: number,
  sourceFileHash: string,
): Promise<{ parsed: ProductImportParseResult; metadata: SavedAnalysis }> {
  const format = job.sourceFormat as ProductImportFormat
  const saved = record(job.analysisMetadata) as SavedAnalysis
  if (format === 'PDF') {
    let blocks = Array.isArray(saved.pdfBlocks) ? saved.pdfBlocks : null
    let provider = saved.provider
    let model = saved.model
    if (!blocks) {
      const cacheId = `pdf-ai-v1-${createHash('sha256').update(`${job.tenantId}:${sourceFileHash}`).digest('hex')}`
      const cached = await prisma.productBulkImportJob.findUnique({ where: { id: cacheId }, select: { analysisMetadata: true } })
      const cachedMetadata = record(cached?.analysisMetadata)
      const cachedBlocks = cachedMetadata.pdfBlocks
      if (Array.isArray(cachedBlocks)) {
        blocks = cachedBlocks
        provider = typeof cachedMetadata.provider === 'string' ? cachedMetadata.provider : provider
        model = typeof cachedMetadata.model === 'string' ? cachedMetadata.model : model
      } else {
        const ai = createProductImportAiProvider()
        const recognized = await ai.recognizePdf(source)
        const now = new Date()
        const canonical = await prisma.productBulkImportJob.upsert({
          where: { id: cacheId },
          create: {
            id: cacheId,
            tenantId: job.tenantId,
            sourceFileName: job.sourceFileName,
            sourceMimeType: job.sourceMimeType,
            sourceFormat: 'PDF_AI_CACHE',
            sourceFileSize: job.sourceFileSize,
            sourceFileHash,
            stagingStorageKey: `analysis-cache/pdf-v1/${cacheId}`,
            status: 'COMPLETED',
            analysisRevision: 1,
            analysisMetadata: json({ provider: ai.providerId, model: ai.modelId, pdfBlocks: recognized }),
            resultSummary: json({ cachedBlocks: recognized.length }),
            expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
            analyzedAt: now,
            completedAt: now,
            stagingCleanedAt: now,
          },
          update: {},
          select: { analysisMetadata: true },
        })
        const canonicalMetadata = record(canonical.analysisMetadata)
        if (!Array.isArray(canonicalMetadata.pdfBlocks)) throw new ProductImportError('AI_CACHE_INVALID', 'PDF AI 缓存无效', 409)
        blocks = canonicalMetadata.pdfBlocks
        provider = typeof canonicalMetadata.provider === 'string' ? canonicalMetadata.provider : ai.providerId
        model = typeof canonicalMetadata.model === 'string' ? canonicalMetadata.model : ai.modelId
      }
    }
    const validBlocks = blocks.filter((block): block is ProductImportAiPdfBlock => {
      if (!block || typeof block !== 'object') return false
      const candidate = block as Partial<ProductImportAiPdfBlock>
      return Number.isInteger(candidate.pageNumber)
        && typeof candidate.name === 'string'
        && Array.isArray(candidate.sourceBox)
        && candidate.sourceBox.length === 4
    })
    if (validBlocks.length !== blocks.length) throw new ProductImportError('AI_CACHE_INVALID', 'PDF AI 缓存结构无效', 409)
    const allRows = pdfBlocksToRows(validBlocks)
    const cursor = saved.pdfCursor ?? startOrdinal
    const rows = allRows.rows.slice(cursor, cursor + PRODUCT_IMPORT_ANALYZE_BATCH_SIZE)
    const nextCursor = cursor + rows.length
    const sourceComplete = nextCursor >= allRows.rows.length
    return {
      parsed: { rows, sheets: [], warnings: allRows.warnings },
      metadata: {
        ...saved,
        provider,
        model,
        pdfBlocks: blocks,
        pdfCursor: nextCursor,
        sourceComplete,
        parseWarnings: mergeParseWarnings(saved.parseWarnings, allRows.warnings),
      },
    }
  }

  if (format !== 'XLSX' && format !== 'CSV') throw new ProductImportError('SOURCE_FORMAT_INVALID')
  const inspections = inspectSpreadsheetBuffer(source, format)
  let mappings = saved.spreadsheetMappings
  let provider = saved.provider
  let model = saved.model
  const needsAi = inspections.length > 1 || inspections.some((sheet) => !sheet.deterministicMapping)
  if (!mappings && needsAi) {
    const ai = createProductImportAiProvider()
    mappings = await ai.mapSpreadsheet(inspections)
    provider = ai.providerId
    model = ai.modelId
  }
  if (needsAi) {
    const decisions = mappings ?? []
    const decidedIndexes = new Set(decisions.map((mapping) => mapping.sheetIndex))
    if (
      decisions.length !== inspections.length
      || decidedIndexes.size !== decisions.length
      || inspections.some((sheet) => !decidedIndexes.has(sheet.sheetIndex))
    ) {
      throw new ProductImportError(
        'AI_MAPPING_INCOMPLETE',
        'AI 必须对每个工作表给出一次且仅一次导入或跳过决定',
        409,
      )
    }
  }
  const mappingBySheet: Partial<Record<number, { headerRowNumber: number; mapping: ProductImportFieldMapping; selected?: boolean }>> = {}
  if (mappings) {
    for (const mapping of mappings) {
      mappingBySheet[mapping.sheetIndex] = {
        headerRowNumber: mapping.headerRowNumber,
        mapping: mapping.mapping,
        selected: mapping.selected,
      }
    }
  }
  const parsed = parseSpreadsheetBuffer(source, format, mappingBySheet, {
    cursor: saved.spreadsheetCursor,
    maxRows: PRODUCT_IMPORT_ANALYZE_BATCH_SIZE,
    maxScannedRows: 5_000,
    startOrdinal,
  })
  return {
    parsed,
    metadata: {
      ...saved,
      provider,
      model,
      spreadsheetMappings: mappings,
      spreadsheetCursor: parsed.nextCursor,
      sourceComplete: parsed.complete,
      parseWarnings: mergeParseWarnings(saved.parseWarnings, parsed.warnings),
    },
  }
}

async function allocateGeneratedBarcode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  sourceFileHash: string,
  stableSourceRowIdentity: string,
): Promise<string> {
  const key = { tenantId_sourceFileHash_stableSourceRowIdentity: { tenantId, sourceFileHash, stableSourceRowIdentity } }
  const existing = await tx.productGeneratedBarcode.findUnique({ where: key })
  if (existing) {
    await tx.productGeneratedBarcode.update({
      where: { id: existing.id },
      data: { reuseCount: { increment: 1 }, lastReusedAt: new Date() },
    })
    return existing.assignedBarcode
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const assignedBarcode = internalEan13Candidate(`${tenantId}:${sourceFileHash}:${stableSourceRowIdentity}`, attempt)
    const productCollision = await tx.product.findUnique({ where: { tenantId_barcode: { tenantId, barcode: assignedBarcode } }, select: { id: true } })
    if (productCollision) continue
    await tx.productGeneratedBarcode.createMany({
      data: [{ tenantId, sourceFileHash, stableSourceRowIdentity, assignedBarcode }],
      skipDuplicates: true,
    })
    const allocated = await tx.productGeneratedBarcode.findUnique({ where: key })
    if (allocated) return allocated.assignedBarcode
  }
  throw new ProductImportError('BARCODE_ALLOCATION_EXHAUSTED', '无法分配内部 EAN-13', 409)
}

export async function allocateStableGeneratedBarcode(
  tenantId: string,
  sourceFileHash: string,
  stableSourceRowIdentity: string,
): Promise<string> {
  return prisma.$transaction((tx) => allocateGeneratedBarcode(tx, tenantId, sourceFileHash, stableSourceRowIdentity))
}

function categoryIssues(row: ParsedProductImportRow, status: ReturnType<typeof resolveExistingCategory>): ProductImportIssue[] {
  const issues = [...row.issues]
  if (status.status === 'NOT_FOUND') {
    issues.push({ code: 'CATEGORY_NOT_FOUND', field: 'categoryId', message: '未找到现有分类，请在 Preview 中选择', blocking: true })
  } else if (status.status === 'AMBIGUOUS') {
    issues.push({ code: 'CATEGORY_AMBIGUOUS', field: 'categoryId', message: '存在多个同名分类，请在 Preview 中选择', blocking: true })
  }
  return issues
}

export async function analyzeProductImportJob(tenantId: string, jobId: string) {
  let job = await tenantJob(tenantId, jobId)
  if (['CANCELLED', 'EXPIRED', 'CONFIRMING', 'COMPENSATION_REQUIRED'].includes(job.status)) {
    throw new ProductImportError('JOB_NOT_ANALYZABLE', '当前任务状态不能执行 Analyze', 409)
  }
  if (job.status === 'COMPLETED') return getProductImportJob(tenantId, jobId)
  if (job.status === 'PREVIEW_READY' && job.analyzedRowCount >= job.totalRowCount) {
    return getProductImportJob(tenantId, jobId)
  }
  if (job.status === 'FAILED') {
    const failedCounts = await productImportRowCounts(job.id, tenantId)
    if (failedCounts.failed > 0) {
      throw new ProductImportError('JOB_NOT_ANALYZABLE', 'Confirm 失败行必须通过清理/重试恢复，不能重新 Analyze', 409)
    }
  }
  if (job.expiresAt <= new Date()) {
    await prisma.productBulkImportJob.updateMany({
      where: { id: job.id, tenantId, version: job.version },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    })
    throw new ProductImportError('JOB_EXPIRED', '导入任务已过期', 410)
  }
  const initialMetadata = record(job.analysisMetadata) as SavedAnalysis
  const cleanupNotBefore = initialMetadata.artifactCleanupNotBefore
  if (
    job.status === 'FAILED'
    && (initialMetadata.abandonedArtifactKeys?.length ?? 0) > 0
    && typeof cleanupNotBefore === 'string'
    && Date.parse(cleanupNotBefore) > Date.now()
  ) {
    throw new ProductImportError('ANALYSIS_ARTIFACT_QUIESCENCE_REQUIRED', 'Analyze 分片上传仍可能在途，请稍后重试', 409)
  }
  // Route maxDuration is 300s; takeover waits longer so two generations never
  // overlap after the platform terminates the older invocation.
  const staleAnalyzeBefore = new Date(Date.now() - 10 * 60 * 1000)
  const claimable = ['AWAITING_UPLOAD', 'FAILED', 'ANALYSIS_PENDING'].includes(job.status)
    || (job.status === 'ANALYZING' && job.updatedAt < staleAnalyzeBefore)
  if (!claimable) throw new ProductImportError('ANALYZE_ALREADY_RUNNING', '另一个 Analyze 批次仍在执行', 409)
  const claimed = await prisma.productBulkImportJob.updateMany({
    where: {
      id: job.id,
      tenantId,
      version: job.version,
      status: job.status,
      ...(job.status === 'ANALYZING' ? { updatedAt: { lt: staleAnalyzeBefore } } : {}),
    },
    data: {
      status: 'ANALYZING',
      analyzeAttemptCount: { increment: 1 },
      lastErrorCode: null,
      lastErrorMessage: null,
      version: { increment: 1 },
    },
  })
  if (claimed.count !== 1) throw new ProductImportError('ANALYZE_ALREADY_RUNNING', '另一个 Analyze 批次已接管任务', 409)
  job = await tenantJob(tenantId, jobId)
  const lease = { version: job.version }

  try {
    let metadata = record(job.analysisMetadata) as SavedAnalysis
    let manifest = parseArtifactManifest(metadata.parseArtifacts)
    const pendingImageRows = await prisma.productBulkImportRow.findMany({
      where: { jobId: job.id, tenantId, status: 'IMAGE_PENDING' },
      orderBy: { sourceOrdinal: 'asc' },
      take: 4,
      select: { id: true, version: true, imagePlan: true, validationIssues: true },
    })
    if (pendingImageRows.length > 0) {
      const cached = new Map<string, Promise<string>>()
      const frozenRows: Array<{
        id: string
        version: number
        candidates: ProductImportImageCandidate[]
        issues: ProductImportIssue[]
      }> = []
      // At most four rows per request. The three candidates within one row run
      // concurrently, bounding this phase to one 25-second external timeout per row.
      for (const pendingRow of pendingImageRows) {
        const rawCandidates = record(pendingRow.imagePlan).candidates
        const candidates = Array.isArray(rawCandidates)
          ? rawCandidates.filter((candidate): candidate is ProductImportImageCandidate => (
            !!candidate && typeof candidate === 'object' && typeof (candidate as ProductImportImageCandidate).source === 'string'
          )).slice(0, 3).map((candidate) => ({ ...candidate }))
          : []
        const issues = Array.isArray(pendingRow.validationIssues)
          ? pendingRow.validationIssues as unknown as ProductImportIssue[]
          : []
        await Promise.all(candidates.map(async (candidate) => {
          if (candidate.kind !== 'EXTERNAL_URL') return
          try {
            let hash = cached.get(candidate.source)
            if (!hash) {
              hash = materializeImportImage(candidate).then((normalized) => normalized.imageHash)
              cached.set(candidate.source, hash)
            }
            candidate.imageHash = await hash
          } catch (error) {
            issues.push({
              code: 'IMAGE_FETCH_FAILED',
              field: 'images',
              message: `外链图片无法冻结：${error instanceof Error ? error.message.slice(0, 160) : 'IMAGE_FETCH_FAILED'}`,
              blocking: true,
            })
          }
        }))
        frozenRows.push({ id: pendingRow.id, version: pendingRow.version, candidates, issues })
      }
      await prisma.$transaction(async (tx) => {
        const leaseClaim = await tx.productBulkImportJob.updateMany({
          where: { id: job.id, tenantId, status: 'ANALYZING', version: lease.version },
          data: { version: { increment: 1 } },
        })
        if (leaseClaim.count !== 1) throw new ProductImportError('ANALYZE_LEASE_LOST', 'Analyze 已被取消或被其他请求接管', 409)
        for (const frozen of frozenRows) {
          const changed = await tx.productBulkImportRow.updateMany({
            where: { id: frozen.id, jobId: job.id, tenantId, status: 'IMAGE_PENDING', version: frozen.version },
            data: {
              imagePlan: json({ candidates: frozen.candidates }),
              validationIssues: json(frozen.issues),
              status: frozen.issues.some(isBlockingIssue) ? 'INVALID' : 'READY',
              version: { increment: 1 },
            },
          })
          if (changed.count !== 1) throw new ProductImportError('ANALYZE_LEASE_LOST', '图片冻结行已被其他请求修改', 409)
        }
        const groups = await tx.productBulkImportRow.groupBy({
          by: ['status'], where: { jobId: job.id, tenantId }, _count: { _all: true },
        })
        const counts = new Map(groups.map((group) => [group.status, group._count._all]))
        const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
        const hasMore = (counts.get('IMAGE_PENDING') ?? 0) > 0
          || !manifest?.sourceComplete
          || total < (manifest?.totalRows ?? job.totalRowCount)
        await tx.productBulkImportJob.update({
          where: { id: job.id },
          data: {
            status: hasMore ? 'ANALYSIS_PENDING' : 'PREVIEW_READY',
            analyzedRowCount: total,
            readyRowCount: counts.get('READY') ?? 0,
            invalidRowCount: counts.get('INVALID') ?? 0,
            analyzedAt: hasMore ? null : new Date(),
          },
        })
      }, { maxWait: 10_000, timeout: 120_000 })
      lease.version += 1
      return getProductImportJob(tenantId, jobId)
    }
    const analyzedCount = await prisma.productBulkImportRow.count({ where: { jobId: job.id, tenantId } })
    let batch: ParsedProductImportRow[] | null = null
    let rebuildArtifacts = !!manifest && !manifest.ready
    let parseNextBatch = !manifest?.ready
    if (manifest?.ready && manifest.sourceFileHash === job.sourceFileHash) {
      try {
        batch = await readParseArtifactBatch(manifest, analyzedCount)
        parseNextBatch = batch.length === 0 && !manifest.sourceComplete
      } catch (error) {
        if (!(error instanceof ProductImportError) || !error.code.startsWith('ANALYSIS_ARTIFACT_')) throw error
        rebuildArtifacts = true
        parseNextBatch = true
      }
    }
    if (parseNextBatch) {
      let parseJob = job
      if (rebuildArtifacts) {
        if (!await deleteParseArtifacts(job)) {
          throw new ProductImportError('ANALYSIS_ARTIFACT_CLEANUP_FAILED', '损坏 Analyze 分片清理失败', 409)
        }
        const lastRow = await prisma.productBulkImportRow.findFirst({
          where: { jobId: job.id, tenantId },
          orderBy: { sourceOrdinal: 'desc' },
          select: { sourceSheetIndex: true, sourceRowNumber: true },
        })
        metadata = {
          ...metadata,
          parseArtifacts: undefined,
          abandonedArtifactKeys: undefined,
          artifactCleanupNotBefore: undefined,
          artifactRebuildCleanupPendingKeys: undefined,
          artifactRebuildCleanupComplete: undefined,
          sourceComplete: false,
          spreadsheetCursor: lastRow?.sourceSheetIndex != null && lastRow.sourceRowNumber != null
            ? { sheetIndex: lastRow.sourceSheetIndex, rowIndex: lastRow.sourceRowNumber }
            : null,
          pdfCursor: analyzedCount,
        }
        parseJob = { ...job, analysisMetadata: JSON.parse(JSON.stringify(metadata)) as Prisma.JsonValue }
        manifest = null
      }
      const source = await downloadObject(PRODUCT_IMPORT_STAGING_BUCKET, job.stagingStorageKey, PRODUCT_IMPORT_MAX_SOURCE_BYTES)
      if (source.length !== job.sourceFileSize) throw new ProductImportError('SOURCE_SIZE_MISMATCH', '上传文件大小与登记值不一致', 409)
      const sourceFileHash = createHash('sha256').update(source).digest('hex')
      if (job.sourceFileHash && job.sourceFileHash !== sourceFileHash) {
        throw new ProductImportError('SOURCE_CHANGED', '同一任务的 staging 原始文件已变化', 409)
      }
      const parsedSource = await parseSource(parseJob, source, analyzedCount, sourceFileHash)
      if (parsedSource.parsed.rows.length === 0 && parsedSource.metadata.sourceComplete && analyzedCount === 0) {
        const warning = parsedSource.parsed.warnings[0]?.message
        throw new ProductImportError('NO_PRODUCT_ROWS', warning ? `未识别到商品行：${warning}` : '未识别到商品行')
      }
      const blockingWarning = parsedSource.parsed.warnings.find(isBlockingIssue)
      if (blockingWarning) throw new ProductImportError(blockingWarning.code, blockingWarning.message, 409)
      const persistJob = rebuildArtifacts ? parseJob : job
      const persisted = await persistParseArtifacts(persistJob, sourceFileHash, parsedSource.parsed, parsedSource.metadata, lease)
      manifest = persisted.manifest
      metadata = persisted.metadata
      batch = await readParseArtifactBatch(manifest, analyzedCount)
    }
    if (!manifest || !batch) {
      throw new ProductImportError('ANALYSIS_ARTIFACT_INVALID', 'Analyze 分片未就绪', 409)
    }
    const sourceFileHash = manifest.sourceFileHash
    const categories = await prisma.productCategory.findMany({
      where: { tenantId },
      select: { id: true, name: true, parentId: true },
    })
    const unresolvedForAi: Array<{ rowIdentity: string; name: string; category1: string | null; category2: string | null }> = []
    for (const row of batch) {
      const resolution = resolveExistingCategory(categories, row.product.category1, row.product.category2)
      if (resolution.status === 'NOT_FOUND' || resolution.status === 'AMBIGUOUS') {
        unresolvedForAi.push({ rowIdentity: row.stableSourceRowIdentity, name: row.product.name, category1: row.product.category1, category2: row.product.category2 })
      }
    }
    const categorySuggestions = new Map<string, unknown>()
    if (unresolvedForAi.length > 0) {
      try {
        const ai = createProductImportAiProvider()
        for (const suggestion of await ai.suggestCategories({ rows: unresolvedForAi, categories })) {
          categorySuggestions.set(suggestion.rowIdentity, suggestion)
        }
      } catch (error) {
        metadata.categorySuggestionError = error instanceof Error ? error.message : 'AI_CATEGORY_FAILED'
      }
    }

    const finalCounts = await prisma.$transaction(async (tx) => {
      const leaseClaim = await tx.productBulkImportJob.updateMany({
        where: { id: job.id, tenantId, status: 'ANALYZING', version: lease.version },
        data: { version: { increment: 1 } },
      })
      if (leaseClaim.count !== 1) throw new ProductImportError('ANALYZE_LEASE_LOST', 'Analyze 已被取消或被其他请求接管', 409)
      for (const row of batch) {
        const assignedBarcode = row.product.barcode?.trim()
          || await allocateGeneratedBarcode(tx, tenantId, sourceFileHash, row.stableSourceRowIdentity)
        const barcodeOrigin = row.product.barcode?.trim() ? 'SOURCE' : 'GENERATED'
        const existingProduct = await tx.product.findUnique({
          where: { tenantId_barcode: { tenantId, barcode: assignedBarcode } },
          select: { id: true },
        })
        const category = resolveExistingCategory(categories, row.product.category1, row.product.category2)
        const issues = categoryIssues(row, category)
        const previousDuplicate = await tx.productBulkImportRow.findFirst({
          where: { jobId: job.id, tenantId, assignedBarcode },
          orderBy: { sourceOrdinal: 'asc' },
          select: { id: true, sourceOrdinal: true, validationIssues: true },
        })
        if (previousDuplicate) {
          const duplicateIssue: ProductImportIssue = {
            code: 'DUPLICATE_BARCODE_IN_FILE',
            field: 'barcode',
            message: `文件内条码 ${assignedBarcode} 重复（至少行 ${previousDuplicate.sourceOrdinal}, ${row.sourceOrdinal}）`,
            blocking: true,
          }
          if (!issues.some((issue) => issue.code === 'DUPLICATE_BARCODE_IN_FILE')) issues.push(duplicateIssue)
          const previousIssues = Array.isArray(previousDuplicate.validationIssues)
            ? previousDuplicate.validationIssues as unknown as ProductImportIssue[]
            : []
          if (!previousIssues.some((issue) => issue.code === 'DUPLICATE_BARCODE_IN_FILE')) {
            await tx.productBulkImportRow.update({
              where: { id: previousDuplicate.id },
              data: { validationIssues: json([...previousIssues, duplicateIssue]), status: 'INVALID', version: { increment: 1 } },
            })
          }
        }
        const preview: ProductImportPreviewPayload = {
          ...row.product,
          barcode: assignedBarcode,
          categoryId: category.status === 'MATCHED' ? category.categoryId : null,
          imageCount: row.images.length,
        }
        const hasUnfrozenExternalImage = row.images.some((candidate) => candidate.kind === 'EXTERNAL_URL' && !candidate.imageHash)
        await tx.productBulkImportRow.create({
          data: {
            jobId: job.id,
            tenantId,
            sourceOrdinal: row.sourceOrdinal,
            sourceSheetIndex: row.coordinate.sheetIndex,
            sourceSheetName: row.coordinate.sheetName,
            sourceRowNumber: row.coordinate.rowNumber,
            sourcePageNumber: row.coordinate.pageNumber,
            stableSourceRowIdentity: row.stableSourceRowIdentity,
            sourcePayload: json(row.sourcePayload),
            previewPayload: json(preview),
            validationIssues: json(issues),
            aiMetadata: json({ ...(row.aiMetadata ?? {}), categorySuggestion: categorySuggestions.get(row.stableSourceRowIdentity) ?? null }),
            assignedBarcode,
            barcodeOrigin,
            action: existingProduct ? 'UPDATE' : 'CREATE',
            imagePlan: json({ candidates: row.images }),
            status: hasUnfrozenExternalImage ? 'IMAGE_PENDING' : issues.some(isBlockingIssue) ? 'INVALID' : 'READY',
          },
        })
      }
      const groups = await tx.productBulkImportRow.groupBy({
        by: ['status'],
        where: { jobId: job.id, tenantId },
        _count: { _all: true },
      })
      const countMap = new Map(groups.map((group) => [group.status, group._count._all]))
      const total = [...countMap.values()].reduce((sum, count) => sum + count, 0)
      const hasMore = !manifest.sourceComplete || total < manifest.totalRows || (countMap.get('IMAGE_PENDING') ?? 0) > 0
      await tx.productBulkImportJob.update({
        where: { id: job.id },
        data: {
          status: hasMore ? 'ANALYSIS_PENDING' : 'PREVIEW_READY',
          analyzedRowCount: total,
          readyRowCount: countMap.get('READY') ?? 0,
          invalidRowCount: countMap.get('INVALID') ?? 0,
          analysisMetadata: json(metadata),
          analyzedAt: hasMore ? null : new Date(),
        },
      })
      return { total, hasMore }
    }, { maxWait: 10_000, timeout: 120_000 })
    lease.version += 1
    if (finalCounts.total > manifest.totalRows) throw new ProductImportError('ANALYSIS_ROW_COUNT_INVALID', 'Analyze 行数超过分片清单', 409)
    return getProductImportJob(tenantId, jobId)
  } catch (error) {
    const code = error instanceof ProductImportError ? error.code : error instanceof Error ? error.message.split(':')[0] : 'ANALYZE_FAILED'
    await prisma.productBulkImportJob.updateMany({
      where: { id: job.id, tenantId, status: 'ANALYZING', version: lease.version },
      data: {
        status: 'FAILED',
        lastErrorCode: code.slice(0, 64),
        lastErrorMessage: error instanceof Error ? error.message.slice(0, 2_000) : 'ANALYZE_FAILED',
        version: { increment: 1 },
      },
    }).catch(() => undefined)
    throw error
  }
}

async function productImportRowCounts(jobId: string, tenantId: string) {
  const groups = await prisma.productBulkImportRow.groupBy({
    by: ['status'],
    where: { jobId, tenantId },
    _count: { _all: true },
  })
  const counts = new Map(groups.map((group) => [group.status, group._count._all]))
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  return {
    total,
    ready: counts.get('READY') ?? 0,
    invalid: counts.get('INVALID') ?? 0,
    confirmed: counts.get('CONFIRMED') ?? 0,
    failed: (counts.get('FAILED') ?? 0) + (counts.get('COMPENSATION_REQUIRED') ?? 0),
    imagePending: counts.get('IMAGE_PENDING') ?? 0,
  }
}

export async function getProductImportJob(tenantId: string, jobId: string, options: { cursor?: number; limit?: number } = {}) {
  const job = await tenantJob(tenantId, jobId)
  const limit = Number.isInteger(options.limit) ? Math.max(1, Math.min(200, options.limit!)) : 100
  const cursor = Number.isInteger(options.cursor) ? Math.max(0, options.cursor!) : 0
  const fetchedRows = await prisma.productBulkImportRow.findMany({
    where: { jobId, tenantId, sourceOrdinal: { gt: cursor } },
    orderBy: { sourceOrdinal: 'asc' },
    take: limit + 1,
    select: {
      id: true,
      sourceOrdinal: true,
      sourceSheetName: true,
      sourceRowNumber: true,
      sourcePageNumber: true,
      stableSourceRowIdentity: true,
      previewPayload: true,
      validationIssues: true,
      aiMetadata: true,
      assignedBarcode: true,
      barcodeOrigin: true,
      action: true,
      imagePlan: true,
      imageResult: true,
      status: true,
      version: true,
      attemptCount: true,
      lastErrorCode: true,
      lastErrorMessage: true,
    },
  })
  const hasNextPage = fetchedRows.length > limit
  const rows = fetchedRows.slice(0, limit)
  const counts = await productImportRowCounts(jobId, tenantId)
  return {
    job: {
      id: job.id,
      fileName: job.sourceFileName,
      sourceFileSize: job.sourceFileSize,
      sourceMimeType: job.sourceMimeType,
      format: job.sourceFormat,
      status: job.status,
      version: job.version,
      totalRowCount: job.totalRowCount,
      analyzedRowCount: job.analyzedRowCount,
      readyRowCount: counts.ready,
      invalidRowCount: counts.invalid,
      confirmedRowCount: counts.confirmed,
      failedRowCount: counts.failed,
      lastErrorCode: job.lastErrorCode,
      lastErrorMessage: job.lastErrorMessage,
      resultSummary: job.resultSummary,
      analysisWarnings: (record(job.analysisMetadata) as SavedAnalysis).parseWarnings ?? [],
      expiresAt: job.expiresAt,
    },
    rows,
    nextCursor: hasNextPage ? rows[rows.length - 1].sourceOrdinal : null,
    hasMoreAnalysis: counts.total < job.totalRowCount
      || ['ANALYZING', 'ANALYSIS_PENDING'].includes(job.status)
      || (job.status === 'FAILED' && counts.failed === 0),
  }
}

export async function getProductImportImagePreview(
  tenantId: string,
  jobId: string,
  rowId: string,
  slot: number,
) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= 3) {
    throw new ProductImportError('INVALID_IMAGE_SLOT', '图片候选位置无效', 400)
  }
  const job = await tenantJob(tenantId, jobId)
  if (job.expiresAt <= new Date()) throw new ProductImportError('JOB_EXPIRED', '导入任务已过期', 410)
  const row = await prisma.productBulkImportRow.findFirst({
    where: { id: rowId, jobId, tenantId },
    select: { imagePlan: true },
  })
  if (!row) throw new ProductImportError('ROW_NOT_FOUND', '导入行不存在', 404)
  const candidates = record(row.imagePlan).candidates
  if (!Array.isArray(candidates)) throw new ProductImportError('IMAGE_PREVIEW_NOT_FOUND', '没有图片候选', 404)
  const rawCandidate = candidates[slot]
  if (!rawCandidate || typeof rawCandidate !== 'object') {
    throw new ProductImportError('IMAGE_PREVIEW_NOT_FOUND', '没有图片候选', 404)
  }
  const candidate = rawCandidate as ProductImportImageCandidate
  if (!['XLSX_EMBEDDED', 'EXTERNAL_URL', 'PDF_CANDIDATE'].includes(candidate.kind) || typeof candidate.source !== 'string') {
    throw new ProductImportError('IMAGE_PREVIEW_INVALID', '图片候选无效', 409)
  }
  if (candidate.kind === 'PDF_CANDIDATE') {
    throw new ProductImportError('PDF_IMAGE_REQUIRES_CONFIRMATION', 'PDF V0.1 只有相邻图片描述候选，不能生成可靠预览图', 409)
  }
  let entries
  if (candidate.kind === 'XLSX_EMBEDDED') {
    const source = await downloadObject(PRODUCT_IMPORT_STAGING_BUCKET, job.stagingStorageKey, PRODUCT_IMPORT_MAX_SOURCE_BYTES)
    if (source.length !== job.sourceFileSize || !job.sourceFileHash || createHash('sha256').update(source).digest('hex') !== job.sourceFileHash) {
      throw new ProductImportError('SOURCE_CHANGED', 'Preview 时原始 staging 文件发生变化', 409)
    }
    entries = unzipOfficeEntries(source)
  }
  try {
    const normalized = await materializeImportImage(candidate, entries)
    if (candidate.kind === 'EXTERNAL_URL' && (!candidate.imageHash || candidate.imageHash !== normalized.imageHash)) {
      throw new ProductImportError('EXTERNAL_IMAGE_CHANGED', '外链图片在 Analyze 后发生变化，已停止预览与导入', 409)
    }
    return normalized
  } catch (error) {
    if (error instanceof ProductImportError) throw error
    throw new ProductImportError(
      'IMAGE_PREVIEW_FAILED',
      error instanceof Error ? error.message.slice(0, 300) : '图片候选预览失败',
      409,
    )
  }
}

export async function listProductImportJobs(tenantId: string) {
  return prisma.productBulkImportJob.findMany({
    where: {
      tenantId,
      sourceFormat: { in: ['XLSX', 'CSV', 'PDF'] },
      status: { notIn: ['CANCELLED', 'EXPIRED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      sourceFileName: true,
      sourceFormat: true,
      status: true,
      totalRowCount: true,
      analyzedRowCount: true,
      readyRowCount: true,
      invalidRowCount: true,
      confirmedRowCount: true,
      failedRowCount: true,
      expiresAt: true,
      updatedAt: true,
    },
  })
}

export type ProductImportRowPatch = {
  version?: number
  name?: string
  nameZh?: string | null
  nameEn?: string | null
  nameKm?: string | null
  descZh?: string | null
  descEn?: string | null
  descKm?: string | null
  spec?: string | null
  sellPrice?: number
  status?: 'ACTIVE' | 'DISABLED'
  category1?: string | null
  category2?: string | null
  categoryId?: string | null
  discardImages?: boolean
}

function assertValidRowPatch(patch: ProductImportRowPatch) {
  const allowed = new Set([
    'version', 'name', 'nameZh', 'nameEn', 'nameKm', 'descZh', 'descEn', 'descKm',
    'spec', 'sellPrice', 'status', 'category1', 'category2', 'categoryId', 'discardImages',
  ])
  for (const key of Object.keys(patch)) {
    if (!allowed.has(key)) throw new ProductImportError('INVALID_ROW_PATCH', `不支持的 Preview 字段：${key}`, 400)
  }
  if (patch.version != null && (!Number.isInteger(patch.version) || patch.version < 0)) {
    throw new ProductImportError('INVALID_ROW_PATCH', 'Preview version 无效', 400)
  }
  const requiredStrings = ['name'] as const
  for (const key of requiredStrings) {
    if (key in patch && typeof patch[key] !== 'string') throw new ProductImportError('INVALID_ROW_PATCH', `${key} 类型无效`, 400)
  }
  const nullableStrings = ['nameZh', 'nameEn', 'nameKm', 'descZh', 'descEn', 'descKm', 'spec', 'category1', 'category2', 'categoryId'] as const
  for (const key of nullableStrings) {
    if (key in patch && patch[key] !== null && typeof patch[key] !== 'string') {
      throw new ProductImportError('INVALID_ROW_PATCH', `${key} 类型无效`, 400)
    }
  }
  if ('sellPrice' in patch && (typeof patch.sellPrice !== 'number' || !Number.isFinite(patch.sellPrice))) {
    throw new ProductImportError('INVALID_ROW_PATCH', 'sellPrice 类型无效', 400)
  }
  if ('status' in patch && patch.status !== 'ACTIVE' && patch.status !== 'DISABLED') {
    throw new ProductImportError('INVALID_ROW_PATCH', 'status 只能是 ACTIVE 或 DISABLED', 400)
  }
  if ('discardImages' in patch && typeof patch.discardImages !== 'boolean') {
    throw new ProductImportError('INVALID_ROW_PATCH', 'discardImages 类型无效', 400)
  }
}

export async function patchProductImportRow(tenantId: string, jobId: string, rowId: string, patch: ProductImportRowPatch) {
  assertValidRowPatch(patch)
  const job = await tenantJob(tenantId, jobId)
  if (job.status !== 'PREVIEW_READY') {
    throw new ProductImportError('JOB_NOT_EDITABLE', '只有 Preview 就绪的任务可以编辑', 409)
  }
  if (job.expiresAt <= new Date()) throw new ProductImportError('JOB_EXPIRED', '导入任务已过期', 410)
  const row = await prisma.productBulkImportRow.findFirst({ where: { id: rowId, jobId, tenantId } })
  if (!row) throw new ProductImportError('ROW_NOT_FOUND', '导入行不存在', 404)
  if (!['READY', 'INVALID'].includes(row.status)) throw new ProductImportError('ROW_NOT_EDITABLE', '该行当前状态不可编辑；失败行必须先完成清理重试', 409)
  if (patch.version != null && patch.version !== row.version) throw new ProductImportError('ROW_VERSION_CONFLICT', '该行已被其他请求修改', 409)
  const preview = { ...record(row.previewPayload) } as ProductImportPreviewPayload
  const editable = ['name', 'nameZh', 'nameEn', 'nameKm', 'descZh', 'descEn', 'descKm', 'spec', 'sellPrice', 'status', 'category1', 'category2'] as const
  for (const key of editable) {
    if (key in patch) (preview as unknown as Record<string, unknown>)[key] = patch[key]
  }
  let issues = Array.isArray(row.validationIssues) ? row.validationIssues as ProductImportIssue[] : []
  issues = issues.filter((issue) => !['MISSING_NAME', 'INVALID_PRICE', 'CATEGORY_NOT_FOUND', 'CATEGORY_AMBIGUOUS'].includes(issue.code))
  if (typeof preview.name !== 'string' || !preview.name.trim()) {
    issues.push({ code: 'MISSING_NAME', field: 'name', message: '商品名不能为空', blocking: true })
  } else preview.name = preview.name.trim()
  if (typeof preview.sellPrice !== 'number' || !Number.isFinite(preview.sellPrice) || preview.sellPrice <= 0) {
    issues.push({ code: 'INVALID_PRICE', field: 'sellPrice', message: '售价无效', blocking: true })
  } else preview.sellPrice = Math.round(preview.sellPrice * 100) / 100

  if ('categoryId' in patch) {
    if (patch.categoryId) {
      const category = await prisma.productCategory.findFirst({ where: { id: patch.categoryId, tenantId }, select: { id: true } })
      if (!category) throw new ProductImportError('CATEGORY_NOT_FOUND', '分类不属于当前租户', 400)
      preview.categoryId = category.id
    } else {
      preview.categoryId = null
      preview.category1 = null
      preview.category2 = null
    }
  } else if ('category1' in patch || 'category2' in patch) {
    const categories = await prisma.productCategory.findMany({ where: { tenantId }, select: { id: true, name: true, parentId: true } })
    const resolved = resolveExistingCategory(categories, preview.category1, preview.category2)
    preview.categoryId = resolved.status === 'MATCHED' ? resolved.categoryId : null
    if (resolved.status === 'NOT_FOUND') issues.push({ code: 'CATEGORY_NOT_FOUND', field: 'categoryId', message: '未找到现有分类，请选择已有分类', blocking: true })
    if (resolved.status === 'AMBIGUOUS') issues.push({ code: 'CATEGORY_AMBIGUOUS', field: 'categoryId', message: '分类名称不唯一，请选择具体分类', blocking: true })
  } else if (preview.categoryId) {
    const category = await prisma.productCategory.findFirst({ where: { id: preview.categoryId, tenantId }, select: { id: true } })
    if (!category) {
      preview.categoryId = null
      issues.push({ code: 'CATEGORY_NOT_FOUND', field: 'categoryId', message: '已选分类不存在，请重新选择已有分类', blocking: true })
    }
  } else if (preview.category1?.trim()) {
    const categories = await prisma.productCategory.findMany({ where: { tenantId }, select: { id: true, name: true, parentId: true } })
    const resolved = resolveExistingCategory(categories, preview.category1, preview.category2)
    preview.categoryId = resolved.status === 'MATCHED' ? resolved.categoryId : null
    if (resolved.status === 'NOT_FOUND') issues.push({ code: 'CATEGORY_NOT_FOUND', field: 'categoryId', message: '未找到现有分类，请选择已有分类', blocking: true })
    if (resolved.status === 'AMBIGUOUS') issues.push({ code: 'CATEGORY_AMBIGUOUS', field: 'categoryId', message: '分类名称不唯一，请选择具体分类', blocking: true })
  }
  let imagePlan: Prisma.InputJsonValue = json(row.imagePlan ?? { candidates: [] })
  if (patch.discardImages) {
    imagePlan = json({ candidates: [] })
    preview.imageCount = 0
    issues = issues.filter((issue) => ![
      'PDF_IMAGE_REQUIRES_CONFIRMATION', 'UNSUPPORTED_IMAGE_FORMAT', 'TOO_MANY_IMAGES', 'IMAGE_FETCH_FAILED',
    ].includes(issue.code))
  }
  const status = issues.some(isBlockingIssue) ? 'INVALID' : 'READY'
  return prisma.$transaction(async (tx) => {
    const jobClaim = await tx.productBulkImportJob.updateMany({
      where: { id: jobId, tenantId, status: 'PREVIEW_READY', version: job.version },
      data: { version: { increment: 1 } },
    })
    if (jobClaim.count !== 1) throw new ProductImportError('JOB_VERSION_CONFLICT', '任务状态已被其他请求修改', 409)
    const changed = await tx.productBulkImportRow.updateMany({
      where: { id: row.id, tenantId, jobId, version: row.version, status: { in: ['READY', 'INVALID'] } },
      data: { previewPayload: json(preview), validationIssues: json(issues), imagePlan, status, version: { increment: 1 }, lastErrorCode: null, lastErrorMessage: null },
    })
    if (changed.count !== 1) throw new ProductImportError('ROW_VERSION_CONFLICT', '该行已被其他请求修改', 409)
    const groups = await tx.productBulkImportRow.groupBy({
      by: ['status'], where: { jobId, tenantId }, _count: { _all: true },
    })
    const counts = new Map(groups.map((group) => [group.status, group._count._all]))
    await tx.productBulkImportJob.update({
      where: { id: jobId },
      data: { readyRowCount: counts.get('READY') ?? 0, invalidRowCount: counts.get('INVALID') ?? 0 },
    })
    return tx.productBulkImportRow.findUniqueOrThrow({ where: { id: row.id } })
  })
}

export async function cancelProductImportJob(tenantId: string, jobId: string) {
  const job = await tenantJob(tenantId, jobId)
  if (job.status === 'COMPLETED') throw new ProductImportError('JOB_ALREADY_COMPLETED', '已完成任务不能取消', 409)
  if (job.status === 'EXPIRED') throw new ProductImportError('JOB_NOT_CANCELLABLE', '已过期任务由清理任务处理', 409)
  if (job.status !== 'CANCELLED') {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.productBulkImportJob.updateMany({
        where: { id: jobId, tenantId, status: job.status, version: job.version },
        data: { status: 'CANCELLED', completedAt: new Date(), version: { increment: 1 } },
      })
      if (claimed.count !== 1) throw new ProductImportError('JOB_VERSION_CONFLICT', '任务状态已被其他请求修改，请重试取消', 409)
      await tx.productBulkImportRow.updateMany({
        where: { jobId, tenantId, status: { not: 'CONFIRMED' } },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      })
    })
  }
  const rows = await prisma.productBulkImportRow.findMany({
    where: { jobId, tenantId, status: 'CANCELLED', imageResult: { not: Prisma.DbNull } },
    orderBy: { sourceOrdinal: 'asc' },
    take: PRODUCT_IMPORT_CONFIRM_BATCH_SIZE,
    select: { id: true, version: true, imageResult: true },
  })
  await Promise.all(rows.map(async (row) => {
    const result = record(row.imageResult) as ProductImportImageResult
    const keys = [...new Set([...(result.compensationPendingKeys ?? []), ...(result.uploadIntentKeys ?? [])])]
    await deleteStorageKeys('product-images', keys)
    if (keys.length > 0) {
      await prisma.productBulkImportRow.updateMany({
        where: { id: row.id, jobId, tenantId, status: 'CANCELLED', version: row.version },
        data: {
          // Preserve a tombstone until all possibly in-flight PUTs have aged
          // beyond the route lifetime, then retry the DELETE idempotently.
          status: 'COMPENSATION_REQUIRED',
          imageResult: json({
            ...result,
            uploadIntentKeys: [],
            uploadedKeys: [...new Set([...(result.uploadedKeys ?? []), ...keys])],
            compensationPendingKeys: keys,
            cleanupAttempts: (result.cleanupAttempts ?? 0) + 1,
          }),
          lastErrorCode: 'CANCEL_UPLOAD_QUIESCENCE_REQUIRED',
          lastErrorMessage: 'Cancelled upload intents await the request quiescence window',
        },
      })
    }
  }))
  const remainingImageRows = await prisma.productBulkImportRow.count({
    where: {
      jobId,
      tenantId,
      OR: [
        { status: 'COMPENSATION_REQUIRED' },
        { status: 'CANCELLED', imageResult: { not: Prisma.DbNull } },
      ],
    },
  })
  const pendingImages = remainingImageRows
  const cancelledJob = await tenantJob(tenantId, jobId)
  const removed = await cleanupProductImportStaging(cancelledJob)
  const cleanupPending = remainingImageRows > 0 || !removed
  await prisma.productBulkImportJob.updateMany({
    where: { id: jobId, tenantId, status: 'CANCELLED' },
    data: {
      status: cleanupPending ? 'COMPENSATION_REQUIRED' : 'CANCELLED',
      // Keep this null until the expiry sweep reaps any upload arriving late
      // through a previously issued short-lived signed URL.
      stagingCleanedAt: null,
      lastErrorCode: cleanupPending ? 'CANCEL_COMPENSATION_REQUIRED' : null,
      lastErrorMessage: cleanupPending ? 'Cancelled import cleanup still pending' : null,
    },
  })
  const finalJob = await tenantJob(tenantId, jobId)
  return { ok: finalJob.status === 'CANCELLED', status: finalJob.status, stagingCleaned: removed, pendingImages }
}

export async function cleanupExpiredProductImportJobs(limit = 4) {
  const staleJobBefore = new Date(Date.now() - 10 * 60 * 1000)
  const jobs = await prisma.productBulkImportJob.findMany({
    where: {
      expiresAt: { lte: new Date() },
      updatedAt: { lt: staleJobBefore },
      status: { in: [
        'AWAITING_UPLOAD', 'UPLOAD_SIGNING', 'ANALYZING', 'ANALYSIS_PENDING',
        'CONFIRMING', 'CONFIRMING_ACTIVE', 'RETRYING_ACTIVE', 'CLEANUP_ACTIVE',
        'FAILED', 'COMPENSATION_REQUIRED', 'PREVIEW_READY', 'COMPLETED', 'CANCELLED', 'EXPIRED',
      ] },
      OR: [
        { stagingCleanedAt: null },
        { rows: { some: { OR: [
          { status: 'COMPENSATION_REQUIRED', imageResult: { not: Prisma.DbNull } },
          { status: 'CONFIRMING', updatedAt: { lt: staleJobBefore }, imageResult: { not: Prisma.DbNull } },
          { status: { in: ['CANCELLED', 'FAILED', 'RETRYING'] }, imageResult: { not: Prisma.DbNull } },
          { status: 'CLEANUP_ACTIVE', updatedAt: { lt: staleJobBefore }, imageResult: { not: Prisma.DbNull } },
          { status: 'CONFIRMED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
        ] } } },
      ],
    },
    // Failed cleanup attempts update updatedAt, rotating poison jobs behind
    // older untouched work instead of starving every later expired job.
    orderBy: [{ updatedAt: 'asc' }, { expiresAt: 'asc' }],
    take: Math.max(1, Math.min(4, limit)),
  })
  let cleaned = 0
  let failed = 0
  for (const job of jobs) {
    const savedAnalysis = record(job.analysisMetadata)
    const savedCleanupStatus = savedAnalysis.cleanupPreviousStatus
    const cleanupPreviousStatus = savedCleanupStatus === 'COMPLETED' || savedCleanupStatus === 'CANCELLED'
      ? savedCleanupStatus
      : job.status
    const jobClaim = await prisma.productBulkImportJob.updateMany({
      where: {
        id: job.id,
        tenantId: job.tenantId,
        status: job.status,
        version: job.version,
        expiresAt: { lte: new Date() },
        updatedAt: { lt: staleJobBefore },
      },
      data: {
        status: 'CLEANUP_ACTIVE',
        analysisMetadata: json({ ...savedAnalysis, cleanupPreviousStatus }),
        cleanupAttemptCount: { increment: 1 },
        version: { increment: 1 },
      },
    })
    if (jobClaim.count !== 1) continue
    const leaseVersion = job.version + 1
    let imageCleanupFailed = false
    const staleConfirmingBefore = new Date(Date.now() - 10 * 60 * 1000)
    const rows = await prisma.productBulkImportRow.findMany({
      where: {
        jobId: job.id,
        tenantId: job.tenantId,
        OR: [
          { status: 'COMPENSATION_REQUIRED', imageResult: { not: Prisma.DbNull } },
          { status: 'CONFIRMING', updatedAt: { lt: staleConfirmingBefore }, imageResult: { not: Prisma.DbNull } },
          { status: { in: ['CANCELLED', 'FAILED', 'RETRYING'] }, imageResult: { not: Prisma.DbNull } },
          { status: 'CLEANUP_ACTIVE', updatedAt: { lt: staleConfirmingBefore }, imageResult: { not: Prisma.DbNull } },
          { lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
        ],
      },
      orderBy: { sourceOrdinal: 'asc' },
      take: PRODUCT_IMPORT_CONFIRM_BATCH_SIZE,
      select: { id: true, status: true, version: true, imageResult: true },
    })
    const rowCleanupResults = await Promise.all(rows.map(async (row) => {
      const result = record(row.imageResult) as ProductImportImageResult
      if (row.status !== 'CONFIRMED') {
        const rowClaim = await prisma.productBulkImportRow.updateMany({
          where: { id: row.id, jobId: job.id, tenantId: job.tenantId, status: row.status, version: row.version },
          data: { status: 'CLEANUP_ACTIVE', version: { increment: 1 } },
        })
        if (rowClaim.count !== 1) return false
      }
      const keys = row.status === 'CONFIRMED'
        ? result.oldKeysPendingCleanup ?? []
        : [...new Set([...(result.compensationPendingKeys ?? []), ...(result.uploadIntentKeys ?? [])])]
      const remaining = await deleteStorageKeys('product-images', keys)
      await prisma.productBulkImportRow.updateMany({
        where: row.status === 'CONFIRMED'
          ? { id: row.id, jobId: job.id, tenantId: job.tenantId, status: 'CONFIRMED', version: row.version }
          : { id: row.id, jobId: job.id, tenantId: job.tenantId, status: 'CLEANUP_ACTIVE', version: row.version + 1 },
        data: row.status === 'CONFIRMED' ? {
          imageResult: json({ ...result, oldKeysPendingCleanup: remaining, cleanupAttempts: (result.cleanupAttempts ?? 0) + 1 }),
          lastErrorCode: remaining.length ? 'OLD_IMAGE_CLEANUP_PENDING' : null,
          lastErrorMessage: remaining.length ? '商品已提交；旧图片等待后台清理' : null,
        } : {
          status: remaining.length ? 'COMPENSATION_REQUIRED' : 'CANCELLED',
          imageResult: remaining.length
            ? json({ ...result, uploadIntentKeys: [], compensationPendingKeys: remaining, cleanupAttempts: (result.cleanupAttempts ?? 0) + 1 })
            : Prisma.DbNull,
          lastErrorCode: remaining.length ? 'STORAGE_COMPENSATION_REQUIRED' : null,
          lastErrorMessage: remaining.length ? 'Storage compensation still pending' : null,
        },
      })
      return remaining.length > 0
    }))
    imageCleanupFailed ||= rowCleanupResults.some(Boolean)
    const pendingCleanupRows = await prisma.productBulkImportRow.count({
      where: {
        jobId: job.id,
        tenantId: job.tenantId,
        OR: [
          { status: 'COMPENSATION_REQUIRED', imageResult: { not: Prisma.DbNull } },
          { status: { in: ['CONFIRMING', 'RETRYING', 'CLEANUP_ACTIVE', 'CANCELLED', 'FAILED'] }, imageResult: { not: Prisma.DbNull } },
          { status: 'CONFIRMED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
        ],
      },
    })
    imageCleanupFailed ||= pendingCleanupRows > 0
    const cleanupJob: ProductBulkImportJob = {
      ...job,
      status: 'CLEANUP_ACTIVE',
      version: leaseVersion,
      analysisMetadata: JSON.parse(JSON.stringify({ ...savedAnalysis, cleanupPreviousStatus })) as Prisma.JsonValue,
    }
    // At most one 100-key Storage batch per job keeps four sequential jobs
    // inside the 300-second cron budget even when every Storage call times out.
    const removed = job.stagingCleanedAt != null || await cleanupProductImportStaging(cleanupJob, { maxBatches: 1, restart: true })
    const postCleanupJob = await tenantJob(job.tenantId, job.id)
    const postCleanupMetadata = record(postCleanupJob.analysisMetadata)
    const finalized = await prisma.productBulkImportJob.updateMany({
      where: { id: job.id, tenantId: job.tenantId, status: 'CLEANUP_ACTIVE', version: leaseVersion },
      data: {
        status: cleanupPreviousStatus === 'COMPLETED' || cleanupPreviousStatus === 'CANCELLED' ? cleanupPreviousStatus : 'EXPIRED',
        analysisMetadata: json({ ...postCleanupMetadata, cleanupPreviousStatus: undefined }),
        stagingCleanedAt: removed ? new Date() : null,
        ...(!removed ? { lastErrorCode: 'STAGING_CLEANUP_FAILED', lastErrorMessage: 'staging object delete failed' }
          : imageCleanupFailed ? { lastErrorCode: 'STORAGE_COMPENSATION_REQUIRED', lastErrorMessage: 'image cleanup still pending' }
            : { lastErrorCode: null, lastErrorMessage: null }),
      },
    })
    if (finalized.count === 1 && removed && !imageCleanupFailed) cleaned += 1
    else failed += 1
  }
  return { scanned: jobs.length, cleaned, failed }
}

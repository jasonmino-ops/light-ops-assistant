import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { strToU8, unzipSync, zipSync } from 'fflate'
import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import {
  analyzeProductImportJob,
  cancelProductImportJob,
  cleanupExpiredProductImportJobs,
  createProductImportJob,
  getProductImportJob,
  patchProductImportRow,
  ProductImportError,
  resignProductImportUpload,
} from '../lib/product-bulk-import/jobs'
import { confirmProductImportJob, retryProductImportJob } from '../lib/product-bulk-import/confirm'
import { GET as legacyTemplate, POST as legacyPreview } from '../app/api/products/import/route'
import type { PreviewRow } from '../app/api/products/import/route'
import { POST as legacyConfirm } from '../app/api/products/import/confirm/route'
import { POST as recognizeMenu } from '../app/api/products/import-ai/recognize/route'
import { POST as uploadSingleProductImage } from '../app/api/products/[id]/image/route'
import { PATCH as patchJobRoute } from '../app/api/products/import/jobs/[id]/route'
import { GET as imagePreviewRoute } from '../app/api/products/import/jobs/[id]/rows/[rowId]/images/[slot]/route'
import { internalEan13Candidate, stableRowIdentity } from '../lib/product-bulk-import/barcode'
import { createSignedUploadUrl, ensurePrivateBucket } from '../lib/supabase-storage'

if (process.env.PRODUCT_BULK_IMPORT_TEST_DATABASE !== '1' || !process.env.DATABASE_URL?.includes('127.0.0.1')) {
  throw new Error('PRODUCT_BULK_IMPORT_TEST_DATABASE=1 with an isolated localhost DATABASE_URL is required')
}

process.env.SUPABASE_URL = 'https://storage.test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test'
process.env.ANTHROPIC_API_KEY = 'anthropic-test'

const tenantId = 'tenant-product-bulk-import-test'
const staged = new Map<string, Buffer>()
const stagingGetCounts = new Map<string, number>()
const productImages = new Map<string, Buffer>()
const deletedKeys: string[] = []
let failProductImageDelete = false
let loseProductImageUploadResponse = false
let replacementObservedKey: string | null = null
let stagingMimeTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'application/pdf']
let stagingBucketUpgraded = false
let failNextStagingGet = false
let loseNextStagingArtifactUploadResponse = false
let lostStagingArtifactKey: string | null = null
let failStagingBulkDeletePrefix: string | null = null
let reverseMenuAiItems = false
let menuAiCallCount = 0
let reversePdfAiBlocks = false
let pdfAiCallCount = 0
const defaultSpreadsheetMappings = [{ sheetIndex: 0, selected: true, headerRowNumber: 1, mapping: { nameZh: 0, sellPrice: 1 } }]
let spreadsheetMappings: unknown = defaultSpreadsheetMappings

const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  const method = (init.method ?? 'GET').toUpperCase()
  if (url === 'https://api.anthropic.com/v1/messages' && method === 'POST') {
    const requestBody = JSON.parse(String(init.body)) as { messages?: Array<{ content?: Array<{ type?: string; text?: string }> }> }
    const prompt = requestBody.messages?.[0]?.content?.find((part) => part.type === 'text')?.text ?? ''
    if (prompt.includes('商品导入字段映射器')) {
      return Response.json({ content: [{ type: 'text', text: JSON.stringify(spreadsheetMappings) }] })
    }
    if (prompt.includes('识别 PDF 中的商品块')) {
      pdfAiCallCount += 1
      const pdfBlocks = [
        { pageNumber: 1, sourceBox: [100, 100, 900, 220], name: 'PDF 商品 A', price: 2 },
        { pageNumber: 1, sourceBox: [100, 300, 900, 420], name: 'PDF 商品 B', price: 3 },
      ]
      return Response.json({ content: [{ type: 'text', text: JSON.stringify(reversePdfAiBlocks ? pdfBlocks.reverse() : pdfBlocks) }] })
    }
    menuAiCallCount += 1
    const menuItems = [
      { sourceBox: [100, 100, 450, 240], name: 'AI 菜单商品 A', category: 'AI 猜测的新分类', price: 3.5, currency: 'USD', unit: '份', description: null, confidence: 0.9, warnings: [] },
      { sourceBox: [100, 300, 450, 440], name: 'AI 菜单商品 B', category: null, price: 4.5, currency: 'USD', unit: '份', description: null, confidence: 0.9, warnings: [] },
    ]
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(reverseMenuAiItems ? menuItems.reverse() : menuItems) }] })
  }
  if (url.includes('/storage/v1/bucket/') && method === 'GET') {
    return Response.json({ id: 'product-import-staging', public: false, file_size_limit: 50 * 1024 * 1024, allowed_mime_types: stagingMimeTypes })
  }
  if (url.includes('/storage/v1/bucket/') && method === 'PUT') {
    const body = JSON.parse(String(init.body)) as { id?: string; name?: string; allowed_mime_types?: string[] }
    assert.equal(body.id, 'product-import-staging')
    assert.equal(body.name, 'product-import-staging')
    assert.ok(body.allowed_mime_types?.includes('application/json'))
    stagingMimeTypes = body.allowed_mime_types ?? stagingMimeTypes
    stagingBucketUpgraded = true
    return Response.json({})
  }
  if (url.includes('/storage/v1/object/upload/sign/') && method === 'POST') {
    const path = new URL(url).pathname.replace('/storage/v1', '')
    return Response.json({ url: `${path}?token=signed-test` })
  }
  const stagingPrefix = 'https://storage.test/storage/v1/object/product-import-staging/'
  if (url === 'https://storage.test/storage/v1/object/product-import-staging' && method === 'DELETE') {
    const prefixes = (JSON.parse(String(init.body)) as { prefixes?: string[] }).prefixes ?? []
    if (failStagingBulkDeletePrefix && prefixes.some((key) => key.startsWith(failStagingBulkDeletePrefix!))) {
      return new Response('simulated staging cleanup failure', { status: 500 })
    }
    for (const key of prefixes) {
      staged.delete(key)
      deletedKeys.push(key)
    }
    return new Response('', { status: 200 })
  }
  if (url.startsWith(stagingPrefix) && method === 'GET') {
    if (failNextStagingGet) {
      failNextStagingGet = false
      throw new Error('simulated transient staging read failure')
    }
    const key = decodeURIComponent(url.slice(stagingPrefix.length))
    stagingGetCounts.set(key, (stagingGetCounts.get(key) ?? 0) + 1)
    const value = staged.get(key)
    return value ? new Response(new Uint8Array(value), { status: 200, headers: { 'content-length': String(value.length) } }) : new Response('missing', { status: 404 })
  }
  if (url.startsWith(stagingPrefix) && method === 'POST') {
    const key = decodeURIComponent(url.slice(stagingPrefix.length))
    if (loseNextStagingArtifactUploadResponse && key.includes('/analysis/v1/')) {
      loseNextStagingArtifactUploadResponse = false
      lostStagingArtifactKey = key
      throw new Error('simulated lost staging artifact upload response')
    }
    const body = init.body instanceof Uint8Array ? Buffer.from(init.body) : Buffer.alloc(0)
    staged.set(key, body)
    return new Response('', { status: 200 })
  }
  if (url.startsWith(stagingPrefix) && method === 'DELETE') {
    const key = decodeURIComponent(url.slice(stagingPrefix.length))
    const existed = staged.delete(key)
    deletedKeys.push(key)
    return new Response('', { status: existed ? 200 : 404 })
  }
  const imagePrefix = 'https://storage.test/storage/v1/object/product-images/'
  if (url.startsWith(imagePrefix) && method === 'POST') {
    const key = decodeURIComponent(url.slice(imagePrefix.length))
    const body = init.body instanceof Uint8Array ? Buffer.from(init.body) : Buffer.alloc(0)
    productImages.set(key, body)
    if (loseProductImageUploadResponse) throw new Error('simulated lost upload response')
    return new Response('', { status: 200 })
  }
  if (url.startsWith(imagePrefix) && method === 'DELETE') {
    const key = decodeURIComponent(url.slice(imagePrefix.length))
    deletedKeys.push(key)
    if (key === 'tenants/tenant-product-bulk-import-test/products/existing/old.webp') {
      const product = await prisma.product.findUnique({ where: { tenantId_barcode: { tenantId, barcode: 'EXISTING-IMAGE' } } })
      replacementObservedKey = product?.imageStorageKey ?? null
    }
    if (failProductImageDelete) return new Response('failed', { status: 500 })
    productImages.delete(key)
    return new Response('', { status: 200 })
  }
  throw new Error(`UNEXPECTED_FETCH ${method} ${url}`)
}

function xlsxBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Products')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
}

function ownerRequest(path: string, method: 'GET' | 'POST' | 'PATCH', body?: BodyInit, contentType?: string) {
  const headers: Record<string, string> = {
    'x-tenant-id': tenantId,
    'x-user-id': 'owner-product-import-test',
    'x-store-id': 'store-product-import-test',
    'x-role': 'OWNER',
  }
  if (contentType) headers['content-type'] = contentType
  return new NextRequest(`http://localhost${path}`, { method, headers, body })
}

async function xlsxWithImage(rows: unknown[][]): Promise<Buffer> {
  const files = unzipSync(new Uint8Array(xlsxBuffer(rows)))
  let sheet = Buffer.from(files['xl/worksheets/sheet1.xml']).toString('utf8')
  if (!sheet.includes('xmlns:r=')) sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
  files['xl/worksheets/sheet1.xml'] = strToU8(sheet.replace('</worksheet>', '<drawing r:id="rIdDrawing"/></worksheet>'))
  files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
  files['xl/drawings/drawing1.xml'] = strToU8('<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>4</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor></xdr:wsDr>')
  files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>')
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#0088ff' } }).png().toBuffer()
  files['xl/media/image1.png'] = new Uint8Array(png)
  return Buffer.from(zipSync(files))
}

async function createAndAnalyze(fileName: string, mimeType: string, source: Buffer) {
  const created = await createProductImportJob(tenantId, { fileName, mimeType, fileSize: source.length })
  assert.ok(created.uploadUrl.startsWith('https://storage.test/storage/v1/object/upload/sign/'))
  staged.set(created.storageKey, source)
  let view = await analyzeProductImportJob(tenantId, created.jobId)
  while (view.hasMoreAnalysis) view = await analyzeProductImportJob(tenantId, created.jobId)
  return getProductImportJob(tenantId, created.jobId, { limit: 200 })
}

const bucketContract = {
  fileSizeLimit: 50 * 1024 * 1024,
  allowedMimeTypes: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'application/pdf',
    'application/json',
  ],
}

async function withFetch<T>(fetchImpl: typeof fetch, action: () => Promise<T>): Promise<T> {
  const previousFetch = globalThis.fetch
  globalThis.fetch = fetchImpl
  try {
    return await action()
  } finally {
    globalThis.fetch = previousFetch
  }
}

async function assertMissingBucketCreates(status: 400 | 404) {
  let createCount = 0
  await withFetch(async (input, init = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    if (url.endsWith('/storage/v1/bucket/product-import-staging') && method === 'GET') {
      return Response.json({ code: 'NoSuchBucket', message: 'Bucket not found' }, { status })
    }
    if (url.endsWith('/storage/v1/bucket') && method === 'POST') {
      createCount += 1
      const body = JSON.parse(String(init.body))
      assert.deepEqual(body, {
        id: 'product-import-staging',
        name: 'product-import-staging',
        public: false,
        file_size_limit: bucketContract.fileSizeLimit,
        allowed_mime_types: bucketContract.allowedMimeTypes,
      })
      return Response.json({})
    }
    throw new Error(`UNEXPECTED_BUCKET_FETCH ${method} ${url}`)
  }, () => ensurePrivateBucket('product-import-staging', bucketContract))
  assert.equal(createCount, 1, `${status} NoSuchBucket creates the private staging bucket exactly once`)
}

async function assertBucketReadFailsClosed(status: 400 | 401 | 403 | 404 | 500, body: BodyInit) {
  let createCount = 0
  await assert.rejects(
    () => withFetch(async (input, init = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/storage/v1/bucket/product-import-staging') && method === 'GET') {
        return new Response(body, { status, headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/storage/v1/bucket') && method === 'POST') createCount += 1
      throw new Error(`UNEXPECTED_BUCKET_FETCH ${method} ${url}`)
    }, () => ensurePrivateBucket('product-import-staging', bucketContract)),
    (error: unknown) => error instanceof Error && error.message === `STORAGE_BUCKET_READ_${status}`,
  )
  assert.equal(createCount, 0, `${status} without explicit NoSuchBucket must not create a bucket`)
}

async function verifyBucketInitializationContract() {
  await assertMissingBucketCreates(404)
  await assertMissingBucketCreates(400)

  await assertBucketReadFailsClosed(400, JSON.stringify({ code: 'InvalidRequest', message: 'bad request' }))
  await assertBucketReadFailsClosed(401, JSON.stringify({ code: 'InvalidJWT', message: 'invalid JWT' }))
  await assertBucketReadFailsClosed(403, JSON.stringify({ code: 'AccessDenied', message: 'denied' }))
  await assertBucketReadFailsClosed(401, JSON.stringify({ code: 'NoSuchBucket', message: 'unauthorized' }))
  await assertBucketReadFailsClosed(403, JSON.stringify({ code: 'NoSuchBucket', message: 'forbidden' }))
  await assertBucketReadFailsClosed(500, JSON.stringify({ code: 'NoSuchBucket', message: 'server error' }))
  await assertBucketReadFailsClosed(404, '<not-json>')

  let existingBucketMutationCount = 0
  await withFetch(async (input, init = {}) => {
    const url = String(input)
    const method = (init.method ?? 'GET').toUpperCase()
    if (url.endsWith('/storage/v1/bucket/product-import-staging') && method === 'GET') {
      return Response.json({
        id: 'product-import-staging',
        public: false,
        file_size_limit: bucketContract.fileSizeLimit,
        allowed_mime_types: bucketContract.allowedMimeTypes,
      })
    }
    existingBucketMutationCount += 1
    throw new Error(`UNEXPECTED_BUCKET_FETCH ${method} ${url}`)
  }, () => ensurePrivateBucket('product-import-staging', bucketContract))
  assert.equal(existingBucketMutationCount, 0, 'an existing conforming bucket is not created or updated')

  let signedUploadCount = 0
  await assert.rejects(
    () => withFetch(async (input, init = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      if (url.endsWith('/storage/v1/bucket/product-import-staging') && method === 'GET') {
        return Response.json({ code: 'NoSuchBucket', message: 'Bucket not found' }, { status: 400 })
      }
      if (url.endsWith('/storage/v1/bucket') && method === 'POST') {
        return Response.json({ code: 'InternalError', message: 'create failed' }, { status: 500 })
      }
      if (url.includes('/storage/v1/object/upload/sign/')) signedUploadCount += 1
      throw new Error(`UNEXPECTED_BUCKET_FETCH ${method} ${url}`)
    }, async () => {
      await ensurePrivateBucket('product-import-staging', bucketContract)
      await createSignedUploadUrl('product-import-staging', 'test/source.xlsx')
    }),
    (error: unknown) => error instanceof Error && error.message.startsWith('STORAGE_BUCKET_CREATE_500:'),
  )
  assert.equal(signedUploadCount, 0, 'a failed bucket create cannot continue to signed upload')
}

async function main() {
  await verifyBucketInitializationContract()
  await prisma.product.deleteMany({ where: { tenantId } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.tenant.create({ data: { id: tenantId, name: 'Bulk Import Test' } })
  try {
    const sourceA = Buffer.from('name_zh,sell_price\n稳定商品,5.25\n')
    const first = await createAndAnalyze('stable.csv', 'text/csv', sourceA)
    assert.equal(stagingBucketUpgraded, true, 'existing private staging bucket adds the JSON artifact MIME')
    assert.equal(first.job.status, 'PREVIEW_READY')
    assert.equal(first.rows.length, 1)
    assert.equal(first.rows[0].barcodeOrigin, 'GENERATED')
    const firstBarcode = first.rows[0].assignedBarcode!
    const invalidStatusPatch = await patchJobRoute(
      ownerRequest(
        `/api/products/import/jobs/${first.job.id}`,
        'PATCH',
        JSON.stringify({ rowId: first.rows[0].id, patch: { version: first.rows[0].version, status: 'DELETED' } }),
        'application/json',
      ),
      { params: Promise.resolve({ id: first.job.id }) },
    )
    assert.equal(invalidStatusPatch.status, 400)
    await patchProductImportRow(tenantId, first.job.id, first.rows[0].id, { version: first.rows[0].version, name: 'Preview 修正', nameZh: 'Preview 修正', sellPrice: 6 })
    const afterEdit = await getProductImportJob(tenantId, first.job.id)
    assert.equal(afterEdit.rows[0].assignedBarcode, firstBarcode, 'Preview edits keep the assigned generated barcode')
    await assert.rejects(
      () => patchProductImportRow(tenantId, first.job.id, first.rows[0].id, { version: first.rows[0].version, sellPrice: 7 }),
      (error: unknown) => error instanceof ProductImportError && error.code === 'ROW_VERSION_CONFLICT',
      'stale Preview writes are rejected atomically',
    )

    const multiSheetBook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(multiSheetBook, XLSX.utils.aoa_to_sheet([['name_zh', 'sell_price'], ['A', 1]]), 'A')
    XLSX.utils.book_append_sheet(multiSheetBook, XLSX.utils.aoa_to_sheet([['name_zh', 'sell_price'], ['B', 2]]), 'B')
    const multiSheetSource = Buffer.from(XLSX.write(multiSheetBook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
    const multiSheetJob = await createProductImportJob(tenantId, {
      fileName: 'multi-sheet.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: multiSheetSource.length,
    })
    staged.set(multiSheetJob.storageKey, multiSheetSource)
    await assert.rejects(
      () => analyzeProductImportJob(tenantId, multiSheetJob.jobId),
      (error: unknown) => error instanceof ProductImportError && error.code === 'AI_MAPPING_INCOMPLETE',
      'multi-sheet AI must return exactly one explicit decision per sheet',
    )
    await cancelProductImportJob(tenantId, multiSheetJob.jobId)

    const repeated = await createAndAnalyze('stable-copy.csv', 'text/csv', sourceA)
    assert.equal(repeated.rows[0].assignedBarcode, firstBarcode, 'same exact source in a new job reuses ledger assignment')
    const ledger = await prisma.productGeneratedBarcode.findFirst({ where: { tenantId, assignedBarcode: firstBarcode } })
    assert.equal(ledger?.reuseCount, 1)

    const changed = await createAndAnalyze('stable.csv', 'text/csv', Buffer.from('name_zh,sell_price\n外部修改商品,5.25\n'))
    assert.notEqual(changed.rows[0].assignedBarcode, firstBarcode, 'changed source hash is a new source revision')

    const strandedSigning = await createProductImportJob(tenantId, { fileName: 'stranded.csv', mimeType: 'text/csv', fileSize: sourceA.length })
    await prisma.productBulkImportJob.update({
      where: { id: strandedSigning.jobId },
      data: { status: 'UPLOAD_SIGNING', updatedAt: new Date(Date.now() - 3 * 60 * 1000) },
    })
    const recoveredSigning = await resignProductImportUpload(tenantId, strandedSigning.jobId)
    assert.equal(recoveredSigning.storageKey, strandedSigning.storageKey)
    assert.equal((await getProductImportJob(tenantId, strandedSigning.jobId)).job.status, 'AWAITING_UPLOAD', 'a stale upload-signing lease can be recovered')
    await cancelProductImportJob(tenantId, strandedSigning.jobId)

    const lostArtifactJob = await createProductImportJob(tenantId, { fileName: 'lost-artifact.csv', mimeType: 'text/csv', fileSize: sourceA.length })
    staged.set(lostArtifactJob.storageKey, sourceA)
    loseNextStagingArtifactUploadResponse = true
    await assert.rejects(() => analyzeProductImportJob(tenantId, lostArtifactJob.jobId), /simulated lost staging artifact upload response/)
    assert.ok(lostStagingArtifactKey)
    staged.set(lostStagingArtifactKey!, Buffer.from('late artifact PUT after first DELETE'))
    await assert.rejects(
      () => analyzeProductImportJob(tenantId, lostArtifactJob.jobId),
      (error: unknown) => error instanceof ProductImportError && error.code === 'ANALYSIS_ARTIFACT_QUIESCENCE_REQUIRED',
      'a timed-out artifact generation cannot be replaced while its PUT may still land',
    )
    const lostArtifactRecord = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: lostArtifactJob.jobId } })
    const lostArtifactMetadata = lostArtifactRecord.analysisMetadata as Record<string, unknown>
    await prisma.productBulkImportJob.update({
      where: { id: lostArtifactJob.jobId },
      data: { analysisMetadata: { ...lostArtifactMetadata, artifactCleanupNotBefore: new Date(Date.now() - 1_000).toISOString() } },
    })
    let recoveredArtifact = await analyzeProductImportJob(tenantId, lostArtifactJob.jobId)
    while (recoveredArtifact.hasMoreAnalysis) recoveredArtifact = await analyzeProductImportJob(tenantId, lostArtifactJob.jobId)
    assert.equal(recoveredArtifact.job.status, 'PREVIEW_READY')
    assert.equal(staged.has(lostStagingArtifactKey!), false, 'the abandoned generation remains discoverable and is deleted after quiescence')
    await cancelProductImportJob(tenantId, lostArtifactJob.jobId)

    const multiBatchArtifactJob = await createProductImportJob(tenantId, { fileName: 'artifact-rebuild.csv', mimeType: 'text/csv', fileSize: sourceA.length })
    staged.set(multiBatchArtifactJob.storageKey, sourceA)
    const artifactDirectory = multiBatchArtifactJob.storageKey.slice(0, multiBatchArtifactJob.storageKey.lastIndexOf('/'))
    const oldArtifactKeys = Array.from({ length: 105 }, (_, index) => `${artifactDirectory}/analysis/v1/11111111-1111-4111-8111-111111111111/chunk-${String(index + 1).padStart(6, '0')}.json`)
    for (const key of oldArtifactKeys) staged.set(key, Buffer.from('x'))
    const oneByteHash = createHash('sha256').update('x').digest('hex')
    await prisma.productBulkImportJob.update({
      where: { id: multiBatchArtifactJob.jobId },
      data: {
        status: 'FAILED',
        sourceFileHash: createHash('sha256').update(sourceA).digest('hex'),
        totalRowCount: 1,
        analysisMetadata: {
          sourceComplete: true,
          artifactCleanupNotBefore: new Date(Date.now() - 1_000).toISOString(),
          abandonedArtifactKeys: oldArtifactKeys,
          parseArtifacts: {
            version: 1,
            generation: '11111111-1111-4111-8111-111111111111',
            sourceFileHash: createHash('sha256').update(sourceA).digest('hex'),
            totalRows: 1,
            sourceComplete: true,
            ready: false,
            chunks: oldArtifactKeys.map((key, index) => ({ key, startOrdinal: index + 1, rowCount: 1, byteSize: 1, sha256: oneByteHash })),
          },
        },
      },
    })
    await assert.rejects(
      () => analyzeProductImportJob(tenantId, multiBatchArtifactJob.jobId),
      (error: unknown) => error instanceof ProductImportError && error.code === 'ANALYSIS_ARTIFACT_CLEANUP_FAILED',
      'artifact rebuild cleanup is bounded to one persisted 100-key batch per Analyze request',
    )
    assert.equal(oldArtifactKeys.filter((key) => staged.has(key)).length, 5)
    const rebuildProgress = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: multiBatchArtifactJob.jobId } })
    assert.equal(((rebuildProgress.analysisMetadata as Record<string, unknown>).artifactRebuildCleanupPendingKeys as string[]).length, 5)
    let rebuiltArtifact = await analyzeProductImportJob(tenantId, multiBatchArtifactJob.jobId)
    while (rebuiltArtifact.hasMoreAnalysis) rebuiltArtifact = await analyzeProductImportJob(tenantId, multiBatchArtifactJob.jobId)
    assert.equal(rebuiltArtifact.job.status, 'PREVIEW_READY')
    assert.equal(oldArtifactKeys.some((key) => staged.has(key)), false)
    const rebuiltArtifactRecord = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: multiBatchArtifactJob.jobId } })
    assert.equal('artifactRebuildCleanupPendingKeys' in (rebuiltArtifactRecord.analysisMetadata as Record<string, unknown>), false, 'old cleanup cursor cannot leak into the replacement generation')
    await cancelProductImportJob(tenantId, multiBatchArtifactJob.jobId)

    const brokenExternal = await createAndAnalyze(
      'broken-external.csv',
      'text/csv',
      Buffer.from('name_zh,sell_price,image_url\n外链图片商品,5,http://localhost/private.png\n'),
    )
    assert.equal(brokenExternal.rows[0].status, 'INVALID')
    assert.ok((brokenExternal.rows[0].validationIssues as Array<{ code?: string }>).some((issue) => issue.code === 'IMAGE_FETCH_FAILED'))
    const discardedExternal = await patchProductImportRow(tenantId, brokenExternal.job.id, brokenExternal.rows[0].id, {
      version: brokenExternal.rows[0].version,
      discardImages: true,
    })
    assert.equal(discardedExternal.status, 'READY', 'discarding a failed external image candidate clears its blocking issue')

    const unknownCategory = await createAndAnalyze(
      'unknown-category.csv',
      'text/csv',
      Buffer.from('name_zh,sell_price,category1\n分类异常商品,5,AI 猜测的新分类\n'),
    )
    assert.equal(unknownCategory.rows[0].status, 'INVALID')
    const categoryOnlyNameEdit = await patchProductImportRow(tenantId, unknownCategory.job.id, unknownCategory.rows[0].id, {
      version: unknownCategory.rows[0].version,
      name: '只修正名称',
      sellPrice: 6,
    })
    assert.equal(categoryOnlyNameEdit.status, 'INVALID', 'editing unrelated fields cannot bypass an unresolved category exception')
    assert.ok((categoryOnlyNameEdit.validationIssues as Array<{ code?: string }>).some((issue) => issue.code === 'CATEGORY_NOT_FOUND'))
    await cancelProductImportJob(tenantId, unknownCategory.job.id)

    await confirmProductImportJob(tenantId, first.job.id)
    await confirmProductImportJob(tenantId, first.job.id)
    assert.equal(await prisma.product.count({ where: { tenantId, barcode: firstBarcode } }), 1, 'duplicate Confirm does not create another Product')

    const templateResponse = await legacyTemplate(ownerRequest('/api/products/import', 'GET'))
    assert.equal(templateResponse.status, 200)
    const legacyFileBuffer = xlsxBuffer([['barcode', 'name_zh', 'sell_price'], ['LEGACY-001', '旧入口商品', 2.5]])
    const legacyForm = new FormData()
    legacyForm.append('file', new File([new Uint8Array(legacyFileBuffer)], 'legacy.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const legacyPreviewResponse = await legacyPreview(ownerRequest('/api/products/import', 'POST', legacyForm))
    assert.equal(legacyPreviewResponse.status, 200)
    const legacyPreviewBody = await legacyPreviewResponse.json()
    assert.equal(legacyPreviewBody.preview[0].barcode, 'LEGACY-001')

    const legacyMissingBarcodeBuffer = xlsxBuffer([['barcode', 'sku', 'name_zh', 'sell_price'], ['', 'SKU-MUST-NOT-BECOME-BARCODE', '缺条码旧入口商品', 2.5]])
    const legacyMissingBarcodeForm = new FormData()
    legacyMissingBarcodeForm.append('file', new File([new Uint8Array(legacyMissingBarcodeBuffer)], 'legacy-missing-barcode.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    const legacyMissingBarcodeResponse = await legacyPreview(ownerRequest('/api/products/import', 'POST', legacyMissingBarcodeForm))
    assert.equal(legacyMissingBarcodeResponse.status, 200)
    const legacyMissingBarcodeBody = await legacyMissingBarcodeResponse.json()
    assert.equal(legacyMissingBarcodeBody.preview[0].barcode, '')
    assert.match(legacyMissingBarcodeBody.preview[0].error, /新版批量导入/)
    const legacyMissingBarcodeConfirm = await legacyConfirm(ownerRequest(
      '/api/products/import/confirm',
      'POST',
      JSON.stringify({ rows: legacyMissingBarcodeBody.preview }),
      'application/json',
    ))
    assert.equal(legacyMissingBarcodeConfirm.status, 200)
    assert.equal((await legacyMissingBarcodeConfirm.json()).imported, 0)
    assert.equal(await prisma.product.count({ where: { tenantId, barcode: 'SKU-MUST-NOT-BECOME-BARCODE' } }), 0, 'legacy import never promotes SKU to Product.barcode')

    const legacyConfirmResponse = await legacyConfirm(ownerRequest(
      '/api/products/import/confirm',
      'POST',
      JSON.stringify({ rows: legacyPreviewBody.preview }),
      'application/json',
    ))
    assert.equal(legacyConfirmResponse.status, 200)
    assert.equal((await legacyConfirmResponse.json()).imported, 1)

    const legacyProduct = await prisma.product.findUnique({ where: { tenantId_barcode: { tenantId, barcode: 'LEGACY-001' } } })
    const singleImageForm = new FormData()
    const singlePng = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#12ab34' } }).png().toBuffer()
    singleImageForm.append('file', new File([new Uint8Array(singlePng)], 'single.png', { type: 'image/png' }))
    const singleImageResponse = await uploadSingleProductImage(
      ownerRequest(`/api/products/${legacyProduct!.id}/image`, 'POST', singleImageForm),
      { params: Promise.resolve({ id: legacyProduct!.id }) },
    )
    assert.equal(singleImageResponse!.status, 200)
    const singleImageProduct = await prisma.product.findUnique({ where: { id: legacyProduct!.id } })
    assert.ok(singleImageProduct?.imageUrl)
    assert.ok(singleImageProduct?.imageStorageKey)
    assert.equal(JSON.parse(singleImageProduct!.imageUrls!).length, 1)
    assert.equal(JSON.parse(singleImageProduct!.imageStorageKeys!).length, 1)

    menuAiCallCount = 0
    const menuForm = new FormData()
    menuForm.append('file', new File([new Uint8Array(singlePng)], 'menu.png', { type: 'image/png' }))
    const menuResponse1 = await recognizeMenu(ownerRequest('/api/products/import-ai/recognize', 'POST', menuForm))
    assert.equal(menuResponse1.status, 200)
    const menuPreview1 = (await menuResponse1.json()).preview as PreviewRow[]
    assert.ok(menuPreview1.every((row) => /^29\d{11}$/.test(row.barcode)))
    assert.equal(menuPreview1[0].category1Raw, 'AI 猜测的新分类')
    assert.equal(menuPreview1[0].resolvedL1, null, 'an unknown AI category remains a non-committing suggestion')
    assert.ok(menuPreview1[0].warnings?.some((warning) => warning.includes('需人工确认')))
    reverseMenuAiItems = true
    const menuFormAgain = new FormData()
    menuFormAgain.append('file', new File([new Uint8Array(singlePng)], 'menu.png', { type: 'image/png' }))
    const menuResponse2 = await recognizeMenu(ownerRequest('/api/products/import-ai/recognize', 'POST', menuFormAgain))
    const menuPreview2 = (await menuResponse2.json()).preview as PreviewRow[]
    assert.deepEqual(
      Object.fromEntries(menuPreview2.map((row) => [row.name, row.barcode])),
      Object.fromEntries(menuPreview1.map((row) => [row.name, row.barcode])),
      'AI output reordering cannot swap generated menu-item barcodes',
    )
    assert.equal(menuAiCallCount, 1, 'same menu image reuses canonical AI blocks instead of accepting a reordered response')
    reverseMenuAiItems = false
    const categoryCountBeforeMenuConfirm = await prisma.productCategory.count({ where: { tenantId } })
    const menuConfirmResponse = await legacyConfirm(ownerRequest(
      '/api/products/import/confirm',
      'POST',
      JSON.stringify({ rows: menuPreview1 }),
      'application/json',
    ))
    assert.equal(menuConfirmResponse.status, 200)
    assert.equal(await prisma.productCategory.count({ where: { tenantId } }), categoryCountBeforeMenuConfirm, 'unknown AI category does not create a Category')
    const menuProduct = await prisma.product.findUnique({ where: { tenantId_barcode: { tenantId, barcode: menuPreview1[0].barcode } } })
    assert.equal(menuProduct?.categoryId, null)

    const pdfSource = Buffer.from('%PDF-1.7 deterministic test source')
    const pdfFirst = await createAndAnalyze('products-a.pdf', 'application/pdf', pdfSource)
    reversePdfAiBlocks = true
    const pdfSecond = await createAndAnalyze('products-b.pdf', 'application/pdf', pdfSource)
    assert.deepEqual(
      Object.fromEntries(pdfSecond.rows.map((row) => [(row.previewPayload as { name?: string }).name, row.assignedBarcode])),
      Object.fromEntries(pdfFirst.rows.map((row) => [(row.previewPayload as { name?: string }).name, row.assignedBarcode])),
      'same PDF in a new Job reuses canonical blocks and generated barcodes',
    )
    assert.equal(pdfAiCallCount, 1)
    await cancelProductImportJob(tenantId, pdfFirst.job.id)
    await cancelProductImportJob(tenantId, pdfSecond.job.id)

    const manyRows = Array.from({ length: 501 }, (_, index) => `商品${index + 1},${index + 1}.5`).join('\n')
    const largeSource = Buffer.from(`name_zh,sell_price\n${manyRows}\n`)
    const largeCreated = await createProductImportJob(tenantId, { fileName: 'large.csv', mimeType: 'text/csv', fileSize: largeSource.length })
    staged.set(largeCreated.storageKey, largeSource)
    let largeProgress = await analyzeProductImportJob(tenantId, largeCreated.jobId)
    assert.equal(largeProgress.job.analyzedRowCount, 50, 'one Analyze request persists at most 50 rows')
    assert.equal(largeProgress.job.status, 'ANALYSIS_PENDING')
    assert.equal(stagingGetCounts.get(largeCreated.storageKey), 1)
    const largeJobAfterFirstBatch = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: largeCreated.jobId } })
    const firstArtifactChunk = ((largeJobAfterFirstBatch.analysisMetadata as Record<string, unknown>).parseArtifacts as { chunks: Array<{ rowCount: number }> }).chunks[0]
    assert.equal(firstArtifactChunk.rowCount, 200, 'parse artifacts stay at 200 rows while DB persistence is windowed')
    let priorAnalyzedCount = largeProgress.job.analyzedRowCount
    while (largeProgress.hasMoreAnalysis) {
      largeProgress = await analyzeProductImportJob(tenantId, largeCreated.jobId)
      const persistedThisRequest = largeProgress.job.analyzedRowCount - priorAnalyzedCount
      assert.ok(persistedThisRequest > 0 && persistedThisRequest <= 50, 'each Analyze transaction persists no more than 50 rows')
      priorAnalyzedCount = largeProgress.job.analyzedRowCount
    }
    const large = await getProductImportJob(tenantId, largeCreated.jobId, { limit: 200 })
    assert.equal(large.job.totalRowCount, 501)
    assert.equal(large.job.analyzedRowCount, 501)
    assert.equal(stagingGetCounts.get(largeCreated.storageKey), 3, 'each bounded row batch resumes from its saved source cursor')
    assert.equal(large.rows.length, 200, 'Preview paging is independent of job row limit')
    await cancelProductImportJob(tenantId, large.job.id)
    assert.equal((await getProductImportJob(tenantId, large.job.id)).job.status, 'CANCELLED')
    assert.equal([...staged.keys()].some((key) => key.startsWith(`tenants/${tenantId}/product-import-jobs/${large.job.id}/`)), false)

    const duplicateRows = [
      'CROSS-BATCH-DUP,首行,1',
      ...Array.from({ length: 199 }, (_, index) => `UNIQUE-${index + 1},唯一${index + 1},2`),
      'CROSS-BATCH-DUP,跨批重复,3',
    ]
    const duplicateSource = Buffer.from(`barcode,name_zh,sell_price\n${duplicateRows.join('\n')}\n`)
    const duplicateJob = await createAndAnalyze('cross-batch-duplicate.csv', 'text/csv', duplicateSource)
    const duplicateFirstPage = await getProductImportJob(tenantId, duplicateJob.job.id, { limit: 200 })
    const duplicateSecondPage = await getProductImportJob(tenantId, duplicateJob.job.id, { cursor: 200, limit: 200 })
    assert.equal(duplicateFirstPage.rows[0].status, 'INVALID')
    assert.equal(duplicateSecondPage.rows[0].status, 'INVALID')
    const duplicateIssues = duplicateFirstPage.rows[0].validationIssues as Array<{ code?: string }>
    assert.ok(duplicateIssues.some((issue) => issue.code === 'DUPLICATE_BARCODE_IN_FILE'))
    await cancelProductImportJob(tenantId, duplicateJob.job.id)

    const generatedCollisionRows = [
      'SOURCE-FIRST,源条码在前,1',
      ...Array.from({ length: 199 }, (_, index) => `COLLISION-FILLER-${index + 1},填充${index + 1},2`),
      ',缺条码在后,3',
    ]
    const generatedCollisionSource = Buffer.from(`barcode,name_zh,sell_price\n${generatedCollisionRows.join('\n')}\n`)
    const generatedCollisionJob = await createProductImportJob(tenantId, {
      fileName: 'generated-collision.csv', mimeType: 'text/csv', fileSize: generatedCollisionSource.length,
    })
    staged.set(generatedCollisionJob.storageKey, generatedCollisionSource)
    let generatedCollisionFirst = await analyzeProductImportJob(tenantId, generatedCollisionJob.jobId)
    assert.equal(generatedCollisionFirst.job.analyzedRowCount, 50)
    while (generatedCollisionFirst.job.analyzedRowCount < 200) {
      generatedCollisionFirst = await analyzeProductImportJob(tenantId, generatedCollisionJob.jobId)
    }
    const generatedCollisionRecord = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: generatedCollisionJob.jobId } })
    const collidingBarcode = internalEan13Candidate(
      `${tenantId}:${generatedCollisionRecord.sourceFileHash}:${stableRowIdentity(['spreadsheet-row-v1', 0, 202])}`,
    )
    const priorSourceRow = await prisma.productBulkImportRow.findFirstOrThrow({
      where: { jobId: generatedCollisionJob.jobId, sourceOrdinal: 1 },
    })
    await prisma.productBulkImportRow.update({
      where: { id: priorSourceRow.id },
      data: {
        assignedBarcode: collidingBarcode,
        barcodeOrigin: 'SOURCE',
        previewPayload: { ...(priorSourceRow.previewPayload as Record<string, unknown>), barcode: collidingBarcode },
      },
    })
    const generatedCollisionDone = await analyzeProductImportJob(tenantId, generatedCollisionJob.jobId)
    assert.equal(generatedCollisionDone.job.status, 'PREVIEW_READY')
    const priorCollisionResult = await getProductImportJob(tenantId, generatedCollisionJob.jobId, { limit: 1 })
    const laterCollisionResult = await getProductImportJob(tenantId, generatedCollisionJob.jobId, { cursor: 200, limit: 1 })
    assert.equal(priorCollisionResult.rows[0].status, 'INVALID')
    assert.equal(laterCollisionResult.rows[0].barcodeOrigin, 'GENERATED')
    assert.equal(laterCollisionResult.rows[0].assignedBarcode, collidingBarcode)
    assert.equal(laterCollisionResult.rows[0].status, 'INVALID', 'generated barcode collisions with prior source rows isolate both rows')
    await cancelProductImportJob(tenantId, generatedCollisionJob.jobId)

    const resumableRows = Array.from({ length: 201 }, (_, index) => `可续跑${index + 1},${index + 1}`).join('\n')
    const resumableSource = Buffer.from(`name_zh,sell_price\n${resumableRows}\n`)
    const resumableJob = await createProductImportJob(tenantId, { fileName: 'resume.csv', mimeType: 'text/csv', fileSize: resumableSource.length })
    staged.set(resumableJob.storageKey, resumableSource)
    let resumableFirst = await analyzeProductImportJob(tenantId, resumableJob.jobId)
    assert.equal(resumableFirst.job.analyzedRowCount, 50)
    while (resumableFirst.job.analyzedRowCount < 200) {
      resumableFirst = await analyzeProductImportJob(tenantId, resumableJob.jobId)
    }
    failNextStagingGet = true
    await assert.rejects(() => analyzeProductImportJob(tenantId, resumableJob.jobId), /simulated transient staging read failure/)
    const resumableFailed = await getProductImportJob(tenantId, resumableJob.jobId)
    assert.equal(resumableFailed.job.status, 'FAILED')
    assert.equal(resumableFailed.hasMoreAnalysis, true, 'a partial Analyze failure remains resumable')
    const resumableDone = await analyzeProductImportJob(tenantId, resumableJob.jobId)
    assert.equal(resumableDone.job.status, 'PREVIEW_READY')
    await cancelProductImportJob(tenantId, resumableJob.jobId)

    const realFixturePath = process.env.PRODUCT_BULK_IMPORT_REAL_XLSX_FIXTURE
    if (realFixturePath) {
      const realSource = await readFile(realFixturePath)
      assert.equal(realSource.length, 26_867_993, 'Home Depo fixture byte size')
      assert.equal(
        createHash('sha256').update(realSource).digest('hex'),
        '43dbee620170c54364eab98501cc2703ede0044671b85caa629986ed572a72fa',
        'Home Depo fixture hash',
      )
      spreadsheetMappings = [{
        sheetIndex: 0,
        selected: true,
        headerRowNumber: 2,
        mapping: { nameKm: 1, barcode: 2, sellPrice: 3 },
        confidence: 0.95,
        warnings: [],
      }]
      const productCountBeforeRealAnalyze = await prisma.product.count({ where: { tenantId } })
      const realJob = await createProductImportJob(tenantId, {
        fileName: 'សម្ភារៈបរិក្ខារបន្ទប់ទឹក.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileSize: realSource.length,
      })
      staged.set(realJob.storageKey, realSource)
      let realProgress = await analyzeProductImportJob(tenantId, realJob.jobId)
      let priorRealAnalyzedCount = 0
      let realAnalyzeCalls = 1
      assert.ok(realProgress.job.analyzedRowCount <= 50)
      priorRealAnalyzedCount = realProgress.job.analyzedRowCount
      while (realProgress.hasMoreAnalysis) {
        realProgress = await analyzeProductImportJob(tenantId, realJob.jobId)
        realAnalyzeCalls += 1
        const persistedThisRequest = realProgress.job.analyzedRowCount - priorRealAnalyzedCount
        assert.ok(persistedThisRequest > 0 && persistedThisRequest <= 50, 'Home Depo DB persistence is bounded per transaction')
        priorRealAnalyzedCount = realProgress.job.analyzedRowCount
      }
      assert.equal(realAnalyzeCalls, 5)
      assert.equal(realProgress.job.status, 'PREVIEW_READY')
      assert.equal(realProgress.job.totalRowCount, 219)
      assert.equal(realProgress.job.analyzedRowCount, 219)
      assert.equal(realProgress.job.readyRowCount, 216)
      assert.equal(realProgress.job.invalidRowCount, 3)
      const realRows = await prisma.productBulkImportRow.findMany({
        where: { jobId: realJob.jobId, tenantId },
        select: { imagePlan: true },
      })
      const imageRelationships = realRows.reduce((total, row) => {
        const candidates = (row.imagePlan as { candidates?: unknown[] } | null)?.candidates
        return total + (Array.isArray(candidates) ? candidates.length : 0)
      }, 0)
      assert.equal(realRows.length, 219)
      assert.equal(imageRelationships, 219)
      assert.equal(await prisma.product.count({ where: { tenantId } }), productCountBeforeRealAnalyze, 'Analyze never creates Product records')
      await cancelProductImportJob(tenantId, realJob.jobId)
      spreadsheetMappings = defaultSpreadsheetMappings
    }

    const cancelImageSource = await xlsxWithImage([['name_zh', 'sell_price'], ['取消图片商品', 4]])
    const cancelImageJob = await createAndAnalyze('cancel-image.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', cancelImageSource)
    const previewResponse = await imagePreviewRoute(
      ownerRequest(`/api/products/import/jobs/${cancelImageJob.job.id}/rows/${cancelImageJob.rows[0].id}/images/0`, 'GET'),
      { params: Promise.resolve({ id: cancelImageJob.job.id, rowId: cancelImageJob.rows[0].id, slot: '0' }) },
    )
    assert.equal(previewResponse.status, 200)
    assert.equal(previewResponse.headers.get('content-type'), 'image/webp')
    assert.ok((await previewResponse.arrayBuffer()).byteLength > 0, 'embedded image can be visually previewed before Confirm')
    const cancelIntentKey = `tenants/${tenantId}/product-import-jobs/${cancelImageJob.job.id}/rows/test/image-1-cancel.webp`
    productImages.set(cancelIntentKey, Buffer.from('pending'))
    await prisma.productBulkImportRow.update({
      where: { id: cancelImageJob.rows[0].id },
      data: { status: 'CONFIRMING', imageResult: { uploadIntentKeys: [cancelIntentKey] } },
    })
    await prisma.productBulkImportJob.update({
      where: { id: cancelImageJob.job.id },
      data: { status: 'CONFIRMING' },
    })
    await assert.rejects(
      () => retryProductImportJob(tenantId, cancelImageJob.job.id),
      (error: unknown) => error instanceof ProductImportError && error.code === 'RETRY_NOT_READY',
      'an active confirming row cannot be taken over before the stale lease',
    )
    failProductImageDelete = true
    const cancelPending = await cancelProductImportJob(tenantId, cancelImageJob.job.id)
    assert.equal(cancelPending.status, 'COMPENSATION_REQUIRED')
    failProductImageDelete = false
    productImages.set(cancelIntentKey, Buffer.from('late PUT after first DELETE'))
    await prisma.productBulkImportRow.update({
      where: { id: cancelImageJob.rows[0].id },
      data: { updatedAt: new Date(Date.now() - 20 * 60 * 1000) },
    })
    const cancelRecovered = await retryProductImportJob(tenantId, cancelImageJob.job.id)
    assert.equal(cancelRecovered.job.status, 'CANCELLED')
    assert.equal(productImages.has(cancelIntentKey), false, 'cancel retry removes persisted image intents')

    const tamperSource = await xlsxWithImage([['name_zh', 'sell_price'], ['源文件冻结商品', 6]])
    const tamperJob = await createAndAnalyze('tamper.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', tamperSource)
    const tamperRecord = await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: tamperJob.job.id } })
    const changedStaging = Buffer.from(tamperSource)
    changedStaging[changedStaging.length - 1] ^= 1
    staged.set(tamperRecord.stagingStorageKey, changedStaging)
    await assert.rejects(
      () => confirmProductImportJob(tenantId, tamperJob.job.id),
      (error: unknown) => error instanceof ProductImportError && error.code === 'SOURCE_CHANGED',
      'Confirm rejects a staging object changed after Preview',
    )
    assert.equal(await prisma.product.count({ where: { tenantId, barcode: tamperJob.rows[0].assignedBarcode! } }), 0)
    assert.equal((await getProductImportJob(tenantId, tamperJob.job.id)).job.status, 'PREVIEW_READY', 'transient Confirm source failure returns to confirmable Preview')

    const isolated = await createAndAnalyze('isolated.csv', 'text/csv', Buffer.from('name_zh,sell_price\n可导入商品,3\n,4\n'))
    assert.equal(isolated.job.readyRowCount, 1)
    assert.equal(isolated.job.invalidRowCount, 1)
    const isolatedResult = await confirmProductImportJob(tenantId, isolated.job.id)
    assert.equal(isolatedResult.job.status, 'COMPLETED', 'valid rows complete while invalid rows remain isolated')
    assert.deepEqual(isolatedResult.job.resultSummary, { total: 2, confirmed: 1, invalid: 1, failed: 0, compensationRequired: 0 })

    const confirmFailure = await createAndAnalyze(
      'confirm-failure.csv',
      'text/csv',
      Buffer.from('name_zh,sell_price\n确认失败商品,999999999999\n'),
    )
    const confirmFailureResult = await confirmProductImportJob(tenantId, confirmFailure.job.id)
    assert.equal(confirmFailureResult.job.status, 'FAILED')
    await assert.rejects(
      () => analyzeProductImportJob(tenantId, confirmFailure.job.id),
      (error: unknown) => error instanceof ProductImportError && error.code === 'JOB_NOT_ANALYZABLE',
      'an erroneous Analyze request cannot consume a Confirm failure state',
    )
    const confirmFailureStillFailed = await getProductImportJob(tenantId, confirmFailure.job.id)
    assert.equal(confirmFailureStillFailed.job.status, 'FAILED')
    assert.equal(confirmFailureStillFailed.rows[0].status, 'FAILED')
    const confirmFailureRetried = await retryProductImportJob(tenantId, confirmFailure.job.id)
    assert.equal(confirmFailureRetried.job.status, 'PREVIEW_READY')
    const confirmFailureResetRow = (await getProductImportJob(tenantId, confirmFailure.job.id)).rows[0]
    await patchProductImportRow(tenantId, confirmFailure.job.id, confirmFailureResetRow.id, { version: confirmFailureResetRow.version, sellPrice: 9 })
    assert.equal((await confirmProductImportJob(tenantId, confirmFailure.job.id)).job.status, 'COMPLETED')

    const failingSource = await xlsxWithImage([['name_zh', 'sell_price'], ['回滚商品', 999999999999]])
    const failing = await createAndAnalyze('rollback.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', failingSource)
    failProductImageDelete = true
    const failedConfirm = await confirmProductImportJob(tenantId, failing.job.id)
    assert.equal('batch' in failedConfirm ? failedConfirm.batch.failed : 0, 1)
    assert.equal(failedConfirm.job.status, 'COMPENSATION_REQUIRED')
    assert.equal(await prisma.product.count({ where: { tenantId, barcode: failing.rows[0].assignedBarcode! } }), 0, 'DB failure rolls back Product')
    const compensationRow = (await getProductImportJob(tenantId, failing.job.id)).rows[0]
    assert.equal(compensationRow.status, 'COMPENSATION_REQUIRED')
    assert.ok((compensationRow.imageResult as { compensationPendingKeys?: string[] }).compensationPendingKeys?.length)
    await assert.rejects(
      () => patchProductImportRow(tenantId, failing.job.id, compensationRow.id, { version: compensationRow.version, name: '绕过补偿' }),
      (error: unknown) => error instanceof ProductImportError && ['JOB_NOT_EDITABLE', 'ROW_NOT_EDITABLE'].includes(error.code),
      'Preview edits cannot bypass pending Storage compensation',
    )

    failProductImageDelete = false
    await prisma.productBulkImportRow.update({
      where: { id: compensationRow.id },
      data: { updatedAt: new Date(Date.now() - 20 * 60 * 1000) },
    })
    const retried = await retryProductImportJob(tenantId, failing.job.id)
    assert.equal(retried.pending, 0)
    const resetRow = (await getProductImportJob(tenantId, failing.job.id)).rows[0]
    assert.equal(resetRow.status, 'READY')
    await patchProductImportRow(tenantId, failing.job.id, resetRow.id, { version: resetRow.version, sellPrice: 12 })
    const recovered = await confirmProductImportJob(tenantId, failing.job.id)
    assert.equal(recovered.job.status, 'COMPLETED')
    const recoveredProduct = await prisma.product.findUnique({ where: { tenantId_barcode: { tenantId, barcode: resetRow.assignedBarcode! } } })
    assert.ok(recoveredProduct?.imageStorageKey)
    assert.equal(recoveredProduct?.imageUrl?.includes('/storage/v1/object/public/product-images/'), true)
    assert.deepEqual(JSON.parse(recoveredProduct!.imageUrls!), [recoveredProduct!.imageUrl])
    assert.deepEqual(JSON.parse(recoveredProduct!.imageStorageKeys!), [recoveredProduct!.imageStorageKey])

    const lostResponseSource = await xlsxWithImage([['name_zh', 'sell_price'], ['响应丢失商品', 7]])
    const lostResponseJob = await createAndAnalyze('lost-response.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', lostResponseSource)
    loseProductImageUploadResponse = true
    const lostResponseConfirm = await confirmProductImportJob(tenantId, lostResponseJob.job.id)
    loseProductImageUploadResponse = false
    assert.equal(lostResponseConfirm.job.status, 'COMPENSATION_REQUIRED')
    assert.equal(await prisma.product.count({ where: { tenantId, barcode: lostResponseJob.rows[0].assignedBarcode! } }), 0)
    const lostIntentKey = ((await getProductImportJob(tenantId, lostResponseJob.job.id)).rows[0].imageResult as { uploadedKeys?: string[] }).uploadedKeys?.[0]
    assert.ok(lostIntentKey)
    assert.equal(productImages.has(lostIntentKey!), false, 'lost upload response is compensated using the persisted intent key')
    await assert.rejects(
      () => retryProductImportJob(tenantId, lostResponseJob.job.id),
      (error: unknown) => error instanceof ProductImportError && error.code === 'RETRY_NOT_READY',
      'compensation tombstones survive until the upload request quiescence window',
    )
    productImages.set(lostIntentKey!, Buffer.from('late PUT after lost response'))
    await prisma.productBulkImportRow.update({
      where: { id: lostResponseJob.rows[0].id },
      data: { updatedAt: new Date(Date.now() - 20 * 60 * 1000) },
    })
    const lostResponseRetried = await retryProductImportJob(tenantId, lostResponseJob.job.id)
    assert.equal(lostResponseRetried.job.status, 'PREVIEW_READY')
    assert.equal(productImages.has(lostIntentKey!), false, 'quiescent retry deletes an object that landed after the first compensation')

    await prisma.product.create({
      data: {
        id: 'existing-product-image-test', tenantId, barcode: 'EXISTING-IMAGE', name: '旧商品', sellPrice: '8',
        imageUrl: 'https://storage.test/old.webp',
        imageStorageKey: `tenants/${tenantId}/products/existing/old.webp`,
        imageUrls: JSON.stringify(['https://storage.test/old.webp']),
        imageStorageKeys: JSON.stringify([`tenants/${tenantId}/products/existing/old.webp`]),
      },
    })
    const updateSource = await xlsxWithImage([['barcode', 'name_zh', 'sell_price'], ['EXISTING-IMAGE', '新商品名', 9], ['ISOLATED-UPDATE-INVALID', '', 5]])
    const updateJob = await createAndAnalyze('update.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', updateSource)
    assert.equal(updateJob.rows[0].action, 'UPDATE')
    assert.equal(updateJob.job.invalidRowCount, 1)
    failProductImageDelete = true
    const updatePending = await confirmProductImportJob(tenantId, updateJob.job.id)
    assert.equal(updatePending.job.status, 'COMPENSATION_REQUIRED')
    failProductImageDelete = false
    const updateCompleted = await retryProductImportJob(tenantId, updateJob.job.id)
    assert.equal(updateCompleted.job.status, 'COMPLETED', 'old-image cleanup retry completes even with isolated invalid rows')
    assert.ok(replacementObservedKey?.includes(`/product-import-jobs/${updateJob.job.id}/`), 'old object is deleted only after DB points at the new key')

    const cleanupBatchRows = Array.from({ length: 51 }, (_, index) => `待清旧图${index + 1},${index + 1}`).join('\n')
    const cleanupBatchJob = await createAndAnalyze('cleanup-batches.csv', 'text/csv', Buffer.from(`name_zh,sell_price\n${cleanupBatchRows}\n`))
    for (const [index, row] of cleanupBatchJob.rows.entries()) {
      const key = `tenants/${tenantId}/product-import-jobs/${cleanupBatchJob.job.id}/rows/test/old-${index}.webp`
      productImages.set(key, Buffer.from('old'))
      await prisma.productBulkImportRow.update({
        where: { id: row.id },
        data: { status: 'CONFIRMED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING', imageResult: { oldKeysPendingCleanup: [key] } },
      })
    }
    await prisma.productBulkImportJob.update({
      where: { id: cleanupBatchJob.job.id },
      data: { status: 'COMPENSATION_REQUIRED', lastErrorCode: 'OLD_IMAGE_CLEANUP_PENDING' },
    })
    const cleanupBatchFirst = await retryProductImportJob(tenantId, cleanupBatchJob.job.id)
    assert.equal(cleanupBatchFirst.job.status, 'COMPENSATION_REQUIRED', 'retry does not complete while another cleanup batch remains')
    assert.ok(((cleanupBatchFirst.job.resultSummary as { compensationRequired?: number }).compensationRequired ?? 0) > 0)
    let cleanupBatchDone = cleanupBatchFirst
    while (cleanupBatchDone.job.status === 'COMPENSATION_REQUIRED') {
      cleanupBatchDone = await retryProductImportJob(tenantId, cleanupBatchJob.job.id)
    }
    assert.equal(cleanupBatchDone.job.status, 'COMPLETED')
    assert.equal((cleanupBatchDone.job.resultSummary as { compensationRequired?: number }).compensationRequired, 0)

    const lateSourceCleanup = await createProductImportJob(tenantId, {
      fileName: 'late-source-cleanup.csv', mimeType: 'text/csv', fileSize: sourceA.length,
    })
    staged.set(lateSourceCleanup.storageKey, sourceA)
    const lateSourceDirectory = lateSourceCleanup.storageKey.slice(0, lateSourceCleanup.storageKey.lastIndexOf('/'))
    const manyCleanupArtifacts = Array.from({ length: 105 }, (_, index) => (
      `${lateSourceDirectory}/analysis/v1/22222222-2222-4222-8222-222222222222/chunk-${String(index + 1).padStart(6, '0')}.json`
    ))
    for (const key of manyCleanupArtifacts) staged.set(key, Buffer.from('artifact'))
    await prisma.productBulkImportJob.update({
      where: { id: lateSourceCleanup.jobId },
      data: { analysisMetadata: { abandonedArtifactKeys: manyCleanupArtifacts } },
    })
    const partialCancel = await cancelProductImportJob(tenantId, lateSourceCleanup.jobId)
    assert.equal(partialCancel.stagingCleaned, false)
    assert.equal(staged.has(lateSourceCleanup.storageKey), true, 'source remains ledgered until earlier artifact batches finish')
    staged.set(lateSourceCleanup.storageKey, Buffer.from('late signed PUT'))
    await prisma.productBulkImportJob.update({
      where: { id: lateSourceCleanup.jobId },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date(Date.now() - 20 * 60 * 1000) },
    })
    const lateSourceSweep = await cleanupExpiredProductImportJobs(1)
    assert.deepEqual(lateSourceSweep, { scanned: 1, cleaned: 1, failed: 0 })
    assert.equal(manyCleanupArtifacts.some((key) => staged.has(key)), false)
    assert.equal(staged.has(lateSourceCleanup.storageKey), false, 'expiry sweep removes a source PUT that arrived after partial cleanup')

    const expirySource = Buffer.from('name_zh,sell_price\n过期清理商品,1\n')
    const expiryJob = await createAndAnalyze('expiry.csv', 'text/csv', expirySource)
    await prisma.productBulkImportJob.update({
      where: { id: expiryJob.job.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date(Date.now() - 20 * 60 * 1000) },
    })
    const expiryCleanup = await cleanupExpiredProductImportJobs()
    assert.ok(expiryCleanup.cleaned >= 1)
    assert.equal((await getProductImportJob(tenantId, expiryJob.job.id)).job.status, 'EXPIRED')
    assert.equal([...staged.keys()].some((key) => key.startsWith(`tenants/${tenantId}/product-import-jobs/${expiryJob.job.id}/`)), false)

    const poisonCleanup = await createAndAnalyze('poison-cleanup.csv', 'text/csv', Buffer.from('name_zh,sell_price\n清理失败商品,2\n'))
    const healthyCleanup = await createAndAnalyze('healthy-cleanup.csv', 'text/csv', Buffer.from('name_zh,sell_price\n清理成功商品,3\n'))
    const poisonPrefix = `tenants/${tenantId}/product-import-jobs/${poisonCleanup.job.id}/`
    const healthyPrefix = `tenants/${tenantId}/product-import-jobs/${healthyCleanup.job.id}/`
    await prisma.productBulkImportJob.update({
      where: { id: poisonCleanup.job.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date(Date.now() - 40 * 60 * 1000) },
    })
    await prisma.productBulkImportJob.update({
      where: { id: healthyCleanup.job.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000), updatedAt: new Date(Date.now() - 30 * 60 * 1000) },
    })
    failStagingBulkDeletePrefix = poisonPrefix
    const mixedCleanup = await cleanupExpiredProductImportJobs(2)
    failStagingBulkDeletePrefix = null
    assert.deepEqual(mixedCleanup, { scanned: 2, cleaned: 1, failed: 1 }, 'one poison cleanup cannot starve the next expired job')
    assert.equal([...staged.keys()].some((key) => key.startsWith(poisonPrefix)), true)
    assert.equal([...staged.keys()].some((key) => key.startsWith(healthyPrefix)), false)
    assert.equal((await getProductImportJob(tenantId, healthyCleanup.job.id)).job.status, 'EXPIRED')

    const interruptedCleanup = await createAndAnalyze('interrupted-cleanup.csv', 'text/csv', Buffer.from('name_zh,sell_price\n待清理商品,2\n'))
    const interruptedKey = `tenants/${tenantId}/product-import-jobs/${interruptedCleanup.job.id}/rows/test/interrupted.webp`
    productImages.set(interruptedKey, Buffer.from('pending'))
    await prisma.productBulkImportRow.update({
      where: { id: interruptedCleanup.rows[0].id },
      data: {
        status: 'CLEANUP_ACTIVE',
        imageResult: { uploadIntentKeys: [interruptedKey] },
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    })
    await prisma.productBulkImportJob.update({
      where: { id: interruptedCleanup.job.id },
      data: {
        status: 'CLEANUP_ACTIVE',
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        stagingCleanedAt: new Date(Date.now() - 30 * 60 * 1000),
        analysisMetadata: {
          ...((await prisma.productBulkImportJob.findUniqueOrThrow({ where: { id: interruptedCleanup.job.id } })).analysisMetadata as Record<string, unknown>),
          cleanupPreviousStatus: 'COMPLETED',
        },
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      },
    })
    await cleanupExpiredProductImportJobs()
    assert.equal(productImages.has(interruptedKey), false, 'stale row cleanup remains discoverable after staging was already cleaned')
    assert.equal((await getProductImportJob(tenantId, interruptedCleanup.job.id)).job.status, 'COMPLETED', 'cleanup crash recovery preserves the original terminal status')

    assert.ok(deletedKeys.some((key) => key.includes('product-import-jobs')))
    console.log('product bulk import integration checks passed')
  } finally {
    await prisma.product.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    await prisma.$disconnect()
    globalThis.fetch = originalFetch
  }
}

main().catch(async (error) => {
  console.error(error)
  try { await prisma.$disconnect() } catch {}
  globalThis.fetch = originalFetch
  process.exit(1)
})

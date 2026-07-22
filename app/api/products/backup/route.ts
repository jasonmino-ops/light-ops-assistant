import { NextRequest, NextResponse } from 'next/server'
import { getContext } from '@/lib/context'
import { prisma } from '@/lib/prisma'
import {
  createProductExportWorkbook,
  createZip,
  PRODUCT_BACKUP_LIMITS,
  productBackupLimitError,
  productBackupImages,
  type ProductBackupManifestImage,
} from '@/lib/product-backup'
import { downloadObject, isStorageConfigured, StorageNotConfiguredError } from '@/lib/supabase-storage'

const PRODUCT_IMAGE_BUCKET = 'product-images'

function safeExtension(storageKey: string): string {
  const extension = storageKey.split('.').pop()?.toLowerCase()
  return extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin'
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })
  if (ctx.role !== 'OWNER') return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 })

  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId },
    include: { category: { include: { parent: true } } },
    orderBy: [{ categoryId: 'asc' }, { name: 'asc' }, { barcode: 'asc' }],
    take: PRODUCT_BACKUP_LIMITS.maxProducts + 1,
  })
  const imageRefs = products.flatMap((product) => productBackupImages(product))
  const controlledImageCount = imageRefs.filter((image) => !!image.storageKey).length
  const initialLimitError = productBackupLimitError({ productCount: products.length, controlledImageCount, totalImageBytes: 0 })
  if (initialLimitError) {
    return NextResponse.json(
      { error: initialLimitError, message: '完整备份超出安全资源限制；请联系支持人员按批次归档商品图片。' },
      { status: 413 },
    )
  }
  if (controlledImageCount > 0 && !isStorageConfigured()) {
    return NextResponse.json(
      { error: 'STORAGE_NOT_CONFIGURED', message: '图片存储未配置，无法生成可恢复的完整商品备份' },
      { status: 503 },
    )
  }

  const files: Array<{ path: string; data: Uint8Array }> = [
    { path: 'products.xlsx', data: createProductExportWorkbook(products) },
  ]
  const images: ProductBackupManifestImage[] = []
  let totalImageBytes = 0
  try {
    for (const product of products) {
      for (const image of productBackupImages(product)) {
        if (!image.storageKey) {
          images.push({
            productId: product.id,
            slot: image.slot,
            source: image.url ? 'EXTERNAL_REFERENCE' : 'MISSING',
            originalUrl: image.url,
            storageKey: null,
            archivePath: null,
          })
          continue
        }
        const archivePath = `images/${product.id}/image-${image.slot}.${safeExtension(image.storageKey)}`
        const data = await downloadObject(PRODUCT_IMAGE_BUCKET, image.storageKey)
        const sizeLimitError = productBackupLimitError({
          productCount: products.length,
          controlledImageCount,
          totalImageBytes,
          nextImageBytes: data.byteLength,
        })
        if (sizeLimitError) {
          return NextResponse.json(
            { error: sizeLimitError, message: '完整备份超出安全资源限制；请联系支持人员按批次归档商品图片。' },
            { status: 413 },
          )
        }
        totalImageBytes += data.byteLength
        files.push({ path: archivePath, data })
        images.push({
          productId: product.id,
          slot: image.slot,
          source: 'SUPABASE_STORAGE',
          originalUrl: image.url,
          storageKey: image.storageKey,
          archivePath,
        })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BACKUP_IMAGE_READ_FAILED'
    const status = error instanceof StorageNotConfiguredError ? 503 : 502
    return NextResponse.json(
      { error: 'BACKUP_IMAGE_READ_FAILED', message: `读取商品图片备份失败：${message.slice(0, 180)}` },
      { status },
    )
  }

  const manifest = {
    format: 'light-ops-product-backup-v1',
    generatedAt: new Date().toISOString(),
    tenantId: ctx.tenantId,
    productCount: products.length,
    imageCount: images.length,
    controlledImageCount,
    externalReferenceCount: images.filter((image) => image.source === 'EXTERNAL_REFERENCE').length,
    resourceLimits: {
      maxProducts: PRODUCT_BACKUP_LIMITS.maxProducts,
      maxControlledImages: PRODUCT_BACKUP_LIMITS.maxControlledImages,
      maxTotalImageBytes: PRODUCT_BACKUP_LIMITS.maxTotalImageBytes,
    },
    restore: {
      productFile: 'products.xlsx',
      note: 'products.xlsx 可用于重新导入；images/ 保存当前由本系统 Supabase Storage 管理的图片对象。外部图片仅保留原始 URL，以避免服务端抓取不受控地址。',
    },
    images,
  }
  files.push({ path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })
  const data = createZip(files)
  const date = new Date().toISOString().slice(0, 10)
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="products_backup_${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  })
}

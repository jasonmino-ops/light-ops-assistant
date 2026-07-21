import * as XLSX from 'xlsx'
import { PRODUCT_TEMPLATE_HEADERS } from './product-spreadsheet'

export type ProductBackupRow = {
  id: string
  barcode: string
  sku: string | null
  name: string
  nameZh: string | null
  nameEn: string | null
  nameKm: string | null
  descZh: string | null
  descEn: string | null
  descKm: string | null
  spec: string | null
  sellPrice: { toString(): string }
  status: 'ACTIVE' | 'DISABLED'
  imageUrl: string | null
  imageUrls: string | null
  imageStorageKey: string | null
  imageStorageKeys: string | null
  category: { name: string; parent: { name: string } | null } | null
  createdAt: Date
  updatedAt: Date
}

export type ProductBackupManifestImage = {
  productId: string
  slot: number
  source: 'SUPABASE_STORAGE' | 'EXTERNAL_REFERENCE' | 'MISSING'
  originalUrl: string | null
  storageKey: string | null
  archivePath: string | null
  error?: string
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()) : []
  } catch {
    return []
  }
}

function imageUrlsForProduct(product: ProductBackupRow): string[] {
  const urls = parseStringArray(product.imageUrls)
  return urls.length > 0 ? urls.slice(0, 3) : product.imageUrl ? [product.imageUrl] : []
}

function imageKeysForProduct(product: ProductBackupRow): string[] {
  const keys = parseStringArray(product.imageStorageKeys)
  return keys.length > 0 ? keys.slice(0, 3) : product.imageStorageKey ? [product.imageStorageKey] : []
}

export function productBackupImages(product: ProductBackupRow): Array<{ slot: number; url: string | null; storageKey: string | null }> {
  const urls = imageUrlsForProduct(product)
  const keys = imageKeysForProduct(product)
  const length = Math.max(urls.length, keys.length)
  return Array.from({ length }, (_, index) => ({ slot: index + 1, url: urls[index] ?? null, storageKey: keys[index] ?? null }))
}

export function createProductExportWorkbook(products: ProductBackupRow[]): Buffer {
  const rows = products.map((product) => {
    const category1 = product.category?.parent?.name ?? product.category?.name ?? ''
    const category2 = product.category?.parent ? product.category.name : ''
    const images = imageUrlsForProduct(product)
    return [
      product.barcode, product.sku ?? '', product.nameZh ?? product.name, product.nameEn ?? '', product.nameKm ?? '',
      product.descZh ?? '', product.descEn ?? '', product.descKm ?? '', product.spec ?? '', product.sellPrice.toString(), product.status,
      images[0] ?? '', images.join('|'), category1, category2,
    ]
  })
  const worksheet = XLSX.utils.aoa_to_sheet([PRODUCT_TEMPLATE_HEADERS, ...rows])
  worksheet['!cols'] = PRODUCT_TEMPLATE_HEADERS.map((header) => ({ wch: Math.max(12, Math.min(48, header.length + 8)) }))
  const note = XLSX.utils.aoa_to_sheet([
    ['说明'],
    ['此文件可直接用于商品导入。图片 URL 会保留；完整 ZIP 备份另含当前由本系统存储的图片文件。'],
    ['重复条码默认跳过，若需更新已有商品，请在导入预览中逐行明确选择“更新”。'],
  ])
  note['!cols'] = [{ wch: 100 }]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, '商品')
  XLSX.utils.book_append_sheet(workbook, note, '说明')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number): Buffer {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value, 0)
  return buffer
}

function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0, 0)
  return buffer
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear()) - 1980
  return {
    date: (year << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  }
}

/** 生成标准 ZIP（store 模式，无第三方长期依赖）。 */
export function createZip(files: Array<{ path: string; data: Uint8Array }>): Buffer {
  const now = dosDateTime(new Date())
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.path.replace(/^\/+/, ''), 'utf8')
    const data = Buffer.from(file.data)
    const crc = crc32(data)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(now.time), u16(now.date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data,
    ])
    localParts.push(local)
    centralParts.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(now.time), u16(now.date), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(central.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...localParts, central, end])
}

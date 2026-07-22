import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'
import {
  createProductTemplateWorkbook,
  MAX_PRODUCT_IMPORT_ROWS,
  parseProductSpreadsheet,
} from '../lib/product-spreadsheet'
import {
  createProductExportWorkbook,
  createZip,
  productBackupLimitError,
  productBackupImages,
} from '../lib/product-backup'
import { buildProductImportUpdate } from '../lib/product-import-update'
import zh from '../lib/i18n/zh'
import en from '../lib/i18n/en'
import km from '../lib/i18n/km'

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '第三方商品')
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
}

const parsed = parseProductSpreadsheet(workbookBuffer([
  ['第三方商品资料'],
  ['货号', '商品名称', '零售价', '图片列表', '大类', '小类'],
  ['A-001', '椰子水', '2.50', 'https://img.example/coconut.jpg|https://img.example/coconut-2.jpg', '饮料', '水'],
  ['A-002', '苏打水', '3.00', '', '饮料', '气泡水'],
]), undefined)
assert.equal(parsed.ok, true)
if (parsed.ok) {
  assert.equal(parsed.value.headerRowIndex, 1)
  assert.equal(parsed.value.preview.length, 2)
  assert.equal(parsed.value.preview[0].barcode, 'A-001')
  assert.equal(parsed.value.preview[0].imageUrls.length, 2)
  assert.equal(parsed.value.preview[0].resolvedL1, '饮料')
}

const mapped = parseProductSpreadsheet(workbookBuffer([
  ['CodeX', 'TitleX', 'MoneyX'],
  ['B-001', '手动映射商品', '9.90'],
]), { barcode: 0, nameZh: 1, sellPrice: 2 })
assert.equal(mapped.ok, true)
if (mapped.ok) assert.equal(mapped.value.preview[0].name, '手动映射商品')
if (mapped.ok) assert.deepEqual(mapped.value.preview[0].providedFields, ['barcode', 'nameZh', 'sellPrice'])

const fiveHundredAndOneRows = parseProductSpreadsheet(workbookBuffer([
  ['barcode', 'name_zh', 'sell_price'],
  ...Array.from({ length: 501 }, (_, index) => [`LIMIT-${index + 1}`, `商品 ${index + 1}`, '1.00']),
]), undefined)
assert.equal(fiveHundredAndOneRows.ok, true)
if (fiveHundredAndOneRows.ok) assert.equal(fiveHundredAndOneRows.value.preview.length, 501)

const tooManyRows = parseProductSpreadsheet(workbookBuffer([
  ['barcode', 'name_zh', 'sell_price'],
  ...Array.from({ length: MAX_PRODUCT_IMPORT_ROWS + 1 }, (_, index) => [`MAX-${index + 1}`, `商品 ${index + 1}`, '1.00']),
]), undefined)
assert.equal(tooManyRows.ok, false)
if (!tooManyRows.ok) assert.equal(tooManyRows.error, 'TOO_MANY_ROWS')

if (mapped.ok) {
  const mappedRow = mapped.value.preview[0]
  const priceOnlyUpdate = buildProductImportUpdate(
    { ...mappedRow, providedFields: ['barcode', 'sellPrice'], sellPrice: 12.5 },
    [],
    null,
  )
  assert.deepEqual(priceOnlyUpdate, { sellPrice: '12.5' })

  const imageClearUpdate = buildProductImportUpdate(
    { ...mappedRow, providedFields: ['barcode', 'imageUrls'] },
    [],
    null,
  )
  assert.deepEqual(imageClearUpdate, {
    imageUrl: null,
    imageUrls: null,
    imageStorageKey: null,
    imageStorageKeys: null,
  })
}

const template = XLSX.read(createProductTemplateWorkbook(), { type: 'buffer' })
assert.ok(template.SheetNames.includes('商品导入模板'))

const product = {
  id: 'product-1', barcode: '1001', sku: 'SKU-1001', name: '椰子水', nameZh: '椰子水', nameEn: 'Coconut Water', nameKm: null,
  descZh: null, descEn: null, descKm: null, spec: '500ml', sellPrice: { toString: () => '2.50' }, status: 'ACTIVE' as const,
  imageUrl: 'https://storage.example/public/product-1.jpg', imageUrls: JSON.stringify(['https://storage.example/public/product-1.jpg', 'https://cdn.example/detail.jpg']),
  imageStorageKey: 'tenants/t1/products/product-1/image-1.jpg', imageStorageKeys: JSON.stringify(['tenants/t1/products/product-1/image-1.jpg', '']),
  category: { name: '饮料', parent: null }, createdAt: new Date(), updatedAt: new Date(),
}
assert.equal(productBackupImages(product).length, 2)
const exported = XLSX.read(createProductExportWorkbook([product]), { type: 'buffer' })
const exportedRows = XLSX.utils.sheet_to_json<unknown[]>(exported.Sheets['商品'], { header: 1 })
assert.equal(exportedRows[1][0], '1001')
assert.equal(exportedRows[1][12], 'https://storage.example/public/product-1.jpg|https://cdn.example/detail.jpg')

const zip = createZip([
  { path: 'manifest.json', data: Buffer.from('{"ok":true}') },
  { path: 'images/product-1/image-1.jpg', data: Buffer.from([1, 2, 3]) },
])
assert.equal(zip.readUInt32LE(0), 0x04034b50)
assert.ok(zip.includes(Buffer.from('manifest.json')))
assert.ok(zip.includes(Buffer.from('images/product-1/image-1.jpg')))

assert.equal(productBackupLimitError({ productCount: 1, controlledImageCount: 1, totalImageBytes: 0, nextImageBytes: 1024 }), null)
assert.equal(productBackupLimitError({ productCount: 5_001, controlledImageCount: 1, totalImageBytes: 0 }), 'BACKUP_PRODUCT_LIMIT')
assert.equal(productBackupLimitError({ productCount: 1, controlledImageCount: 2_001, totalImageBytes: 0 }), 'BACKUP_IMAGE_COUNT_LIMIT')
assert.equal(productBackupLimitError({ productCount: 1, controlledImageCount: 1, totalImageBytes: 0, nextImageBytes: 6 * 1024 * 1024 }), 'BACKUP_SINGLE_IMAGE_LIMIT')

const productPage = fs.readFileSync(path.join(process.cwd(), 'app/products/page.tsx'), 'utf8')
const importTranslationKeys = [...new Set(
  [...productPage.matchAll(/t\('products\.(import[A-Za-z0-9]+)'\)/g)].map((match) => match[1]),
)]
assert.ok(importTranslationKeys.length > 20)
for (const dictionary of [zh, en, km]) {
  for (const key of importTranslationKeys) {
    assert.equal(typeof (dictionary.products as Record<string, string>)[key], 'string', `${key} must exist in every locale`)
  }
}

const confirmRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/products/import/confirm/route.ts'), 'utf8')
assert.match(confirmRoute, /prisma\.\$transaction/)
assert.match(confirmRoute, /duplicateAction/)
assert.match(confirmRoute, /buildProductImportUpdate/)
assert.match(confirmRoute, /MAX_PRODUCT_IMPORT_ROWS/)
const backupRoute = fs.readFileSync(path.join(process.cwd(), 'app/api/products/backup/route.ts'), 'utf8')
assert.match(backupRoute, /productBackupLimitError/)

console.log('product-tools tests passed')

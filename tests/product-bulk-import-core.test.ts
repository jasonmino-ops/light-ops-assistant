import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { strToU8, unzipSync, zipSync } from 'fflate'
import sharp from 'sharp'
import {
  ean13CheckDigit,
  internalEan13Candidate,
  isValidEan13,
} from '../lib/product-bulk-import/barcode'
import { normalizeCategoryName, resolveExistingCategory } from '../lib/product-bulk-import/categories'
import {
  createProductImportImageLimiter,
  deterministicProductImageKey,
  downloadExternalImage,
  isPublicImageAddress,
  normalizeImportImage,
  testExternalImageDeadline,
} from '../lib/product-bulk-import/images'
import { productImportAiConfig, PRODUCT_IMPORT_AI_DEFAULT_MODEL } from '../lib/product-bulk-import/ai/config'
import { AnthropicProductImportAiProvider } from '../lib/product-bulk-import/ai/anthropic'
import { pdfBlocksToRows } from '../lib/product-bulk-import/pdf'
import { inspectSpreadsheetBuffer, parseSpreadsheetBuffer } from '../lib/product-bulk-import/xlsx'

function workbookBuffer(sheets: Array<{ name: string; rows: unknown[][] }>): Buffer {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)
}

async function drawingWorkbook(options: { wps?: boolean; unsupported?: boolean; officeEmbedded?: boolean } = {}): Promise<Buffer> {
  const source = workbookBuffer([{ name: '商品', rows: [
    ['barcode', 'name_zh', 'sell_price'],
    ['0012345678901', '水龙头', 12.5],
    [1234567890123, '花洒', 19],
  ] }])
  const files = unzipSync(new Uint8Array(source))
  const sheetPath = 'xl/worksheets/sheet1.xml'
  let sheetXml = Buffer.from(files[sheetPath]).toString('utf8')
  if (!sheetXml.includes('xmlns:r=')) sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ')
  sheetXml = sheetXml.replace('</worksheet>', '<drawing r:id="rIdDrawing"/></worksheet>')
  files[sheetPath] = strToU8(sheetXml)
  files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>')
  const imageTarget = options.unsupported ? '../media/image1.emf' : '../media/image1.png'
  files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${imageTarget}"/></Relationships>`)
  files['xl/drawings/drawing1.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>1</xdr:row></xdr:from><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:oneCellAnchor><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:row>2</xdr:row></xdr:from><xdr:to><xdr:col>4</xdr:col><xdr:row>3</xdr:row></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="rIdImage"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor></xdr:wsDr>')
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ff0000' } }).png().toBuffer()
  files[options.unsupported ? 'xl/media/image1.emf' : 'xl/media/image1.png'] = new Uint8Array(png)
  if (options.wps) files['xl/cellimages.xml'] = strToU8('<cellImages/>')
  if (options.officeEmbedded) {
    files[sheetPath] = strToU8(Buffer.from(files[sheetPath]).toString('utf8').replace(
      '</worksheet>',
      '<oleObjects><oleObject progId="Package" shapeId="1" r:id="rIdOle"/></oleObjects></worksheet>',
    ))
    files['xl/embeddings/oleObject1.bin'] = strToU8('unsupported embedded object')
  }
  return Buffer.from(zipSync(files))
}

async function main() {
  assert.equal(ean13CheckDigit('400638133393'), '1')
  const candidates = new Set<string>()
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const barcode = internalEan13Candidate('tenant:file:row', attempt)
    assert.match(barcode, /^29\d{11}$/)
    assert.equal(isValidEan13(barcode), true)
    candidates.add(barcode)
  }
  assert.equal(candidates.size, 100)
  assert.equal(internalEan13Candidate('tenant:file:row'), internalEan13Candidate('tenant:file:row'))
  assert.notEqual(internalEan13Candidate('tenant:file-a:row'), internalEan13Candidate('tenant:file-b:row'))

  const categoryList = [
    { id: 'l1', name: '卫浴', parentId: null },
    { id: 'l2', name: ' 水龙头 ', parentId: 'l1' },
    { id: 'other', name: '水龙头', parentId: null },
  ]
  assert.equal(normalizeCategoryName(' ＡＢＣ  '), 'abc')
  assert.deepEqual(resolveExistingCategory(categoryList, '卫浴', '水龙头'), { status: 'MATCHED', categoryId: 'l2' })
  assert.deepEqual(resolveExistingCategory(categoryList, '卫浴', '不存在'), { status: 'NOT_FOUND', categoryId: null })
  assert.deepEqual(resolveExistingCategory([...categoryList, { id: 'l1b', name: '卫浴', parentId: null }], '卫浴', null), { status: 'AMBIGUOUS', categoryId: null })

  const csv = Buffer.from('\uFEFF商品条码,中文名,售价\n0001234567890,可乐,1.25\n0001234567890,重复,2.00\n')
  const csvResult = parseSpreadsheetBuffer(csv, 'CSV')
  assert.equal(csvResult.rows.length, 2)
  assert.equal(csvResult.rows[0].product.barcode, '0001234567890')
  assert.equal(csvResult.rows[0].product.sellPrice, 1.25)
  assert.ok(csvResult.rows.every((row) => row.issues.some((issue) => issue.code === 'DUPLICATE_BARCODE_IN_FILE')))

  const irregular = workbookBuffer([
    { name: '说明', rows: [['本文件由系统导出'], ['请勿删除']] },
    { name: 'Products', rows: [['报表日期'], [], ['商品编码', 'ឈ្មោះទំនិញ', '价格'], ['SKU-01', 'ក្បាលទឹក', 8.5]] },
  ])
  const irregularResult = parseSpreadsheetBuffer(irregular, 'XLSX', {
    0: { selected: false, headerRowNumber: 1, mapping: {} },
    1: { selected: true, headerRowNumber: 3, mapping: { sku: 0, nameKm: 1, sellPrice: 2 } },
  })
  assert.equal(irregularResult.rows.length, 1)
  assert.equal(irregularResult.rows[0].coordinate.sheetName, 'Products')
  assert.equal(irregularResult.rows[0].product.nameKm, 'ក្បាលទឹក')
  assert.equal(irregularResult.rows[0].product.barcode, null)
  assert.ok(irregularResult.warnings.some((warning) => warning.code === 'SHEET_SKIPPED' && warning.message.includes('说明')))

  const groupedVariantResult = parseSpreadsheetBuffer(workbookBuffer([{ name: '商品表', rows: [
    ['商品ID', '商品编号', '商品名称', '售价', '规格ID'],
    ['P-1', 'SKU-1-S', '咖啡（小杯）', 1.5, 'SPEC-S'],
    ['P-1', 'SKU-1-L', '咖啡（大杯）', 2, 'SPEC-L'],
    ['P-2', 'SKU-2', '茶', 1, 'SPEC-DEFAULT'],
  ] }]), 'XLSX', {
    0: { selected: true, headerRowNumber: 1, mapping: { nameZh: 2, sellPrice: 3 } },
  })
  assert.equal(groupedVariantResult.rows.length, 3)
  assert.ok(groupedVariantResult.warnings.some((warning) => (
    warning.code === 'UNSUPPORTED_GROUPED_VARIANT_SOURCE'
    && warning.blocking
    && warning.message.includes('1 个重复 Product ID 分组')
  )))

  const nonGroupedResult = parseSpreadsheetBuffer(workbookBuffer([{ name: '商品表', rows: [
    ['商品ID', '商品编号', '商品名称', '售价', '规格ID'],
    ['P-1', 'REUSED-SKU', '普通商品 A', 1.5, ''],
    ['P-1', 'REUSED-SKU', '普通商品 A 补充行', 1.5, ''],
    ['P-2', 'REUSED-SKU', '普通商品 B', 2, 'SPEC-B'],
  ] }]), 'XLSX', {
    0: { selected: true, headerRowNumber: 1, mapping: { sku: 1, nameZh: 2, sellPrice: 3 } },
  })
  assert.equal(nonGroupedResult.warnings.some((warning) => warning.code === 'UNSUPPORTED_GROUPED_VARIANT_SOURCE'), false)

  const externalImages = parseSpreadsheetBuffer(workbookBuffer([{ name: 'Products', rows: [
    ['中文名', '售价', '状态', '图片地址'],
    ['外链图片商品', 6.5, 'ON', 'https://images.example/product.jpg'],
    ['停用外链图片商品', 7.5, 'OFF', 'https://images.example/disabled.jpg'],
  ] }]), 'XLSX')
  assert.equal(externalImages.rows.length, 2)
  assert.equal(externalImages.rows[0].images[0].kind, 'EXTERNAL_URL')
  assert.equal(externalImages.rows[0].issues.some((issue) => issue.code === 'UNSUPPORTED_IMAGE_FORMAT'), false)
  assert.equal(externalImages.rows[0].product.status, 'ACTIVE')
  assert.equal(externalImages.rows[1].product.status, 'DISABLED')

  const offsetBook = XLSX.utils.book_new()
  const offsetSheet = XLSX.utils.aoa_to_sheet([])
  XLSX.utils.sheet_add_aoa(offsetSheet, [
    ['商品条码', '中文名', '售价'],
    ['0000000000007', '偏移表商品', 3.25],
  ], { origin: 'B3' })
  XLSX.utils.book_append_sheet(offsetBook, offsetSheet, 'Offset')
  const offsetResult = parseSpreadsheetBuffer(
    Buffer.from(XLSX.write(offsetBook, { type: 'buffer', bookType: 'xlsx' }) as Buffer),
    'XLSX',
  )
  assert.equal(offsetResult.rows[0].product.barcode, '0000000000007')
  assert.equal(offsetResult.rows[0].product.name, '偏移表商品')
  assert.equal(offsetResult.rows[0].product.sellPrice, 3.25)

  const oversizedArchive = unzipSync(new Uint8Array(workbookBuffer([{ name: 'Products', rows: [['中文名', '售价'], ['商品', 1]] }])))
  oversizedArchive['customXml/oversized.bin'] = new Uint8Array(33 * 1024 * 1024)
  const oversizedWorkbook = Buffer.from(zipSync(oversizedArchive, { level: 1 }))
  assert.throws(() => parseSpreadsheetBuffer(oversizedWorkbook, 'XLSX'), /XLSX_ZIP_ENTRY_TOO_LARGE/)

  const dimensionArchive = unzipSync(new Uint8Array(workbookBuffer([{ name: 'Products', rows: [['中文名', '售价'], ['商品', 1]] }])))
  const normalSheetXml = Buffer.from(dimensionArchive['xl/worksheets/sheet1.xml']).toString('utf8')
  dimensionArchive['xl/worksheets/sheet1.xml'] = strToU8(normalSheetXml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1:XFD1048576"/>'))
  assert.throws(() => parseSpreadsheetBuffer(Buffer.from(zipSync(dimensionArchive)), 'XLSX'), /XLSX_WORKSHEET_DIMENSION_LIMIT/)
  dimensionArchive['xl/worksheets/sheet1.xml'] = strToU8(normalSheetXml.replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="XFD1:XFD500000"/>'))
  assert.throws(() => parseSpreadsheetBuffer(Buffer.from(zipSync(dimensionArchive)), 'XLSX'), /XLSX_WORKSHEET_DIMENSION_LIMIT/)

  const tooManySheets = Array.from({ length: 65 }, (_, index) => ({
    name: `S${index + 1}`,
    rows: [['中文名', '售价'], [`商品${index + 1}`, 1]],
  }))
  assert.throws(() => parseSpreadsheetBuffer(workbookBuffer(tooManySheets), 'XLSX'), /XLSX_WORKBOOK_SHEET_LIMIT/)

  const withImages = parseSpreadsheetBuffer(await drawingWorkbook(), 'XLSX')
  assert.equal(withImages.rows.length, 2)
  assert.equal(withImages.rows[0].product.barcode, '0012345678901')
  assert.equal(withImages.rows[1].product.barcode, '1234567890123')
  assert.equal(withImages.rows[0].images.length, 1, 'oneCell anchor maps to source row')
  assert.equal(withImages.rows[1].images.length, 1, 'twoCell anchor maps to source row')
  assert.equal(withImages.rows[0].images[0].source, withImages.rows[1].images[0].source, 'one image may be shared by multiple SKU')
  assert.equal(withImages.rows[0].issues.some((issue) => issue.code === 'UNSUPPORTED_IMAGE_FORMAT'), false)

  const wps = parseSpreadsheetBuffer(await drawingWorkbook({ wps: true }), 'XLSX')
  assert.ok(wps.warnings.some((issue) => issue.message.includes('WPS')))
  assert.ok(wps.rows.every((row) => row.issues.some((issue) => issue.code === 'UNSUPPORTED_IMAGE_FORMAT')))
  const unsupported = parseSpreadsheetBuffer(await drawingWorkbook({ unsupported: true }), 'XLSX')
  assert.ok(unsupported.rows.every((row) => row.issues.some((issue) => issue.code === 'UNSUPPORTED_IMAGE_FORMAT')))
  const officeEmbedded = parseSpreadsheetBuffer(await drawingWorkbook({ officeEmbedded: true }), 'XLSX')
  assert.ok(officeEmbedded.warnings.some((issue) => issue.message.includes('Office OLE')))
  assert.ok(officeEmbedded.rows.every((row) => row.issues.some((issue) => issue.message.includes('Office OLE'))))

  const rawImage = await sharp({ create: { width: 20, height: 10, channels: 4, background: '#abcdef' } }).png().toBuffer()
  const normalizedA = await normalizeImportImage(rawImage)
  const normalizedB = await normalizeImportImage(rawImage)
  assert.equal(normalizedA.contentType, 'image/webp')
  assert.equal(normalizedA.imageHash, normalizedB.imageHash)
  const keyA = deterministicProductImageKey({ tenantId: 'tenant', jobId: 'job', rowIdentity: 'row', imageHash: normalizedA.imageHash, slot: 0 })
  const keyB = deterministicProductImageKey({ tenantId: 'tenant', jobId: 'job', rowIdentity: 'row', imageHash: normalizedA.imageHash, slot: 0 })
  assert.equal(keyA, keyB)
  assert.equal(isPublicImageAddress('8.8.8.8'), true)
  assert.equal(isPublicImageAddress('2606:4700:4700::1111'), true)
  for (const address of [
    '127.0.0.1', '100.64.0.1', '192.0.0.1', '192.0.2.1', '198.18.0.1',
    '198.51.100.1', '203.0.113.1', '224.0.0.1', '240.0.0.1',
    '::1', '::ffff:192.168.1.1', '::192.168.1.1', '64:ff9b::c0a8:101',
    '64:ff9b:1::c0a8:101', 'fec0::1', 'fc00::1', 'fe80::1', 'ff00::1',
    '2001:db8::1', '2002:c0a8:101::1', '3fff::1',
  ]) assert.equal(isPublicImageAddress(address), false, `${address} must not be fetched by the server`)
  await assert.rejects(() => downloadExternalImage('http://localhost/image.png'), /HOST_NOT_ALLOWED/)
  const mislabeledLegacyImage = await testExternalImageDeadline('https://images.example/legacy', 100, {
    resolve: async (rawUrl) => ({ url: new URL(rawUrl), address: '8.8.8.8', family: 4 }),
    request: async () => ({ status: 200, headers: { 'content-type': 'text/plain; charset=binary' }, body: rawImage }),
  })
  assert.equal((await normalizeImportImage(mislabeledLegacyImage)).contentType, 'image/webp')
  await assert.rejects(
    () => testExternalImageDeadline('https://images.example/not-image', 100, {
      resolve: async (rawUrl) => ({ url: new URL(rawUrl), address: '8.8.8.8', family: 4 }),
      request: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html></html>') }),
    }),
    /EXTERNAL_IMAGE_CONTENT_TYPE_INVALID/,
  )
  const slowRedirectStarted = Date.now()
  await assert.rejects(
    () => testExternalImageDeadline('https://images.example/start', 35, {
      resolve: async (rawUrl) => ({ url: new URL(rawUrl), address: '8.8.8.8', family: 4 }),
      request: async (target) => {
        await new Promise((resolve) => setTimeout(resolve, 24))
        return { status: 302, headers: { location: new URL('/next', target.url).toString() }, body: Buffer.alloc(0) }
      },
    }),
    /EXTERNAL_IMAGE_TIMEOUT/,
    'DNS and every redirect share one absolute external-image deadline',
  )
  assert.ok(Date.now() - slowRedirectStarted < 100, 'redirects do not reset the total external-image timeout')

  const imageLimiter = createProductImportImageLimiter(2)
  let activeImageOperations = 0
  let peakImageOperations = 0
  await Promise.all(Array.from({ length: 12 }, (_, index) => imageLimiter(async () => {
    activeImageOperations += 1
    peakImageOperations = Math.max(peakImageOperations, activeImageOperations)
    await new Promise((resolve) => setTimeout(resolve, 5 + (index % 3)))
    activeImageOperations -= 1
  })))
  assert.equal(peakImageOperations, 2, 'one Confirm batch never runs more than two image decodes at once')

  const saved = { ...process.env }
  const savedFetch = globalThis.fetch
  try {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    delete process.env.PRODUCT_IMPORT_AI_PROVIDER
    delete process.env.PRODUCT_IMPORT_AI_MODEL
    delete process.env.PRODUCT_IMPORT_AI_BASE_URL
    assert.equal(PRODUCT_IMPORT_AI_DEFAULT_MODEL, 'claude-haiku-4-5-20251001')
    assert.equal(productImportAiConfig().model, 'claude-haiku-4-5-20251001')
    let requestedModel = ''
    globalThis.fetch = async (_input, init) => {
      requestedModel = String(JSON.parse(String(init?.body)).model)
      return Response.json({ content: [{ type: 'text', text: '[{"sheetIndex":0,"selected":true,"headerRowNumber":3,"mapping":{"nameZh":1,"sellPrice":2,"invented":9},"confidence":1.5,"warnings":["check"]}]' }] })
    }
    const adapter = new AnthropicProductImportAiProvider(productImportAiConfig())
    const mapped = await adapter.mapSpreadsheet([{ sheetIndex: 0, sheetName: '商品', maxRowNumber: 4, maxColumnIndex: 2, headerRowNumber: null, headers: ['编号', '品名', '价格'], sampleRows: [['1', '商品', '2']], candidateRows: [{ rowNumber: 3, cells: [{ columnIndex: 0, value: '编号' }, { columnIndex: 1, value: '品名' }, { columnIndex: 2, value: '价格' }] }], deterministicMapping: null }])
    assert.equal(requestedModel, 'claude-haiku-4-5-20251001')
    assert.deepEqual(mapped[0].mapping, { nameZh: 1, sellPrice: 2 })
    assert.equal(mapped[0].confidence, 1)
    globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: '[{"sheetIndex":99,"selected":true,"headerRowNumber":999,"mapping":{"nameZh":40,"sellPrice":41},"confidence":1,"warnings":[]}]' }] })
    await assert.rejects(
      () => adapter.mapSpreadsheet([{ sheetIndex: 0, sheetName: '商品', maxRowNumber: 4, maxColumnIndex: 2, headerRowNumber: null, headers: ['编号', '品名', '价格'], sampleRows: [['1', '商品', '2']], candidateRows: [{ rowNumber: 3, cells: [{ columnIndex: 0, value: '编号' }] }], deterministicMapping: null }]),
      /AI_SCHEMA_INVALID/,
    )
    globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: '[{"sheetIndex":0,"headerRowNumber":1,"mapping":{}}]' }] })
    await assert.rejects(
      () => adapter.mapSpreadsheet([{ sheetIndex: 0, sheetName: '商品', maxRowNumber: 4, maxColumnIndex: 2, headerRowNumber: 1, headers: ['编号', '品名', '价格'], sampleRows: [], candidateRows: [{ rowNumber: 1, cells: [{ columnIndex: 0, value: '编号' }] }], deterministicMapping: null }]),
      /AI_SCHEMA_INVALID/,
      'missing selected must not silently skip a sheet',
    )
    let boundedRequestBytes = 0
    globalThis.fetch = async (_input, init) => {
      boundedRequestBytes = Buffer.byteLength(String(init?.body))
      return Response.json({ content: [{ type: 'text', text: '[{"sheetIndex":0,"selected":true,"headerRowNumber":1,"mapping":{"nameZh":0,"sellPrice":1}}]' }] })
    }
    await adapter.mapSpreadsheet([{
      sheetIndex: 0,
      sheetName: '商品',
      maxRowNumber: 4,
      maxColumnIndex: 1,
      headerRowNumber: 1,
      headers: ['名称'.repeat(500_000), '售价'.repeat(500_000)],
      sampleRows: [['商品'.repeat(500_000), '1'.repeat(500_000)]],
      candidateRows: [{ rowNumber: 1, cells: [{ columnIndex: 0, value: '名称'.repeat(500_000) }, { columnIndex: 1, value: '售价'.repeat(500_000) }] }],
      deterministicMapping: null,
    }])
    assert.ok(boundedRequestBytes < 130_000, `spreadsheet AI prompt is bounded (${boundedRequestBytes} bytes)`)

    const deepHeaderSource = workbookBuffer([{ name: 'Odd headers', rows: [
      ['季度商品资料'],
      ['生成系统', '门店后台'],
      [],
      ['请核对以下数据'],
      ['自定义货号', 'ឈ្មោះក្នុងតារាង', 'តម្លៃក្នុងតារាង'],
      ['SKU-DEEP-01', 'ក្បាលទឹកជ្រៅ', 8.75],
    ] }])
    const deepInspection = inspectSpreadsheetBuffer(deepHeaderSource, 'XLSX')
    assert.equal(deepInspection[0].deterministicMapping, null)
    assert.deepEqual(deepInspection[0].candidateRows.map((row) => row.rowNumber), [1, 2, 3, 4, 5, 6])
    let deepPrompt = ''
    globalThis.fetch = async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: Array<{ type: string; text?: string }> }> }
      deepPrompt = request.messages[0].content.find((part) => part.type === 'text')?.text ?? ''
      return Response.json({ content: [{ type: 'text', text: '[{"sheetIndex":0,"selected":true,"headerRowNumber":5,"mapping":{"sku":0,"nameKm":1,"sellPrice":2},"confidence":0.9,"warnings":[]}]' }] })
    }
    const deepMappings = await adapter.mapSpreadsheet(deepInspection)
    assert.match(deepPrompt, /"rowNumber":5/)
    assert.match(deepPrompt, /ឈ្មោះក្នុងតារាង/)
    assert.match(deepPrompt, /"columnIndex":2/)
    assert.match(deepPrompt, /高棉文字为主时映射 nameKm/)
    assert.match(deepPrompt, /写编码\/Code.*优先映射 barcode/)
    assert.match(deepPrompt, /实际包含 HTTP\/HTTPS URL 时才映射 imageUrl/)
    assert.match(deepPrompt, /商品多语言、规格、加料.*必须 selected=false/)
    assert.match(deepPrompt, /不得把分类ID.*必须选择“分类名称”/)
    const deepParsed = parseSpreadsheetBuffer(deepHeaderSource, 'XLSX', {
      0: { selected: deepMappings[0].selected, headerRowNumber: deepMappings[0].headerRowNumber, mapping: deepMappings[0].mapping },
    })
    assert.equal(deepParsed.rows[0].product.sku, 'SKU-DEEP-01')
    assert.equal(deepParsed.rows[0].product.nameKm, 'ក្បាលទឹកជ្រៅ')
    assert.equal(deepParsed.rows[0].product.sellPrice, 8.75)
    globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: JSON.stringify([
      { pageNumber: 1, sourceBox: [100, 300, 900, 420], name: '下方商品', price: 2 },
      { pageNumber: 1, sourceBox: [100, 100, 900, 220], name: '上方商品', price: 1 },
    ]) }] })
    const pdfBlocks = await adapter.recognizePdf(Buffer.from('%PDF-test'))
    assert.deepEqual(pdfBlocks.map((block) => [block.name, block.blockIndex]), [['上方商品', 0], ['下方商品', 1]])
    globalThis.fetch = async () => Response.json({ content: [{ type: 'text', text: '[{"pageNumber":1,"blockIndex":0,"price":1}]' }] })
    await assert.rejects(() => adapter.recognizePdf(Buffer.from('%PDF-test')), /AI_SCHEMA_INVALID/)
    process.env.PRODUCT_IMPORT_AI_PROVIDER = 'local'
    assert.throws(() => productImportAiConfig(), /PROVIDER_UNSUPPORTED/)
  } finally {
    globalThis.fetch = savedFetch
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }

  const pdfRows = pdfBlocksToRows([{
    pageNumber: 2, blockIndex: 4, sourceBox: [100, 200, 800, 300], name: 'PDF 商品', barcode: null, sku: null, price: 4.5,
    category1: null, category2: null, description: null, spec: null,
    nearbyImageDescription: '右侧商品图', confidence: 0.8, warnings: [],
  }])
  assert.equal(pdfRows.rows[0].coordinate.pageNumber, 2)
  assert.ok(pdfRows.rows[0].issues.some((issue) => issue.code === 'PDF_IMAGE_REQUIRES_CONFIRMATION' && issue.blocking))
  const duplicatePdfRows = pdfBlocksToRows([
    {
      pageNumber: 1, blockIndex: 0, sourceBox: [100, 100, 800, 200], name: '重复 A', barcode: 'PDF-DUP', sku: null, price: 1,
      category1: null, category2: null, description: null, spec: null,
      nearbyImageDescription: null, confidence: 0.8, warnings: [],
    },
    {
      pageNumber: 1, blockIndex: 0, sourceBox: [100, 100, 800, 200], name: '重复 B', barcode: 'PDF-DUP', sku: null, price: 2,
      category1: null, category2: null, description: null, spec: null,
      nearbyImageDescription: null, confidence: 0.8, warnings: [],
    },
  ])
  assert.notEqual(duplicatePdfRows.rows[0].stableSourceRowIdentity, duplicatePdfRows.rows[1].stableSourceRowIdentity)
  assert.ok(duplicatePdfRows.rows.every((row) => row.issues.some((issue) => issue.code === 'DUPLICATE_BARCODE_IN_FILE')))
  assert.ok(duplicatePdfRows.rows.every((row) => row.issues.some((issue) => issue.code === 'AI_MAPPING_FAILED')))

  const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /@@unique\(\[tenantId, sourceFileHash, stableSourceRowIdentity\]\)/)
  assert.match(schema, /@@unique\(\[tenantId, assignedBarcode\]\)/)
  const legacyImport = fs.readFileSync('app/api/products/import/route.ts', 'utf8')
  const legacyAiImport = fs.readFileSync('app/api/products/import-ai/recognize/route.ts', 'utf8')
  assert.doesNotMatch(legacyImport, /`GEN-/)
  assert.doesNotMatch(legacyAiImport, /`AI\$\{/)
  const rowPatchSource = fs.readFileSync('lib/product-bulk-import/jobs.ts', 'utf8')
  assert.doesNotMatch(rowPatchSource.slice(rowPatchSource.indexOf('export async function patchProductImportRow')), /assignedBarcode\s*:/)
  assert.equal(createHash('sha256').update('source-a').digest('hex') === createHash('sha256').update('source-b').digest('hex'), false)
  const bulkUi = fs.readFileSync('app/products/ProductBulkImportPanel.tsx', 'utf8')
  assert.match(bulkUi, /method: 'PUT'/)
  assert.match(bulkUi, /accept="\.xlsx,\.csv,\.pdf"/)
  assert.match(bulkUi, /assignedBarcode/)
  assert.match(bulkUi, /discardImages/)

  console.log('product bulk import core checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

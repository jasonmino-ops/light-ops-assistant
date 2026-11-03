const { parentPort, workerData } = require('node:worker_threads')
const { PDFDocument, PDFName } = require('pdf-lib')

async function splitPages() {
  const source = await PDFDocument.load(workerData, {
    throwOnInvalidObject: true,
    updateMetadata: false,
  })
  const pageCount = source.getPageCount()
  if (pageCount === 0) throw new Error('PDF has no pages')
  if (pageCount < 2 || pageCount > 4) return null
  // The page copier does not retain document-level form or layer rendering rules.
  if (source.catalog.has(PDFName.of('AcroForm')) || source.catalog.has(PDFName.of('OCProperties'))) return null

  const pages = []
  for (let index = 0; index < pageCount; index++) {
    const pagePdf = await PDFDocument.create({ updateMetadata: false })
    const [page] = await pagePdf.copyPages(source, [index])
    pagePdf.addPage(page)
    pages.push(await pagePdf.save({ updateFieldAppearances: false }))
  }
  return pages
}

splitPages().then(
  (pages) => parentPort.postMessage(pages),
  () => parentPort.postMessage({ failed: true }),
)

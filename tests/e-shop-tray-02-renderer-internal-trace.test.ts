import assert from 'node:assert/strict'
import fs from 'node:fs'

const renderer = fs.readFileSync('lib/qzHtmlBitmapRenderer.ts', 'utf8')
const orderSheet = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
const traceRoute = fs.readFileSync('app/api/es-tray-02/client-trace/route.ts', 'utf8')

const events = [
  'RENDER_DOM_MOUNTED',
  'FRAME_LOAD_START', 'FRAME_LOAD_DONE', 'FRAME_LOAD_FAILED',
  'FONTS_START', 'FONTS_DONE', 'FONTS_FAILED',
  'IMAGES_START', 'IMAGES_DONE', 'IMAGES_FAILED',
  'RAF_1_START', 'RAF_1_DONE', 'RAF_2_START', 'RAF_2_DONE',
  'HTML2CANVAS_IMPORT_START', 'HTML2CANVAS_IMPORT_DONE', 'HTML2CANVAS_IMPORT_FAILED',
  'HTML2CANVAS_START', 'HTML2CANVAS_DONE', 'HTML2CANVAS_FAILED',
  'PIXEL_ENCODE_START', 'PIXEL_ENCODE_DONE', 'PIXEL_ENCODE_FAILED',
]

for (const event of events) {
  assert.ok(renderer.includes(`'${event}'`), `${event} must be emitted by the renderer`)
  assert.ok(traceRoute.includes(`'${event}'`), `${event} must be accepted by the FIELD trace endpoint`)
}

assert.match(renderer, /options\?\.trace\?\.\(event,/)
assert.match(renderer, /FIELD diagnostics must never affect the existing renderer result/)
assert.match(orderSheet, /renderTicketHtmlToEscPosRaw\(html, \{\s*trace:/)
assert.equal((orderSheet.match(/renderTicketHtmlToEscPosRaw\(html\)/g) ?? []).length, 1, 'LAN call must remain unchanged')

// Observation only: preserve every known pending boundary and renderer option.
assert.match(renderer, /new Promise\(\(resolve\) => frameWindow\.requestAnimationFrame\(\(\) => resolve\(\)\)\)/)
assert.doesNotMatch(renderer.slice(renderer.indexOf('function waitForFrame'), renderer.indexOf('function normalizeCanvasWidth')), /setTimeout|reject/)
assert.match(renderer, /frame\.setAttribute\('sandbox', 'allow-same-origin'\)/)
assert.match(renderer, /left: '-10000px'/)
assert.match(renderer, /width: '80mm'/)
assert.match(renderer, /backgroundColor: '#fff'/)
assert.match(renderer, /scale: QZ_RAW_PRINTABLE_WIDTH_PX \/ bounds\.width/)
assert.match(renderer, /useCORS: true/)
assert.match(renderer, /allowTaint: false/)
assert.match(renderer, /imageTimeout: HTML_RENDER_TIMEOUT_MS/)
assert.match(renderer, /encodeRgbaToEscPosEscStar24/)
assert.doesNotMatch(renderer, /Promise\.race|AbortController/)

console.log('ES-TRAY-02 renderer internal trace tests passed')

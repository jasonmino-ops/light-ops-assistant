import assert from 'node:assert/strict'
import fs from 'node:fs'

const orderSheet = fs.readFileSync('app/components/OrderDetailSheet.tsx', 'utf8')
const mountedRenderer = fs.readFileSync('lib/eShopTray02MountedDomRenderer.ts', 'utf8')
const htmlRenderer = fs.readFileSync('lib/qzHtmlBitmapRenderer.ts', 'utf8')
const encoder = fs.readFileSync('lib/qzEscPosBitImage.ts', 'utf8')

assert.match(orderSheet, /const shareCardRef = useRef<HTMLDivElement>\(null\)/)
assert.match(orderSheet, /<OrderShareCard ref=\{shareCardRef\}/)
assert.match(orderSheet, /const mountedReceipt = shareCardRef\.current/)
assert.match(orderSheet, /renderMountedOrderShareCardToEscPosRaw\(mountedReceipt, \{\s*trace:/)

const cloudBranchStart = orderSheet.indexOf("if (printPath === 'CLOUD_RELAY')")
const browserBranchStart = orderSheet.indexOf("if (printPath === 'BROWSER')")
const cloudBranch = orderSheet.slice(cloudBranchStart, browserBranchStart)
assert.ok(cloudBranchStart >= 0 && browserBranchStart > cloudBranchStart)
assert.match(cloudBranch, /renderMountedOrderShareCardToEscPosRaw/)
assert.doesNotMatch(cloudBranch, /renderTicketHtmlToEscPosRaw/)

assert.equal(
  (orderSheet.match(/renderTicketHtmlToEscPosRaw\(html\)/g) ?? []).length,
  1,
  'ES-TRAY-01 must retain its existing HTML/iframe renderer call',
)
assert.match(orderSheet, /if \(printPath === 'BROWSER'\) \{\s*openExistingBrowserPrint\(html\)/)

assert.match(mountedRenderer, /html2canvas\(ticket, \{\s*scale: 2,\s*useCORS: true,\s*backgroundColor: '#fff',\s*logging: false/)
assert.match(orderSheet, /html2canvas\(shareCardRef\.current, \{\s*scale: 2,\s*useCORS: true,\s*backgroundColor: '#fff',\s*logging: false/)
assert.match(mountedRenderer, /encodeRgbaToEscPosEscStar24/)
assert.match(mountedRenderer, /QZ_RAW_PRINTABLE_WIDTH_PX/)
assert.match(encoder, /export function encodeRgbaToEscPosEscStar24/)

assert.doesNotMatch(mountedRenderer, /iframe|srcdoc|DOMParser|Promise\.race|setTimeout|retry|fallback/i)
assert.match(htmlRenderer, /frame\.setAttribute\('sandbox', 'allow-same-origin'\)/)
assert.match(htmlRenderer, /export async function renderTicketHtmlToEscPosRaw/)

console.log('ES-TRAY-02 mounted DOM compatibility tests passed')

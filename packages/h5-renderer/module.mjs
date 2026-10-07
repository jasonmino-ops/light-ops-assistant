import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = path.dirname(fileURLToPath(import.meta.url))
export const sha = b => createHash('sha256').update(b).digest('hex')
export const LIMITS = Object.freeze({ input: 128 * 1024, items: 100, name: 512, spec: 512, sugar: 128, storeName: 128, tableNo: 128, remark: 2048, deadlineMs: 20_000 })
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function validateRenderInput(input) {
  if (!input || Object.keys(input).sort().join(',') !== 'deadlineAt,orderNo,profileId,role,schemaVersion,snapshotHash,snapshotJson,storeId,tenantId') throw Error('RENDER_INPUT_FIELDS')
  if (typeof input.snapshotJson !== 'string' || Buffer.byteLength(input.snapshotJson) > LIMITS.input || sha(input.snapshotJson) !== input.snapshotHash) throw Error('RENDER_SNAPSHOT_INTEGRITY')
  if (!/^[a-f0-9]{64}$/.test(input.profileId) || input.schemaVersion !== 3 || !['KITCHEN', 'FRONT'].includes(input.role)) throw Error('RENDER_IDENTITY')
  const s = JSON.parse(input.snapshotJson)
  if (s.tenantId !== input.tenantId || s.storeId !== input.storeId || s.orderNo !== input.orderNo) throw Error('RENDER_IDENTITY')
  if (!Number.isFinite(Date.parse(input.deadlineAt)) || Date.parse(input.deadlineAt) <= Date.now()) throw Error('RENDER_EXPIRED')
  for (const key of ['storeName', 'tableNo', 'remark']) if (s[key] != null && (typeof s[key] !== 'string' || [...s[key]].length > LIMITS[key])) throw Error('RENDER_FIELD_LIMIT:' + key)
  if (typeof s.storeName !== 'string' || !/^[A-Z]{3}$/.test(s.currencyCode) || !Number.isFinite(s.totalAmount) || s.totalAmount < 0 || s.totalAmount > 1e12) throw Error('RENDER_ORDER_INVALID')
  if (!Array.isArray(s.items) || !s.items.length || s.items.length > LIMITS.items) throw Error('RENDER_ITEMS_LIMIT')
  for (const i of s.items) {
    for (const key of ['name', 'spec', 'sugar']) if (i[key] != null && (typeof i[key] !== 'string' || [...i[key]].length > LIMITS[key])) throw Error('RENDER_FIELD_LIMIT:' + key)
    if (typeof i.name !== 'string') throw Error('RENDER_ITEM_NAME')
    for (const key of ['price', 'quantity', 'lineAmount']) if (!Number.isFinite(i[key]) || i[key] < 0 || i[key] > 1e12) throw Error('RENDER_NUMBER_INVALID')
    if (!Number.isInteger(i.quantity) || i.quantity < 1) throw Error('RENDER_QUANTITY')
  }
  if (input.role === 'FRONT' && (s.paymentStatus !== 'PAID' || !['CASH', 'QR'].includes(s.paymentMethod) || !Number.isFinite(Date.parse(s.paidAt)))) throw Error('RENDER_FRONT_PAYMENT_REQUIRED')
  if (input.role === 'KITCHEN' && (s.paymentStatus !== 'UNPAID' || s.paymentMethod !== null || !s.items.some(i => i.printKitchenTicket === true))) throw Error('RENDER_KITCHEN_SNAPSHOT')
  if (!Number.isFinite(Date.parse(s.createdAt))) throw Error('RENDER_DATE')
  return s
}

/** Escaped data only, never a caller-provided document/template/URL. */
export function ticketHtml(input, css) {
  const s = validateRenderInput(input)
  const kitchen = input.role === 'KITCHEN'
  const items = kitchen ? s.items.filter(i => i.printKitchenTicket === true) : s.items
  const money = n => `${esc(s.currencyCode)} ${n.toFixed(2)}`
  return `<!doctype html><html lang="km"><head><meta charset="utf-8"><style>${css}</style></head><body><main class="ticket">
<div class="store center">${esc(s.storeName)}</div><div class="title center">${kitchen ? 'KITCHEN 制作单' : 'FRONT 收款凭证'}</div>
<div class="status">${kitchen ? 'UNPAID · 未付款' : 'PAID · 已收款'}</div>
<section class="meta"><div class="row"><span>订单 / Order</span><span>${esc(s.orderNo)}</span></div><div class="row"><span>桌号 / Table</span><span>${esc(s.tableNo)}</span></div><div class="row"><span>${kitchen ? '订单时间' : '实收时间'}</span><span>${esc(kitchen ? s.createdAt : s.paidAt)} UTC</span></div></section><div class="line"></div>
${items.map(i => `<section class="item"><div class="name">${esc(i.name)}</div>${i.spec || i.sugar ? `<div class="note small">${esc([i.spec, i.sugar].filter(Boolean).join(' / '))}</div>` : ''}<div class="calc">${i.quantity} × ${money(i.price)} = ${money(i.lineAmount)}</div></section>`).join('')}
<div class="row total"><span>${kitchen ? '订单总额' : '合计 / Total'}</span><span>${money(s.totalAmount)}</span></div>
${kitchen ? '<div class="small">制作依据，不是收款凭证 / NOT A PAYMENT RECEIPT</div>' : `<div class="status">付款方式 / Payment: ${s.paymentMethod === 'QR' ? 'KHQR' : 'CASH'}</div>`}
<div class="line"></div><div class="note">备注 / Note\n${esc(s.remark)}</div></main></body></html>`
}

export function verifyArtifact(directory = root) {
  const manifestBytes = fs.readFileSync(path.join(directory, 'profile.json'))
  const profileId = sha(manifestBytes)
  if (fs.readFileSync(path.join(directory, 'profile.sha256'), 'utf8').trim() !== profileId) throw Error('PROFILE_MANIFEST_HASH')
  const profile = JSON.parse(manifestBytes)
  for (const [relative, expected] of Object.entries(profile.files)) {
    if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw Error('PROFILE_PATH')
    const file = path.join(directory, relative)
    if (fs.lstatSync(file).isSymbolicLink() || sha(fs.readFileSync(file)) !== expected) throw Error('ARTIFACT_HASH:' + relative)
  }
  if (process.platform !== profile.environment.os || process.arch !== profile.environment.arch || process.version !== profile.environment.node) throw Error('RENDER_ENVIRONMENT_MISMATCH')
  if (process.getuid?.() === 0) throw Error('RENDER_ROOT_FORBIDDEN')
  return { ...profile, profileId }
}

export async function createRenderer() {
  const profile = verifyArtifact()
  // Verified POC host is packaged verbatim. Its browser path, network blocking,
  // sandbox flag, font checks and pre-raster pixel budget remain intact.
  const host = await import('./secure-renderer.mjs')
  const templates = await import('./tickets.mjs')
  const { browser, metrics } = await host.launchSandbox()
  try {
    const sample = await host.render(browser, host.secureHtml(templates.typographyHtml))
    if (sample.sha256 !== profile.startupReference.rawSha256) throw Error('RENDER_STARTUP_REFERENCE_MISMATCH')
    return { profileId: profile.profileId, metrics, startup: { byteLength: sample.byteLength, payloadHash: sample.sha256 },
      async render(input) {
        if (input.profileId !== profile.profileId) throw Error('RENDER_PROFILE_MISMATCH')
        const html = host.secureHtml(ticketHtml(input, templates.css))
        const result = await host.render(browser, html, { deadline: Math.min(LIMITS.deadlineMs, Date.parse(input.deadlineAt) - Date.now()) })
        return { payloadBase64: result.raw.toString('base64'), byteLength: result.byteLength, payloadHash: result.sha256,
          rendererVersion: profile.profileId, profileId: profile.profileId, elapsedMs: result.untilBytesMs }
      }, close: () => browser.close() }
  } catch (error) { await browser.close(); throw error }
}

import { ipcRenderer } from 'electron'
import { renderDesktopReceiptHtml } from '../../app/components/DesktopReceipt'
import { getKitchenTicketHtmlForTest } from '../../app/components/KitchenTicket'
import { renderTicketHtmlToEscPosRaw } from '../../lib/qzHtmlBitmapRenderer'
import { NETWORK_MAX_BYTES, exactObject, parseNetworkRequest } from './networkContract'

// Bundled, sandboxed, local-only DOM adapter. No credentials, endpoints or Node TCP API.
let busy = false
ipcRenderer.on('network:render', async (_event, value: unknown) => {
  if (busy) return
  let renderId: string | undefined
  try {
    const message = exactObject(value, ['renderId', 'request'])
    if (typeof message.renderId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.renderId)) return
    renderId = message.renderId
    busy = true
    const request = parseNetworkRequest(message.request)
    const { lang, ...order } = request.order
    const html = request.role === 'FRONT'
      ? renderDesktopReceiptHtml(order, lang)
      : getKitchenTicketHtmlForTest({
        storeName: order.storeName, orderNo: order.orderNo, createdAt: order.createdAt,
        items: order.items.map(({ name, spec, qty }) => ({ name, spec, qty })),
      }, lang)
    const bytes = await renderTicketHtmlToEscPosRaw(html)
    if (!bytes.byteLength || bytes.byteLength > NETWORK_MAX_BYTES) throw new Error('NETWORK_RENDER_SIZE')
    ipcRenderer.send('network:rendered', { renderId, bytes })
  } catch {
    if (renderId) ipcRenderer.send('network:rendered', { renderId, error: 'NETWORK_RENDER_FAILED' })
  } finally { busy = false }
})

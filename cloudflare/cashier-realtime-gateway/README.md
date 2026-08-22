# Cashier Realtime Gateway

Standalone Cloudflare Worker + Durable Object skeleton for store-scoped, wake-only Cashier events.

It is not connected to current order routes or `app/cashier/page.tsx`. The existing E-Shop APIs remain the source of truth.

## Security boundaries

- Browser WebSockets use a five-minute ticket issued by `POST /api/cashier-realtime/ticket`.
- The ticket is sent as a WebSocket subprotocol, not in the URL.
- The Worker derives `v1:<tenantId>:<storeId>` only from verified claims.
- Server notify uses a separate HMAC secret, timestamp and replay-protected event ID.
- Only `orders_changed` and `pending_orders_changed` are accepted.
- Durable Objects retain only WebSocket attachment metadata and a bounded replay ledger; no order data is stored.

## Local-only setup

Copy `.dev.vars.example` to an untracked `.dev.vars`, replace both secrets, and keep the two values different. Configure matching E-Shop development variables:

- `CASHIER_REALTIME_GATEWAY_URL`
- `CASHIER_REALTIME_TICKET_SECRET`
- `CASHIER_REALTIME_NOTIFY_SECRET`

No Cloudflare resource or production traffic is created by this source tree alone. A future reviewed deployment must configure production allowed origins and secrets before creating the Worker/DO resources.

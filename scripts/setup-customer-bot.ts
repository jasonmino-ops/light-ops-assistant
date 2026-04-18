/**
 * 一次性配置 @Eshop_sale_bot 脚本
 *
 * 执行后完成两件事：
 *   1. 向 Telegram 注册 Webhook（POST /api/webhook/customer）
 *   2. 设置机器人 Mini App 菜单按钮（资料页/聊天底部"打开"按钮）
 *
 * 用法：
 *   npx tsx scripts/setup-customer-bot.ts
 *
 * 依赖的 .env 变量：
 *   CUSTOMER_BOT_TOKEN    — @Eshop_sale_bot 的 token
 *   NEXT_PUBLIC_APP_URL   — 生产域名，如 https://xxx.vercel.app
 *   CUSTOMER_WEBHOOK_SECRET — 可选，webhook 安全密钥
 *   DEFAULT_STORE_CODE    — 默认 STORE-A
 */

import 'dotenv/config'

const BOT_TOKEN     = process.env.CUSTOMER_BOT_TOKEN ?? ''
const APP_URL       = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
const STORE_CODE    = process.env.DEFAULT_STORE_CODE ?? 'STORE-A'
const WEBHOOK_SECRET = process.env.CUSTOMER_WEBHOOK_SECRET ?? ''

async function tg(method: string, body: object) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function main() {
  if (!BOT_TOKEN) { console.error('❌  CUSTOMER_BOT_TOKEN 未设置'); process.exit(1) }
  if (!APP_URL)   { console.error('❌  NEXT_PUBLIC_APP_URL 未设置'); process.exit(1) }

  const menuUrl    = `${APP_URL}/menu?code=${encodeURIComponent(STORE_CODE)}`
  const webhookUrl = `${APP_URL}/api/webhook/customer`

  console.log(`\n菜单页：${menuUrl}`)
  console.log(`Webhook：${webhookUrl}\n`)

  // 1. 注册 Webhook
  const r1 = await tg('setWebhook', {
    url: webhookUrl,
    ...(WEBHOOK_SECRET ? { secret_token: WEBHOOK_SECRET } : {}),
  })
  console.log('setWebhook      →', JSON.stringify(r1))

  // 2. 设置 Mini App 菜单按钮（资料页和聊天界面的固定入口）
  const r2 = await tg('setChatMenuButton', {
    menu_button: {
      type: 'web_app',
      text: '🛍️ 查看商品',
      web_app: { url: menuUrl },
    },
  })
  console.log('setChatMenuButton →', JSON.stringify(r2))

  if (r1.ok && r2.ok) {
    console.log('\n✅  配置完成。用户打开 @Eshop_sale_bot 时会看到底部"查看商品"按钮，点击直接进入顾客商品页。')
  } else {
    console.log('\n⚠️  部分操作失败，请检查上方输出。')
  }
}

main().catch(console.error)

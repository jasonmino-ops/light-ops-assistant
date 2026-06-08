/**
 * lib/bot/handlers/business.ts — 第一层：业务问题处理器。
 *
 * 全部基于本系统数据（Prisma），不调 LLM。订单状态/优惠券/菜单链接走结构化，
 * 其余槽位（HOURS / ADDRESS / DELIVERY / PRODUCT / PRICE）暂用模板提示 + 菜单深链。
 */
import { prisma } from '@/lib/prisma'
import type { Lang, BizSlot } from '../intent'
import { TPL, fill } from '../templates'
import { publicUrl } from '@/lib/public-url'

function menuUrl(storeCode: string): string {
  return publicUrl(`/menu?code=${encodeURIComponent(storeCode)}`)
}
function couponUrl(storeCode: string): string {
  return publicUrl(`/me/coupons?code=${encodeURIComponent(storeCode)}`)
}
function myOrdersUrl(storeCode: string): string {
  return publicUrl(`/menu/orders?code=${encodeURIComponent(storeCode)}`)
}

function shortOrderNo(orderNo: string): string {
  const seg = orderNo.split('-').pop() ?? orderNo
  return `#${seg.slice(-6) || seg}`
}

// 从文本提取可能的订单号片段：优先 #xxxx，其次连续 ≥4 位数字/字母
function extractOrderHint(text: string): string | null {
  const m1 = text.match(/#([A-Za-z0-9-]{3,40})/)
  if (m1) return m1[1]
  const m2 = text.match(/([A-Za-z0-9]{4,40})/)
  return m2 ? m2[1] : null
}

export type BizCtx = {
  text:        string
  lang:        Lang
  storeCode:   string
  storeName:   string
  tenantId:    string
  telegramId:  string | null
}

export async function businessReply(slot: BizSlot, ctx: BizCtx): Promise<string> {
  const { lang, storeCode, tenantId, telegramId, text } = ctx

  switch (slot) {
    case 'ORDER_STATUS': {
      if (!telegramId) {
        return fill(TPL.business.ORDER_STATUS_NEED_NO[lang], {})
      }
      const hint = extractOrderHint(text)
      if (!hint) {
        return fill(TPL.business.ORDER_STATUS_NEED_NO[lang], {})
      }
      const order = await prisma.customerOrder.findFirst({
        where: {
          tenantId,
          customerTelegramId: telegramId,
          orderNo: { endsWith: hint },
        },
        orderBy: { createdAt: 'desc' },
        select: { orderNo: true, status: true, totalAmount: true },
      }).catch(() => null)
      if (!order) {
        return fill(TPL.business.ORDER_STATUS_NOT_FOUND[lang], { url: myOrdersUrl(storeCode) })
      }
      const phrase = TPL.business.STATUS_PHRASE[order.status as keyof typeof TPL.business.STATUS_PHRASE]
      const statusText = phrase ? phrase[lang] : order.status
      const total = order.totalAmount.toNumber().toFixed(2)
      return `📋 ${shortOrderNo(order.orderNo)}\n${statusText}\n💰 ${lang === 'en' ? 'Total' : lang === 'km' ? 'ចំនួន' : '金额'}: $${total}`
    }
    case 'COUPON':
      return fill(TPL.business.COUPON_HINT[lang], { url: couponUrl(storeCode) })
    case 'MENU_LINK':
      return fill(TPL.business.MENU_LINK[lang], { url: menuUrl(storeCode) })
    case 'HOURS':
      return fill(TPL.business.HOURS_HINT[lang], { url: menuUrl(storeCode) })
    case 'ADDRESS':
      return fill(TPL.business.ADDRESS_HINT[lang], { url: menuUrl(storeCode) })
    case 'DELIVERY':
      return fill(TPL.business.DELIVERY_HINT[lang], { url: menuUrl(storeCode) })
    case 'PRODUCT':
    case 'PRICE':
      return fill(TPL.business.PRODUCT_HINT[lang], { url: menuUrl(storeCode) })
  }
}

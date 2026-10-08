import { after, NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getContext } from '@/lib/context'
import { sendAndLogMessage } from '@/lib/telegram'
import { notifyCashierGateway } from '@/lib/cashier-realtime-notify'
import {
  CUSTOMER_ORDER_ACTOR_TYPE,
  customerOrderKitchenDisposition,
  customerOrderPaymentIntentData,
  cancelCustomerOrderKitchenIntent,
  customerOrderPrintReceipt,
  paymentIntentMethod,
  printOrderFromCustomerOrder,
  recordCustomerOrderIntent,
} from '@/lib/customer-order-fulfillment'

/**
 * PATCH /api/customer-orders/[id]
 *
 * 更新顾客订单状态。OWNER 和 STAFF 均可操作。
 * 允许的状态流转：
 *   PENDING   → CONFIRMED | CANCELLED
 *   CONFIRMED → COMPLETED | CANCELLED
 */

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING:   ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED'],
}

const STATUS_LABELS: Record<string, string> = {
  CONFIRMED: '已确认',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

type Lang = 'zh' | 'en' | 'km'

function normalizeLang(v: string | null | undefined): Lang {
  const s = (v ?? '').toLowerCase()
  if (s === 'zh' || s.startsWith('zh-') || s.startsWith('zh_')) return 'zh'
  if (s === 'en' || s.startsWith('en-') || s.startsWith('en_')) return 'en'
  if (s === 'km' || s.startsWith('km-') || s.startsWith('kh') || s === 'km_kh') return 'km'
  return 'zh'
}

function shortOrderNo(orderNo: string): string {
  // 取末段（C-YYYYMMDD-STORE-####）的最后一段；不足则取末 4 位
  const seg = orderNo.split('-').pop() ?? orderNo
  return `#${seg.slice(-6) || seg}`
}

function isPaymentIntentOrderNoConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false
  const meta = error.meta && typeof error.meta === 'object' ? error.meta as Record<string, unknown> : null
  if (meta?.modelName === 'PaymentIntent') return true
  const target = Array.isArray(meta?.target) ? meta.target.map(String) : []
  return target.includes('orderNo')
}

function kitchenCancellationEvidence(intent: { cancelResultCode?: string | null; state?: string | null; manualReviewReason?: string | null } | null): string | null {
  if (!intent) return null
  if (intent.cancelResultCode) return intent.cancelResultCode
  if (intent.state === 'EXPIRED') return 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED'
  if (intent.state === 'MANUAL_REVIEW') return intent.manualReviewReason ?? 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION'
  return null
}

type TplCtx = { no: string; total: string }

// 卡片式四行排版：
//   行 1：📋 您的订单 #XXXX
//   行 2：状态短语 + emoji（视觉重点）
//   行 3：补充说明（可选，OUT_FOR_DELIVERY/CANCELLED 简化）
//   行 4：💰 金额：$X.XX（OUT_FOR_DELIVERY 与 CANCELLED 不展示金额）
const STATUS_MSG: Record<string, Record<Lang, (c: TplCtx) => string>> = {
  PENDING: {
    zh: ({ no, total }) => `📋 您的订单 ${no}\n正在处理中 ✨\n请稍候，我们正在为您安排 ❤️\n💰 金额：$${total}`,
    en: ({ no, total }) => `📋 Your order ${no}\nBeing prepared ✨\nPlease hold on, we're arranging it for you ❤️\n💰 Total: $${total}`,
    km: ({ no, total }) => `📋 ការបញ្ជាទិញរបស់អ្នក ${no}\nកំពុងដំណើរការ ✨\nសូមរង់ចាំបន្តិច យើងកំពុងរៀបចំជូន ❤️\n💰 ចំនួន: $${total}`,
  },
  CONFIRMED: {
    zh: ({ no, total }) => `📋 您的订单 ${no}\n正在处理中 ✨\n请稍候，我们正在为您安排 ❤️\n💰 金额：$${total}`,
    en: ({ no, total }) => `📋 Your order ${no}\nBeing prepared ✨\nPlease hold on, we're arranging it for you ❤️\n💰 Total: $${total}`,
    km: ({ no, total }) => `📋 ការបញ្ជាទិញរបស់អ្នក ${no}\nកំពុងដំណើរការ ✨\nសូមរង់ចាំបន្តិច យើងកំពុងរៀបចំជូន ❤️\n💰 ចំនួន: $${total}`,
  },
  READY: {
    zh: ({ no, total }) => `📋 您的订单 ${no}\n已准备完成 🎉\n感谢您的支持\n💰 金额：$${total}`,
    en: ({ no, total }) => `📋 Your order ${no}\nReady 🎉\nThank you for your support\n💰 Total: $${total}`,
    km: ({ no, total }) => `📋 ការបញ្ជាទិញរបស់អ្នក ${no}\nបានរៀបចំរួចរាល់ 🎉\nសូមអរគុណចំពោះការគាំទ្រ\n💰 ចំនួន: $${total}`,
  },
  COMPLETED: {
    zh: ({ no, total }) => `📋 您的订单 ${no}\n已准备完成 🎉\n感谢您的支持\n💰 金额：$${total}`,
    en: ({ no, total }) => `📋 Your order ${no}\nReady 🎉\nThank you for your support\n💰 Total: $${total}`,
    km: ({ no, total }) => `📋 ការបញ្ជាទិញរបស់អ្នក ${no}\nបានរៀបចំរួចរាល់ 🎉\nសូមអរគុណចំពោះការគាំទ្រ\n💰 ចំនួន: $${total}`,
  },
  OUT_FOR_DELIVERY: {
    zh: ({ no }) => `📋 您的订单 ${no}\n正在赶来 🚀\n请注意查收`,
    en: ({ no }) => `📋 Your order ${no}\nOn the way 🚀\nPlease be ready to receive it`,
    km: ({ no }) => `📋 ការបញ្ជាទិញរបស់អ្នក ${no}\nកំពុងដឹកមកដល់ 🚀\nសូមត្រៀមទទួល`,
  },
  CANCELLED: {
    zh: ({ no }) => `📋 您的订单 ${no}\n未能完成 🙏\n请联系商家获取帮助`,
    en: ({ no }) => `📋 Your order ${no}\nCould not be completed 🙏\nPlease contact the merchant for help`,
    km: ({ no }) => `📋 ការបញ្ជាទិញរបស់អ្នក ${no}\nមិនអាចបញ្ចប់បាន 🙏\nសូមទាក់ទងហាងសម្រាប់ជំនួយ`,
  },
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req)
  if (!ctx) return NextResponse.json({ error: 'MISSING_CONTEXT' }, { status: 401 })

  const { id } = await params

  let body: { status?: string; paymentMethod?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 })
  }

  // ── 分支 A：收款登记 ────────────────────────────────────────────────────────
  if (body.paymentMethod) {
    const { paymentMethod: rawPaymentMethod } = body
    if (!['CASH', 'QR'].includes(rawPaymentMethod)) {
      return NextResponse.json({ error: 'INVALID_PAYMENT_METHOD' }, { status: 400 })
    }
    const paymentMethod = rawPaymentMethod as 'CASH' | 'QR'
    let paid: {
      kind: 'PAID'
      order: any
      paidAt: Date
      paymentMethod: 'CASH' | 'QR'
    } | { kind: 'NOT_FOUND' | 'ORDER_NOT_COMPLETED' | 'PAYMENT_INTENT_CONFLICT' | 'PAYMENT_RECORD_MISSING' }

    try {
      paid = await prisma.$transaction(async (tx) => {
        const scope = {
          id,
          tenantId: ctx.tenantId,
          ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}),
        }
        const order = await tx.customerOrder.findFirst({ where: scope })
        if (!order) return { kind: 'NOT_FOUND' as const }
        if (order.status !== 'COMPLETED') return { kind: 'ORDER_NOT_COMPLETED' as const }
        const storeForIntent = await tx.store.findFirst({
          where: { id: order.storeId, tenantId: order.tenantId },
          select: { name: true, currencyCode: true },
        })
        if (!storeForIntent) return { kind: 'PAYMENT_RECORD_MISSING' as const }

        const expectedMethod = paymentIntentMethod(paymentMethod)
        const expectedStoreId = order.storeId, expectedOrderNo = order.orderNo
        // At READ COMMITTED, an earlier UNPAID read can precede another
        // collector's commit. A zero-row update is not itself missing payment
        // evidence: re-read the committed fact, without writing a second one.
        async function readCommittedPayment() {
          const current = await tx.customerOrder.findFirst({ where: scope })
          if (!current) return { kind: 'NOT_FOUND' as const }
          if (current.status !== 'COMPLETED') return { kind: 'ORDER_NOT_COMPLETED' as const }
          if (current.paymentStatus !== 'PAID' || !current.paidAt || !current.paidAmount) {
            return { kind: 'PAYMENT_RECORD_MISSING' as const }
          }
          const currentPi = await tx.paymentIntent.findUnique({ where: { orderNo: current.orderNo } })
          if (!currentPi) return { kind: 'PAYMENT_RECORD_MISSING' as const }
          const sameCommittedPayment = current.storeId === expectedStoreId
            && current.orderNo === expectedOrderNo
            && current.paymentMethod === paymentMethod
            && current.transactionActorType === CUSTOMER_ORDER_ACTOR_TYPE
            && current.transactionActorId === current.id
            && current.paidAmount.equals(current.totalAmount)
            && currentPi.tenantId === current.tenantId
            && currentPi.storeId === current.storeId
            && currentPi.transactionActorType === CUSTOMER_ORDER_ACTOR_TYPE
            && currentPi.transactionActorId === current.id
            && currentPi.paymentMethod === expectedMethod
            && currentPi.amount.equals(current.totalAmount)
            && currentPi.status === 'PAID'
            && currentPi.paidAt?.getTime() === current.paidAt.getTime()
          if (!sameCommittedPayment) return { kind: 'PAYMENT_INTENT_CONFLICT' as const }
          const front = await tx.customerOrderFulfillmentIntent.findUnique({
            where: { tenantId_storeId_orderNo_role: { tenantId: current.tenantId, storeId: current.storeId, orderNo: current.orderNo, role: 'FRONT' } },
          })
          if (!front) return { kind: 'PAYMENT_RECORD_MISSING' as const }
          if (front.source !== 'H5_HOME' || front.paymentIntentId !== currentPi.id) {
            return { kind: 'PAYMENT_INTENT_CONFLICT' as const }
          }
          return { kind: 'PAID' as const, order: current, paidAt: current.paidAt, paymentMethod }
        }
        const existingPi = await tx.paymentIntent.findUnique({ where: { orderNo: order.orderNo } })
        if (existingPi) {
          const sameH5Payment = existingPi.tenantId === order.tenantId
            && existingPi.storeId === order.storeId
            && existingPi.transactionActorType === CUSTOMER_ORDER_ACTOR_TYPE
            && existingPi.transactionActorId === order.id
            && existingPi.paymentMethod === expectedMethod
            && existingPi.amount.toString() === order.totalAmount.toString()
          if (!sameH5Payment || existingPi.status !== 'PAID' || !existingPi.paidAt) {
            return { kind: 'PAYMENT_INTENT_CONFLICT' as const }
          }
          if (order.paymentStatus === 'PAID') {
            if (order.paymentMethod !== paymentMethod) return { kind: 'PAYMENT_INTENT_CONFLICT' as const }
            return { kind: 'PAID' as const, order, paidAt: existingPi.paidAt, paymentMethod }
          }
          const repaired = await tx.customerOrder.updateMany({
            where: { ...scope, paymentStatus: 'UNPAID' },
            data: {
              paymentStatus: 'PAID',
              paymentMethod,
              paidAt: existingPi.paidAt,
              paidAmount: order.totalAmount,
              transactionActorType: CUSTOMER_ORDER_ACTOR_TYPE,
              transactionActorId: order.id,
              authorizedByUserId: ctx.userId,
            },
          })
          if (repaired.count !== 1) return readCommittedPayment()
          const printOrder = printOrderFromCustomerOrder({
            tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo,
            storeName: storeForIntent.name, currencyCode: storeForIntent.currencyCode,
            createdAt: order.createdAt, paidAt: existingPi.paidAt, tableNo: order.tableNo,
            remark: order.remark, totalAmount: order.totalAmount, paymentStatus: 'PAID',
            paymentMethod, itemsJson: order.itemsJson,
          })
          const existingFrontIntent = await tx.customerOrderFulfillmentIntent.findUnique({
            where: { tenantId_storeId_orderNo_role: { tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo, role: 'FRONT' } },
          })
          if (!existingFrontIntent) {
            await recordCustomerOrderIntent(tx, printOrder, 'FRONT', 'REQUIRED', existingPi.paidAt, existingPi.id)
          } else if (existingFrontIntent.source !== 'H5_HOME' || existingFrontIntent.paymentIntentId !== existingPi.id) {
            return { kind: 'PAYMENT_INTENT_CONFLICT' as const }
          }
          return {
            kind: 'PAID' as const,
            order: { ...order, paymentStatus: 'PAID', paymentMethod, paidAt: existingPi.paidAt },
            paidAt: existingPi.paidAt,
            paymentMethod,
          }
        }

        if (order.paymentStatus === 'PAID') return { kind: 'PAYMENT_RECORD_MISSING' as const }
        const paidAt = new Date()
        const changed = await tx.customerOrder.updateMany({
          where: { ...scope, status: 'COMPLETED', paymentStatus: 'UNPAID' },
          data: {
            paymentStatus: 'PAID',
            paymentMethod,
            paidAt,
            paidAmount: order.totalAmount,
            transactionActorType: CUSTOMER_ORDER_ACTOR_TYPE,
            transactionActorId: order.id,
            authorizedByUserId: ctx.userId,
          },
        })
        if (changed.count !== 1) {
          return readCommittedPayment()
        }

        const paymentIntent = await tx.paymentIntent.create({
          data: customerOrderPaymentIntentData({
            tenantId: order.tenantId,
            storeId: order.storeId,
            operatorUserId: ctx.userId,
            orderNo: order.orderNo,
            orderId: order.id,
            amount: order.totalAmount.toString(),
            paymentMethod,
            paidAt,
          }) as any,
        })
        const printOrder = printOrderFromCustomerOrder({
          tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo,
          storeName: storeForIntent.name, currencyCode: storeForIntent.currencyCode,
          createdAt: order.createdAt, paidAt, tableNo: order.tableNo, remark: order.remark,
          totalAmount: order.totalAmount, paymentStatus: 'PAID', paymentMethod, itemsJson: order.itemsJson,
        })
        await recordCustomerOrderIntent(tx, printOrder, 'FRONT', 'REQUIRED', paidAt, paymentIntent.id)
        return {
          kind: 'PAID' as const,
          order: { ...order, paymentStatus: 'PAID', paymentMethod, paidAt },
          paidAt,
          paymentMethod,
        }
      })
    } catch (error) {
      // A concurrent request may win the PaymentIntent orderNo unique key.
      // Re-read only after the transaction has rolled back; never continue in
      // an aborted transaction.
      if (isPaymentIntentOrderNoConflict(error)) {
        const current = await prisma.customerOrder.findFirst({
          where: { id, tenantId: ctx.tenantId, ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}) },
        })
        if (current?.paymentStatus === 'PAID' && current.paymentMethod === paymentMethod) {
          paid = { kind: 'PAID', order: current, paidAt: current.paidAt ?? new Date(), paymentMethod }
        } else throw error
      } else throw error
    }

    if (paid.kind !== 'PAID') {
      const status = paid.kind === 'NOT_FOUND' ? 404 : paid.kind === 'ORDER_NOT_COMPLETED' ? 400 : 409
      return NextResponse.json({ error: paid.kind }, { status })
    }

    const print = await customerOrderPrintReceipt(prisma as any, paid.order, "FRONT")

    return NextResponse.json({
      id: paid.order.id,
      orderNo: paid.order.orderNo,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      paymentMethod: paid.paymentMethod,
      businessStatus: 'SUCCEEDED',
      printStatus: print.status,
      printCreated: print.created,
    })
  }

  // ── 分支 B：状态流转 ────────────────────────────────────────────────────────
  const { status: newStatus } = body
  if (!newStatus) return NextResponse.json({ error: 'MISSING_ACTION' }, { status: 400 })

  const result = await prisma.$transaction(async (tx) => {
    const scope = {
      id,
      tenantId: ctx.tenantId,
      ...(ctx.role === 'STAFF' ? { storeId: ctx.storeId } : {}),
    }
    const order = await tx.customerOrder.findFirst({ where: scope })
    if (!order) return { kind: 'NOT_FOUND' as const }
    const store = await tx.store.findFirst({
      where: { id: order.storeId, tenantId: order.tenantId },
      select: { name: true, currencyCode: true, printKitchenTicket: true },
    })
    if (!store) return { kind: 'STORE_NOT_FOUND' as const, order }
    const allowed = ALLOWED_TRANSITIONS[order.status] ?? []
    if (!allowed.includes(newStatus)) {
      if (order.status === newStatus) {
        const kitchenIntent = newStatus === 'CONFIRMED' || newStatus === 'CANCELLED'
          ? await tx.customerOrderFulfillmentIntent.findUnique({
              where: { tenantId_storeId_orderNo_role: { tenantId: order.tenantId, storeId: order.storeId, orderNo: order.orderNo, role: 'KITCHEN' } },
            })
          : null
        return {
          kind: 'IDEMPOTENT' as const,
          order,
          store,
          kitchenDecision: kitchenIntent?.decision ?? null,
          kitchenIntentId: kitchenIntent?.id ?? null,
          kitchenCancelCode: kitchenCancellationEvidence(kitchenIntent),
        }
      }
      return { kind: 'INVALID_TRANSITION' as const, order }
    }

    const changed = await tx.customerOrder.updateMany({
      where: { ...scope, status: order.status },
      data: { status: newStatus },
    })
    if (changed.count !== 1) {
      const current = await tx.customerOrder.findFirst({ where: scope })
      return current?.status === newStatus
        ? {
            kind: 'IDEMPOTENT' as const,
            order: current,
            store,
            kitchenDecision: newStatus === 'CONFIRMED'
              ? (await tx.customerOrderFulfillmentIntent.findUnique({
                  where: { tenantId_storeId_orderNo_role: { tenantId: current.tenantId, storeId: current.storeId, orderNo: current.orderNo, role: 'KITCHEN' } },
                }))?.decision ?? null
              : null,
            kitchenIntentId: newStatus === 'CONFIRMED'
              ? (await tx.customerOrderFulfillmentIntent.findUnique({
                  where: { tenantId_storeId_orderNo_role: { tenantId: current.tenantId, storeId: current.storeId, orderNo: current.orderNo, role: 'KITCHEN' } },
                }))?.id ?? null
              : null,
            kitchenCancelCode: newStatus === 'CANCELLED'
              ? kitchenCancellationEvidence(await tx.customerOrderFulfillmentIntent.findUnique({
                  where: { tenantId_storeId_orderNo_role: { tenantId: current.tenantId, storeId: current.storeId, orderNo: current.orderNo, role: 'KITCHEN' } },
                }))
              : null,
          }
        : { kind: 'INVALID_TRANSITION' as const, order: current ?? order }
    }
    const updatedOrder = { ...order, status: newStatus }
    let kitchenDecision: string | null = null
    let kitchenIntentId: string | null = null
    let kitchenCancelCode: string | null = null
    if (newStatus === 'CONFIRMED' || newStatus === 'CANCELLED') {
      const printOrder = printOrderFromCustomerOrder({
        tenantId: updatedOrder.tenantId,
        storeId: updatedOrder.storeId,
        orderNo: updatedOrder.orderNo,
        storeName: store.name,
        currencyCode: store.currencyCode,
        createdAt: updatedOrder.createdAt,
        paidAt: updatedOrder.paidAt,
        tableNo: updatedOrder.tableNo,
        remark: updatedOrder.remark,
        totalAmount: updatedOrder.totalAmount,
        paymentStatus: 'UNPAID',
        paymentMethod: null,
        itemsJson: updatedOrder.itemsJson,
      })
      if (newStatus === 'CONFIRMED') {
        kitchenDecision = customerOrderKitchenDisposition(printOrder, store.printKitchenTicket)
        const intent = await recordCustomerOrderIntent(tx, printOrder, 'KITCHEN', kitchenDecision as any, new Date())
        kitchenIntentId = intent.id
      } else {
        const cancelled = await cancelCustomerOrderKitchenIntent(tx, printOrder, new Date())
        kitchenCancelCode = cancelled.kind === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : cancelled.code ?? null
      }
    }
    return { kind: 'UPDATED' as const, order: updatedOrder, store, kitchenDecision, kitchenIntentId, kitchenCancelCode }
  })

  if (result.kind === 'NOT_FOUND') return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  if (result.kind === 'STORE_NOT_FOUND') return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404 })
  if (result.kind === 'INVALID_TRANSITION') {
    return NextResponse.json({ error: 'INVALID_TRANSITION', message: `不能从 ${result.order.status} 转为 ${newStatus}` }, { status: 400 })
  }

  const updated = result.order
  if (result.kind === 'UPDATED') {
    after(() => notifyCashierGateway({
      tenantId: updated.tenantId,
      storeId: updated.storeId,
      type: 'orders_changed',
    }))
  }

  let print: { status: string; created: boolean; printJobId: string | null; error?: string } = {
    status: 'NOT_REQUIRED', created: false, printJobId: null,
  }
  if (newStatus === 'CONFIRMED' && (result.kind === 'UPDATED' || result.kind === 'IDEMPOTENT')) {
    if (result.kitchenDecision === 'NOT_REQUIRED') {
      print = { status: 'NOT_REQUIRED', created: false, printJobId: null }
    } else if (result.kitchenDecision === 'MANUAL_REVIEW') {
      print = { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'CUSTOMER_ORDER_KITCHEN_ROUTE_MARKER_MISSING' }
    } else if (result.kitchenIntentId) {
      try {
        print = await customerOrderPrintReceipt(prisma as any, updated, 'KITCHEN')
      } catch (error) {
        // The order transition is already committed. A renderer/queue fault is
        // reported as print evidence, never as a false business failure.
        print = { status: 'FAILED', created: false, printJobId: null, error: error instanceof Error ? error.message : 'CUSTOMER_ORDER_PRINT_FAILED' }
      }
    }
  }
  if (newStatus === 'CANCELLED' && (result.kind === 'UPDATED' || result.kind === 'IDEMPOTENT')) {
    print = result.kitchenCancelCode === 'NOT_APPLICABLE'
      ? { status: 'NOT_APPLICABLE', created: false, printJobId: null }
      : result.kitchenCancelCode === 'NOT_REQUIRED' || result.kitchenCancelCode === 'CUSTOMER_ORDER_CANCELLED_BEFORE_CLAIM' || !result.kitchenCancelCode
      ? { status: 'NOT_REQUIRED', created: false, printJobId: null }
      : result.kitchenCancelCode === 'CUSTOMER_ORDER_FULFILLMENT_DEADLINE_EXPIRED'
      ? { status: 'EXPIRED', created: false, printJobId: null, error: result.kitchenCancelCode }
      : { status: 'MANUAL_REVIEW', created: false, printJobId: null, error: 'KITCHEN_TASK_REQUIRES_MANUAL_VERIFICATION' }
  }

  // 若顾客有 Telegram ID，异步发送状态变更通知（走顾客端机器人）
  if (result.kind === 'UPDATED' && updated.customerTelegramId) {
    // 语言决议：customerLang → StoreCustomerContact.telegramLanguageCode → 'zh'
    let lang: Lang | null = updated.customerLang ? normalizeLang(updated.customerLang) : null
    if (!lang) {
      const contact = await prisma.storeCustomerContact.findFirst({
        where: { tenantId: ctx.tenantId, telegramId: updated.customerTelegramId },
        select: { telegramLanguageCode: true },
      }).catch(() => null)
      lang = normalizeLang(contact?.telegramLanguageCode)
    }
    const tpl = STATUS_MSG[newStatus]
    const text = tpl ? tpl[lang]({
      no:    shortOrderNo(updated.orderNo),
      total: updated.totalAmount.toNumber().toFixed(2),
    }) : null
    if (text) {
      sendAndLogMessage({
        recipientTelegramId: updated.customerTelegramId,
        text,
        tenantId: ctx.tenantId,
        sentBy: 'SYSTEM',
        botToken: process.env.CUSTOMER_BOT_TOKEN,
      }).catch((e) => console.error('[customer-order] 通知顾客失败:', e))
    }
  }

  return NextResponse.json({
    id: updated.id,
    orderNo: updated.orderNo,
    status: updated.status,
    statusLabel: STATUS_LABELS[updated.status] ?? updated.status,
    businessStatus: 'SUCCEEDED',
    printStatus: print.status,
    printCreated: print.created,
  })
}

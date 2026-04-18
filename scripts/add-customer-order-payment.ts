/**
 * 为 CustomerOrder 表补充付款字段（原地迁移，支持 PgBouncer）
 *
 * 用法：npx tsx scripts/add-customer-order-payment.ts
 */

import 'dotenv/config'
import { prisma } from '../lib/prisma'

async function main() {
  console.log('添加 CustomerOrder 付款字段…')
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "CustomerOrder"
    ADD COLUMN IF NOT EXISTS "paymentStatus" VARCHAR(20) NOT NULL DEFAULT 'UNPAID',
    ADD COLUMN IF NOT EXISTS "paymentMethod" VARCHAR(20),
    ADD COLUMN IF NOT EXISTS "paidAt"        TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "paidAmount"    DECIMAL(12, 2);
  `)
  console.log('✅  完成')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())

/**
 * prisma/seed.ts
 *
 * Minimum seed data for 门店轻经营助手 v1 local/staging dev.
 *
 * Idempotent: uses upsert throughout so it can be re-run safely.
 * Does NOT insert inventory, stock, or ERP data.
 *
 * Run:
 *   npx prisma db seed
 *   -- or --
 *   npx tsx prisma/seed.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // ─── Tenant ───────────────────────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { id: 'seed-tenant-001' },
    update: {},
    create: {
      id: 'seed-tenant-001',
      name: '测试商家',
      status: 'ACTIVE',
    },
  })
  console.log('✓ Tenant:', tenant.name)

  // ─── Stores ───────────────────────────────────────────────────────────────
  const storeA = await prisma.store.upsert({
    where: { code: 'STORE-A' },
    update: {},
    create: {
      id: 'seed-store-a',
      tenantId: tenant.id,
      code: 'STORE-A',
      name: '总店',
      status: 'ACTIVE',
    },
  })

  const storeB = await prisma.store.upsert({
    where: { code: 'STORE-B' },
    update: {},
    create: {
      id: 'seed-store-b',
      tenantId: tenant.id,
      code: 'STORE-B',
      name: '分店',
      status: 'ACTIVE',
    },
  })
  console.log('✓ Stores:', storeA.name, '/', storeB.name)

  // ─── Users ────────────────────────────────────────────────────────────────
  const owner = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'boss' } },
    update: {},
    create: {
      id: 'seed-user-boss',
      tenantId: tenant.id,
      username: 'boss',
      displayName: '老板',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })

  const staffA = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'staff_a' } },
    update: {},
    create: {
      id: 'seed-user-staff-a',
      tenantId: tenant.id,
      username: 'staff_a',
      displayName: '小张（总店）',
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })

  const staffB = await prisma.user.upsert({
    where: { tenantId_username: { tenantId: tenant.id, username: 'staff_b' } },
    update: {},
    create: {
      id: 'seed-user-staff-b',
      tenantId: tenant.id,
      username: 'staff_b',
      displayName: '小李（分店）',
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })
  console.log('✓ Users:', owner.displayName, '/', staffA.displayName, '/', staffB.displayName)

  // ─── UserStoreRoles ───────────────────────────────────────────────────────
  // OWNER is not bound to a specific store — can view all stores
  // Each STAFF is bound to their own store
  await prisma.userStoreRole.upsert({
    where: { userId_storeId: { userId: staffA.id, storeId: storeA.id } },
    update: {},
    create: {
      id: 'seed-role-staff-a',
      tenantId: tenant.id,
      userId: staffA.id,
      storeId: storeA.id,
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })

  await prisma.userStoreRole.upsert({
    where: { userId_storeId: { userId: staffB.id, storeId: storeB.id } },
    update: {},
    create: {
      id: 'seed-role-staff-b',
      tenantId: tenant.id,
      userId: staffB.id,
      storeId: storeB.id,
      role: 'STAFF',
      status: 'ACTIVE',
    },
  })

  // OWNER gets a role entry for storeA (used as default storeId in OWNER headers during dev)
  await prisma.userStoreRole.upsert({
    where: { userId_storeId: { userId: owner.id, storeId: storeA.id } },
    update: {},
    create: {
      id: 'seed-role-boss',
      tenantId: tenant.id,
      userId: owner.id,
      storeId: storeA.id,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  console.log('✓ UserStoreRoles bound')

  // ─── Products ─────────────────────────────────────────────────────────────
  const products = [
    {
      id: 'seed-product-001',
      barcode: '8888001',
      name: '矿泉水',
      spec: '550ml',
      sellPrice: '2.50',
    },
    {
      id: 'seed-product-002',
      barcode: '8888002',
      name: '红牛',
      spec: '250ml',
      sellPrice: '6.00',
    },
    {
      id: 'seed-product-003',
      barcode: '8888003',
      name: '薯片',
      spec: '大包装',
      sellPrice: '12.80',
    },
  ]

  for (const p of products) {
    await prisma.product.upsert({
      where: { tenantId_barcode: { tenantId: tenant.id, barcode: p.barcode } },
      update: {},
      create: {
        id: p.id,
        tenantId: tenant.id,
        barcode: p.barcode,
        name: p.name,
        spec: p.spec,
        sellPrice: p.sellPrice,
        status: 'ACTIVE',
      },
    })
  }
  console.log('✓ Products: 矿泉水 / 红牛 / 薯片')

  // ─── Sample SaleRecords ───────────────────────────────────────────────────
  // A few sales so that /api/records and /api/summary return non-empty results
  // immediately after seed. Use today's date.

  const saleSeeds = [
    {
      id: 'seed-sale-001',
      recordNo: 'S-SEED-STORE-A-0001',
      storeId: storeA.id,
      operatorUserId: staffA.id,
      productId: 'seed-product-001',
      barcode: '8888001',
      productNameSnapshot: '矿泉水',
      specSnapshot: '550ml',
      unitPrice: '2.50',
      quantity: '3',
      lineAmount: '7.50',
    },
    {
      id: 'seed-sale-002',
      recordNo: 'S-SEED-STORE-A-0002',
      storeId: storeA.id,
      operatorUserId: staffA.id,
      productId: 'seed-product-002',
      barcode: '8888002',
      productNameSnapshot: '红牛',
      specSnapshot: '250ml',
      unitPrice: '6.00',
      quantity: '2',
      lineAmount: '12.00',
    },
    {
      id: 'seed-sale-003',
      recordNo: 'S-SEED-STORE-B-0001',
      storeId: storeB.id,
      operatorUserId: staffB.id,
      productId: 'seed-product-003',
      barcode: '8888003',
      productNameSnapshot: '薯片',
      specSnapshot: '大包装',
      unitPrice: '12.80',
      quantity: '1',
      lineAmount: '12.80',
    },
  ]

  for (const s of saleSeeds) {
    await prisma.saleRecord.upsert({
      where: { recordNo: s.recordNo },
      update: {},
      create: {
        id: s.id,
        tenantId: tenant.id,
        storeId: s.storeId,
        operatorUserId: s.operatorUserId,
        recordNo: s.recordNo,
        saleType: 'SALE',
        status: 'COMPLETED',
        productId: s.productId,
        barcode: s.barcode,
        productNameSnapshot: s.productNameSnapshot,
        specSnapshot: s.specSnapshot,
        unitPrice: s.unitPrice,
        quantity: s.quantity,
        lineAmount: s.lineAmount,
      },
    })
  }
  console.log('✓ Sample SaleRecords: 3 sales inserted (storeA×2, storeB×1)')

  console.log('\n─── Seed complete ───────────────────────────────────────────')
  console.log('Tenant ID  :', tenant.id)
  console.log('Store A ID :', storeA.id, '(总店)')
  console.log('Store B ID :', storeB.id, '(分店)')
  console.log('Owner  ID  :', owner.id, '(boss)')
  console.log('StaffA ID  :', staffA.id, '(staff_a → 总店)')
  console.log('StaffB ID  :', staffB.id, '(staff_b → 分店)')
  console.log('\nSample sale recordNos for refund testing:')
  console.log('  S-SEED-STORE-A-0001  矿泉水 ×3  (storeA / staffA)')
  console.log('  S-SEED-STORE-A-0002  红牛   ×2  (storeA / staffA)')
  console.log('  S-SEED-STORE-B-0001  薯片   ×1  (storeB / staffB)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

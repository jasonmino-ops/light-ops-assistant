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

  // ─── Products — same template as production new-tenant init ──────────────
  // Barcodes prefixed DEMO- are clearly non-production.
  // Owner should disable or replace these after going live.
  const demoProducts = [
    { id: 'seed-product-001', barcode: 'DEMO-0001', name: '【测试】样品商品甲', spec: '单件',   sellPrice: '10.00' },
    { id: 'seed-product-002', barcode: 'DEMO-0002', name: '【测试】样品商品乙', spec: '两件装', sellPrice: '18.00' },
    { id: 'seed-product-003', barcode: 'DEMO-0003', name: '【测试】样品商品丙', spec: null,    sellPrice: '5.50'  },
  ]

  for (const p of demoProducts) {
    await prisma.product.upsert({
      where: { tenantId_barcode: { tenantId: tenant.id, barcode: p.barcode } },
      update: {},
      create: { ...p, tenantId: tenant.id, status: 'ACTIVE' },
    })
  }
  console.log('✓ Products (test template): 样品商品甲 / 乙 / 丙')
  console.log('  Note: no sale records, refunds, or staff bindings — all other data starts blank.')

  console.log('\n─── Seed complete ───────────────────────────────────────────')
  console.log('Tenant ID  :', tenant.id)
  console.log('Store A ID :', storeA.id, '(总店)')
  console.log('Store B ID :', storeB.id, '(分店)')
  console.log('Owner  ID  :', owner.id, '(boss)')
  console.log('StaffA ID  :', staffA.id, '(staff_a → 总店)')
  console.log('StaffB ID  :', staffB.id, '(staff_b → 分店)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

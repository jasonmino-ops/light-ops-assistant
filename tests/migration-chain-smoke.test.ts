import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '../lib/prisma'
import { issueDesktopActivationPin } from '../lib/desktop-activation/pin-issuance'

if (process.env.MIGRATION_CHAIN_TEST_DATABASE !== '1') {
  throw new Error('MIGRATION_CHAIN_TEST_DATABASE=1 is required for migration-chain smoke tests')
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for migration-chain smoke tests')
}
if (!process.env.DESKTOP_DEVICE_TOKEN_SECRET || !process.env.DESKTOP_ACTIVATION_PIN_SECRET) {
  throw new Error('Desktop activation test secrets are required for migration-chain smoke tests')
}

const suffix = randomUUID().slice(0, 10)
const tenantId = `chain-tenant-${suffix}`
const storeId = `chain-store-${suffix}`
const ownerId = `chain-owner-${suffix}`
const opsAdminId = `chain-ops-${suffix}`
const customerOrderId = `chain-order-${suffix}`

async function assertCatalogShape() {
  const customerOrderColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'CustomerOrder'
      AND column_name IN (
        'id',
        'paymentStatus',
        'tableNo',
        'sourcePlatform',
        'campaignLinkId',
        'deliveryAddressPhotoData'
      )
  `
  assert.deepEqual(
    new Set(customerOrderColumns.map((row) => row.column_name)),
    new Set(['id', 'paymentStatus', 'tableNo', 'sourcePlatform', 'campaignLinkId', 'deliveryAddressPhotoData']),
    'CustomerOrder migration chain columns must exist',
  )

  const activationColumns = await prisma.$queryRaw<Array<{ column_name: string, is_nullable: string }>>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('DesktopActivationPin', 'DesktopActivationAudit')
      AND column_name IN ('createdByUserId', 'createdByOpsAdminId', 'actorOpsAdminId')
  `
  const nullableByColumn = new Map(activationColumns.map((row) => [row.column_name, row.is_nullable]))
  assert.equal(nullableByColumn.get('createdByUserId'), 'YES', 'createdByUserId must be nullable')
  assert.equal(nullableByColumn.get('createdByOpsAdminId'), 'YES', 'createdByOpsAdminId must exist and be nullable')
  assert.equal(nullableByColumn.get('actorOpsAdminId'), 'YES', 'actorOpsAdminId must exist and be nullable')

  const constraints = await prisma.$queryRaw<Array<{ conname: string, confdeltype: string | null }>>`
    SELECT conname, NULLIF(confdeltype::text, ' ') AS confdeltype
    FROM pg_constraint
    WHERE conname IN (
      'DesktopActivationPin_exactly_one_creator_check',
      'DesktopActivationPin_createdByUserId_fkey',
      'DesktopActivationPin_createdByOpsAdminId_fkey',
      'DesktopActivationAudit_actorOpsAdminId_fkey'
    )
  `
  const constraintNames = new Set(constraints.map((row) => row.conname))
  assert(constraintNames.has('DesktopActivationPin_exactly_one_creator_check'), 'creator CHECK must exist')
  assert(constraintNames.has('DesktopActivationPin_createdByUserId_fkey'), 'merchant creator FK must exist')
  assert(constraintNames.has('DesktopActivationPin_createdByOpsAdminId_fkey'), 'ops creator FK must exist')
  assert(constraintNames.has('DesktopActivationAudit_actorOpsAdminId_fkey'), 'ops actor FK must exist')
  assert.equal(
    constraints.find((row) => row.conname === 'DesktopActivationPin_createdByUserId_fkey')?.confdeltype,
    'n',
    'merchant creator FK must use ON DELETE SET NULL',
  )

  const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'CustomerOrder_orderNo_key',
        'CustomerOrder_campaignLinkId_idx',
        'DesktopActivationPin_createdByOpsAdminId_idx',
        'DesktopActivationAudit_actorOpsAdminId_idx'
      )
  `
  assert.deepEqual(
    new Set(indexes.map((row) => row.indexname)),
    new Set([
      'CustomerOrder_orderNo_key',
      'CustomerOrder_campaignLinkId_idx',
      'DesktopActivationPin_createdByOpsAdminId_idx',
      'DesktopActivationAudit_actorOpsAdminId_idx',
    ]),
    'migration-chain indexes must exist',
  )
}

async function seedBaseData() {
  await prisma.tenant.create({
    data: {
      id: tenantId,
      name: `migration chain ${suffix}`,
      status: 'ACTIVE',
      tier: 'STANDARD',
    },
  })
  await prisma.store.create({
    data: {
      id: storeId,
      tenantId,
      code: `MIG${suffix.toUpperCase()}`,
      name: 'Migration Chain Store',
      status: 'ACTIVE',
    },
  })
  await prisma.user.create({
    data: {
      id: ownerId,
      tenantId,
      username: `owner-${suffix}`,
      displayName: 'Migration Owner',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  })
  await prisma.opsAdmin.create({
    data: {
      id: opsAdminId,
      name: 'Migration Ops',
      username: `migration-ops-${suffix}`,
      role: 'OPS_ADMIN',
      status: 'ACTIVE',
    },
  })
  await prisma.tenantSubscription.create({
    data: {
      tenantId,
      status: 'ACTIVE',
    },
  })
}

async function assertCustomerOrderWritable() {
  await prisma.customerOrder.create({
    data: {
      id: customerOrderId,
      tenantId,
      storeId,
      storeCode: `MIG${suffix.toUpperCase()}`,
      orderNo: `CHAIN-${suffix}`,
      customerTelegramId: `tg-${suffix}`,
      itemsJson: '[]',
      totalAmount: '0.00',
      status: 'PENDING',
      paymentStatus: 'UNPAID',
      sourcePlatform: 'migration-chain',
      campaignCode: `C-${suffix}`,
      campaignIntent: 'order',
    },
  })
  const row = await prisma.customerOrder.findUniqueOrThrow({ where: { id: customerOrderId } })
  assert.equal(row.orderNo, `CHAIN-${suffix}`, 'CustomerOrder row must be writable after migrate deploy')
  assert.equal(row.paymentStatus, 'UNPAID', 'CustomerOrder paymentStatus must be usable')
}

async function assertActivationAttribution() {
  const merchantPin = await prisma.desktopActivationPin.create({
    data: {
      tenantId,
      storeId,
      pinHash: `merchant-hash-${suffix}`,
      pinHashVersion: 1,
      status: 'REVOKED',
      activeSlot: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdByUserId: ownerId,
      createdByOpsAdminId: null,
    },
  })
  assert.equal(merchantPin.createdByUserId, ownerId, 'historical merchant PIN shape must remain valid')
  assert.equal(merchantPin.createdByOpsAdminId, null, 'historical merchant PIN must not require OpsAdmin')

  await assert.rejects(
    () => prisma.$executeRaw`
      INSERT INTO "DesktopActivationPin" (
        "id", "tenantId", "storeId", "pinHash", "pinHashVersion",
        "status", "activeSlot", "expiresAt", "createdByUserId", "createdByOpsAdminId",
        "createdAt", "updatedAt"
      ) VALUES (
        ${`check-null-${suffix}`}, ${tenantId}, ${storeId}, ${`check-null-hash-${suffix}`}, 1,
        'ACTIVE'::"DesktopActivationPinStatus", NULL, NOW() + INTERVAL '1 hour', NULL, NULL,
        NOW(), NOW()
      )
    `,
    'CHECK must reject a PIN with no creator',
  )

  await assert.rejects(
    () => prisma.$executeRaw`
      INSERT INTO "DesktopActivationPin" (
        "id", "tenantId", "storeId", "pinHash", "pinHashVersion",
        "status", "activeSlot", "expiresAt", "createdByUserId", "createdByOpsAdminId",
        "createdAt", "updatedAt"
      ) VALUES (
        ${`check-both-${suffix}`}, ${tenantId}, ${storeId}, ${`check-both-hash-${suffix}`}, 1,
        'ACTIVE'::"DesktopActivationPinStatus", NULL, NOW() + INTERVAL '1 hour', ${ownerId}, ${opsAdminId},
        NOW(), NOW()
      )
    `,
    'CHECK must reject a PIN with two creators',
  )

  const result = await issueDesktopActivationPin({
    req: new NextRequest('http://localhost/migration-chain-smoke'),
    store: { id: storeId, tenantId },
    createdByUserId: null,
    createdByOpsAdminId: opsAdminId,
    actorUserId: null,
    actorOpsAdminId: opsAdminId,
    auditReasonCode: 'MIGRATION_CHAIN_SMOKE',
    auditMetadata: {
      operatorRole: 'OPS_ADMIN',
      issuanceSource: 'MIGRATION_CHAIN_GATE',
    },
  })
  assert.equal(result.ok, true, 'Ops attribution smoke issuance must succeed')
  if (!result.ok) return

  const opsPin = await prisma.desktopActivationPin.findUniqueOrThrow({ where: { id: result.pinId } })
  assert.equal(opsPin.createdByUserId, null, 'Ops PIN must not use merchant creator')
  assert.equal(opsPin.createdByOpsAdminId, opsAdminId, 'Ops PIN must use OpsAdmin creator')

  const audit = await prisma.desktopActivationAudit.findFirstOrThrow({
    where: { pinId: result.pinId, eventType: 'PIN_CREATED' },
  })
  assert.equal(audit.actorUserId, null, 'Ops audit must not use merchant actor')
  assert.equal(audit.actorOpsAdminId, opsAdminId, 'Ops audit must use OpsAdmin actor')
}

async function cleanup() {
  await prisma.desktopActivationAudit.deleteMany({ where: { tenantId } })
  await prisma.desktopActivationPin.deleteMany({ where: { tenantId } })
  await prisma.tenantSubscription.deleteMany({ where: { tenantId } })
  await prisma.customerOrder.deleteMany({ where: { id: customerOrderId } })
  await prisma.user.deleteMany({ where: { tenantId } })
  await prisma.store.deleteMany({ where: { tenantId } })
  await prisma.tenant.deleteMany({ where: { id: tenantId } })
  await prisma.opsAdmin.deleteMany({ where: { id: opsAdminId } })
}

async function main() {
  await assertCatalogShape()
  await seedBaseData()
  await assertCustomerOrderWritable()
  await assertActivationAttribution()
  await cleanup()
}

main()
  .then(async () => {
    await prisma.$disconnect()
    console.log('migration-chain-smoke.test.ts passed')
  })
  .catch(async (error) => {
    await cleanup().catch(() => undefined)
    await prisma.$disconnect()
    console.error(error)
    process.exit(1)
  })

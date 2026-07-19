import assert from 'node:assert/strict'
import { assertStagingPreviewDatabase } from './staging-preview-guard'

const RUNTIME_MARKERS = ['rt-success tenant ', 'rt-concurrent tenant '] as const

type Counts = Record<string, number>

async function relevantCounts(prisma: typeof import('../lib/prisma').prisma, tenantIds: string[]): Promise<Counts> {
  const where = { tenantId: { in: tenantIds } }
  const [tenants, stores, users, roles, subscriptions, events, pins, audits, devices, orders, products] = await Promise.all([
    prisma.tenant.count({ where: { id: { in: tenantIds } } }),
    prisma.store.count({ where }),
    prisma.user.count({ where }),
    prisma.userStoreRole.count({ where }),
    prisma.tenantSubscription.count({ where }),
    prisma.subscriptionEvent.count({ where }),
    prisma.desktopActivationPin.count({ where }),
    prisma.desktopActivationAudit.count({ where }),
    prisma.desktopDevice.count({ where }),
    prisma.customerOrder.count({ where }),
    prisma.product.count({ where }),
  ])
  return { Tenant: tenants, Store: stores, User: users, UserStoreRole: roles, TenantSubscription: subscriptions,
    SubscriptionEvent: events, DesktopActivationPin: pins, DesktopActivationAudit: audits,
    DesktopDevice: devices, CustomerOrder: orders, Product: products }
}

async function main() {
  const target = assertStagingPreviewDatabase()
  const { prisma } = await import('../lib/prisma')

  try {
    const identity = await prisma.$queryRaw<Array<{ database_name: string }>>`
      SELECT current_database() AS database_name
    `
    assert.equal(identity[0]?.database_name, 'postgres', 'unexpected staging database name')

    const tenants = await prisma.tenant.findMany({
      where: {
        OR: RUNTIME_MARKERS.map((marker) => ({ name: { startsWith: marker } })),
      },
      select: { id: true },
    })
    const tenantIds = tenants.map((tenant) => tenant.id)
    const before = await relevantCounts(prisma, tenantIds)

    if (tenantIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        const where = { tenantId: { in: tenantIds } }
        await tx.desktopActivationAudit.deleteMany({ where })
        await tx.desktopActivationPin.deleteMany({ where })
        await tx.desktopDevice.deleteMany({ where })
        await tx.subscriptionEvent.deleteMany({ where })
        await tx.tenantSubscription.deleteMany({ where })
        await tx.userStoreRole.deleteMany({ where })
        await tx.customerOrder.deleteMany({ where })
        await tx.product.deleteMany({ where })
        await tx.store.deleteMany({ where })
        await tx.user.deleteMany({ where })
        await tx.tenant.deleteMany({ where: { id: { in: tenantIds } } })
      })
    }

    const after = await relevantCounts(prisma, tenantIds)
    assert(Object.values(after).every((count) => count === 0), 'runtime fixture cleanup left residual rows')

    console.log(JSON.stringify({
      target: 'eshop-staging',
      projectRefFingerprint: target.projectRefFingerprint,
      markerCategory: 'desktop-activation-runtime-test',
      before,
      after,
      residuals: 'ZERO',
    }, null, 2))
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'staging runtime cleanup failed')
  process.exitCode = 1
})

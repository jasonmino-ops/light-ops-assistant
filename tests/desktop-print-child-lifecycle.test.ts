import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { provisionManagedPrintChild } from '../lib/computer-client/service'
import { hashDeviceSecret, hashInstallationId } from '../lib/computer-client/crypto'

process.env.COMPUTER_CLIENT_TOKEN_SECRET ??= 'test-computer-client-secret-not-production'

const read = (path: string) => readFileSync(path, 'utf8')
const installationId = 'print-child-installation-001'
const deviceSecret = `ecc_v1_${'d'.repeat(48)}`
const parent = {
  parentDesktopDeviceId: 'desktop-parent-1', tenantId: 'tenant-1', storeId: 'store-1',
  tokenExpiresAt: new Date('2099-01-01T00:00:00.000Z'), installationId, deviceSecret,
}

function fakeDb() {
  let row: any = null
    return {
      computerBinding: {
        findUnique: async ({ where }: any) => where.installationIdHash === hashInstallationId(installationId) ? row : null,
        findFirst: async ({ where }: any = {}) => {
          if (where?.NOT?.id === row?.id) return null
          return row
        },
        update: async ({ data }: any) => {
          row = { ...row, ...data, parentDesktopDevice: { store: { code: 'STORE-1' } } }
          return row
        },
        create: async ({ data }: any) => {
        row = { id: 'child-1', ...data, disabledAt: null, parentDesktopDeviceId: parent.parentDesktopDeviceId,
          parentDesktopDevice: { store: { code: 'STORE-1' } } }
        return row
      },
    },
    store: { findUniqueOrThrow: async () => ({ code: 'STORE-1' }) },
  } as any
}

async function main() {
  {
    const db = fakeDb()
    const first = await provisionManagedPrintChild(parent, db)
    const second = await provisionManagedPrintChild(parent, db)
    assert.deepEqual(first, { childId: 'child-1', idempotent: false, storeCode: 'STORE-1', credentialExpiresAt: parent.tokenExpiresAt })
    assert.deepEqual(second, { childId: 'child-1', idempotent: true, storeCode: 'STORE-1', credentialExpiresAt: parent.tokenExpiresAt })
  }

  {
    const db = fakeDb()
    await provisionManagedPrintChild(parent, db)
    await assert.rejects(
      provisionManagedPrintChild({ ...parent, deviceSecret: `ecc_v1_${'x'.repeat(48)}` }, db),
      /PRINT_CHILD_IDENTITY_CONFLICT/,
    )
    assert.notEqual(hashDeviceSecret(deviceSecret), '')
  }

  {
    const db = fakeDb()
    await provisionManagedPrintChild(parent, db)
    // A replacement DesktopDevice may recover the same hidden child only
    // after the previous parent is no longer active; the child id remains
    // stable and the credential is refreshed for the new parent.
    const replacement = await provisionManagedPrintChild({
      ...parent,
      parentDesktopDeviceId: 'desktop-parent-2',
    }, db)
    assert.equal(replacement.childId, 'child-1')
    assert.equal(replacement.idempotent, true)
  }

  {
    const schema = read('prisma/schema.prisma')
    const migration = read('prisma/migrations/20261014000000_add_desktop_print_child_identity/migration.sql')
    const route = read('app/api/desktop/print-child/route.ts')
    const terminals = read('app/api/computer-client/terminals/route.ts')
    const auth = read('lib/computer-client/service.ts')
    const relay = read('lib/es-tray-relay/auth.ts')
    assert.match(schema, /parentDesktopDeviceId/)
    assert.match(schema, /identityKind\s+ComputerBindingIdentityKind/)
    assert.match(migration, /ComputerBinding_one_active_desktop_print_child_per_parent_key/)
    assert.match(migration, /REFERENCES "DesktopDevice"\("id", "tenantId", "storeId"\)/)
    assert.match(route, /allowDesktopDerivedSession: true/)
    assert.match(route, /provisionManagedPrintChild/)
    assert.match(terminals, /identityKind: 'LEGACY_AGENT'/)
    assert.match(auth, /options\.allowManagedPrintChild/)
    assert.match(auth, /PRINT_CHILD_PARENT_NOT_ACTIVE/)
    assert.match(relay, /allowManagedPrintChild: true/)
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

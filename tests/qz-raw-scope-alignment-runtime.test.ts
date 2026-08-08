import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { GET as getCashierAccess } from '../app/api/cashier/access/route'
import {
  hashPosDeviceToken,
  signPosDeviceToken,
} from '../lib/desktop-pos-auth'
import { prisma } from '../lib/prisma'

type TestStore = {
  id: string
  code: string
  tenantId: string
  status: 'ACTIVE'
  name: string
}

type TestSession = {
  id: string
  tenantId: string
  storeId: string
  browserDeviceId: string
  tokenHash: string
  status: 'ACTIVE'
  activeSlot: 'ACTIVE'
  tokenExpiresAt: Date
}

type TestLaunchLink = {
  browserPosDeviceId: string
  tenantId: string
  storeId: string
}

type StoreFindUnique = (args: {
  where: { code: string }
  select?: Record<string, boolean>
}) => Promise<TestStore | null>

type SessionFindFirst = (args: {
  where: {
    id: string
    tenantId: string
    storeId: string
    browserDeviceId: string
    tokenHash: string
    status: string
    activeSlot: string
    tokenExpiresAt: { gt: Date }
  }
  select?: Record<string, boolean>
}) => Promise<{ id: string } | null>

type LaunchFindFirst = (args: {
  where: {
    browserPosDeviceId: string
    binding: { tenantId: string; storeId: string }
  }
  select?: Record<string, boolean>
}) => Promise<{ id: string } | null>

const delegates = prisma as unknown as {
  store: { findUnique: StoreFindUnique }
  browserPosDevice: { findFirst: SessionFindFirst }
  computerBrowserLaunchTicket: { findFirst: LaunchFindFirst }
}

const originalStoreFindUnique = delegates.store.findUnique
const originalSessionFindFirst = delegates.browserPosDevice.findFirst
const originalLaunchFindFirst = delegates.computerBrowserLaunchTicket.findFirst

const stores = new Map<string, TestStore>()
const sessions = new Map<string, TestSession>()
const launchLinks: TestLaunchLink[] = []

function addStore(code: string, tenantId = `tenant-${code}`): TestStore {
  const store: TestStore = {
    id: `store-${code}`,
    code,
    tenantId,
    status: 'ACTIVE',
    name: `Store ${code}`,
  }
  stores.set(code, store)
  return store
}

function addBrowserPosSession(store: TestStore) {
  const browserDeviceId = `browser-${randomUUID()}`
  const browserPosSessionId = `session-${randomUUID()}`
  const token = signPosDeviceToken({
    tenantId: store.tenantId,
    storeId: store.id,
    storeCode: store.code,
    deviceId: browserDeviceId,
    issuedBy: 'scope-alignment-test',
    browserPosSessionId,
  })
  sessions.set(browserPosSessionId, {
    id: browserPosSessionId,
    tenantId: store.tenantId,
    storeId: store.id,
    browserDeviceId,
    tokenHash: hashPosDeviceToken(token),
    status: 'ACTIVE',
    activeSlot: 'ACTIVE',
    tokenExpiresAt: new Date(Date.now() + 60_000),
  })
  return { browserDeviceId, browserPosSessionId, token }
}

function linkFormalComputerLaunch(
  browserPosSessionId: string,
  store: Pick<TestStore, 'tenantId' | 'id'>,
) {
  launchLinks.push({
    browserPosDeviceId: browserPosSessionId,
    tenantId: store.tenantId,
    storeId: store.id,
  })
}

function accessRequest(
  storeCode: string,
  auth: { browserDeviceId: string; token: string },
) {
  return new NextRequest(`https://elifekh.com/api/cashier/access?storeCode=${encodeURIComponent(storeCode)}`, {
    headers: {
      'x-pos-device-id': auth.browserDeviceId,
      'x-pos-device-token': auth.token,
    },
  })
}

async function expectRawAuthorization(
  label: string,
  storeCode: string,
  auth: { browserDeviceId: string; token: string },
  expected: boolean,
) {
  const response = await getCashierAccess(accessRequest(storeCode, auth))
  assert.equal(response.status, 200, `${label}: the valid Browser POS session must retain cashier access`)
  const body = await response.json() as { qzRawCanary?: boolean }
  assert.equal(body.qzRawCanary, expected, label)
}

async function main() {
  const mutableEnv = process.env as Record<string, string | undefined>
  const originalAuthSecret = mutableEnv.AUTH_SECRET
  const originalRawEnabled = mutableEnv.QZ_RAW_CANARY_ENABLED
  mutableEnv.AUTH_SECRET = 'qz-raw-scope-alignment-test-secret'

  delegates.store.findUnique = async ({ where }) => stores.get(where.code) ?? null
  delegates.browserPosDevice.findFirst = async ({ where }) => {
    const session = sessions.get(where.id)
    if (!session) return null
    const matches =
      session.tenantId === where.tenantId &&
      session.storeId === where.storeId &&
      session.browserDeviceId === where.browserDeviceId &&
      session.tokenHash === where.tokenHash &&
      session.status === where.status &&
      session.activeSlot === where.activeSlot &&
      session.tokenExpiresAt > where.tokenExpiresAt.gt
    return matches ? { id: session.id } : null
  }
  delegates.computerBrowserLaunchTicket.findFirst = async ({ where }) => {
    const match = launchLinks.find((link) =>
      link.browserPosDeviceId === where.browserPosDeviceId &&
      link.tenantId === where.binding.tenantId &&
      link.storeId === where.binding.storeId,
    )
    return match ? { id: `launch-${match.browserPosDeviceId}` } : null
  }

  try {
    mutableEnv.QZ_RAW_CANARY_ENABLED = '1'

    const originalStore = addStore('ST169E7000')
    const originalStoreSession = addBrowserPosSession(originalStore)
    linkFormalComputerLaunch(originalStoreSession.browserPosSessionId, originalStore)
    await expectRawAuthorization(
      'Test A: the original golden store remains RAW authorized',
      originalStore.code,
      originalStoreSession,
      true,
    )

    const differentStore = addStore('ST-SCOPE-ALIGNMENT-OTHER')
    const differentStoreSession = addBrowserPosSession(differentStore)
    linkFormalComputerLaunch(differentStoreSession.browserPosSessionId, differentStore)
    await expectRawAuthorization(
      'Test B: a different legally launched store is RAW authorized',
      differentStore.code,
      differentStoreSession,
      true,
    )

    const missingLaunchStore = addStore('ST-SCOPE-NO-LAUNCH')
    const missingLaunchSession = addBrowserPosSession(missingLaunchStore)
    await expectRawAuthorization(
      'Test C: a Browser POS session without a Computer Launch Ticket is not RAW authorized',
      missingLaunchStore.code,
      missingLaunchSession,
      false,
    )

    const mismatchStore = addStore('ST-SCOPE-MISMATCH')
    const mismatchSession = addBrowserPosSession(mismatchStore)
    linkFormalComputerLaunch(mismatchSession.browserPosSessionId, {
      tenantId: 'tenant-other-owner',
      id: 'store-other-owner',
    })
    await expectRawAuthorization(
      'Test D: a Launch Ticket and Binding owned by another tenant/store do not authorize RAW',
      mismatchStore.code,
      mismatchSession,
      false,
    )

    mutableEnv.QZ_RAW_CANARY_ENABLED = '0'
    await expectRawAuthorization(
      'Test E: disabled server enablement does not authorize RAW',
      differentStore.code,
      differentStoreSession,
      false,
    )
  } finally {
    delegates.store.findUnique = originalStoreFindUnique
    delegates.browserPosDevice.findFirst = originalSessionFindFirst
    delegates.computerBrowserLaunchTicket.findFirst = originalLaunchFindFirst
    if (originalAuthSecret === undefined) delete mutableEnv.AUTH_SECRET
    else mutableEnv.AUTH_SECRET = originalAuthSecret
    if (originalRawEnabled === undefined) delete mutableEnv.QZ_RAW_CANARY_ENABLED
    else mutableEnv.QZ_RAW_CANARY_ENABLED = originalRawEnabled
  }
}

main()
  .then(() => console.log('QZ RAW scope alignment runtime checks passed'))
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })

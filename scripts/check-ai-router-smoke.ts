import { prisma } from '../lib/prisma'
import { tryAiSupportReply } from '../lib/ai-support/router'
import type { AiSupportProvider, AiSupportRequest, AiSupportRouterResult } from '../lib/ai-support/types'

const STORE_CODE = 'ST169E7000'
const TELEGRAM_ID = '5314687265'

type SmokeCase = {
  name: string
  result: AiSupportRouterResult
  pass: boolean
}

function expect(name: string, result: AiSupportRouterResult, predicate: (result: AiSupportRouterResult) => boolean): SmokeCase {
  return { name, result, pass: predicate(result) }
}

function summarize(result: AiSupportRouterResult) {
  return {
    handled: result.handled,
    provider: result.provider ?? null,
    status: result.status ?? null,
    confidence: result.confidence ?? null,
    needHuman: result.needHuman ?? null,
    intent: result.intent ?? null,
    errorCode: result.errorCode ?? null,
    latencyMs: result.latencyMs ?? null,
  }
}

async function setStoreProvider(params: {
  tenantId: string
  storeId: string
  provider: string
  enabled: boolean
}) {
  await prisma.aiSupportProviderConfig.upsert({
    where: {
      tenantId_storeId_provider: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        provider: params.provider,
      },
    },
    create: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      provider: params.provider,
      enabled: params.enabled,
      apiBaseUrl: `mock://${params.provider.toLowerCase()}`,
      allowedToolsJson: '[]',
      timeoutMs: 3000,
    },
    update: {
      enabled: params.enabled,
    },
  })
}

async function readProviderEnabled(tenantId: string, storeId: string, provider: string): Promise<boolean | null> {
  const config = await prisma.aiSupportProviderConfig.findUnique({
    where: {
      tenantId_storeId_provider: { tenantId, storeId, provider },
    },
    select: { enabled: true },
  })
  return config?.enabled ?? null
}

function request(base: {
  tenantId: string
  storeId: string
  storeName: string
  provider: AiSupportProvider | string
  message: string
}): AiSupportRequest & { provider: AiSupportProvider | string } {
  return {
    tenantId: base.tenantId,
    storeId: base.storeId,
    storeName: base.storeName,
    telegramId: TELEGRAM_ID,
    customerId: TELEGRAM_ID,
    sessionId: `${STORE_CODE}:${TELEGRAM_ID}`,
    language: 'zh',
    userMessage: base.message,
    channel: 'TELEGRAM_CUSTOMER',
    allowedTools: [],
    context: { storeCode: STORE_CODE, storeName: base.storeName },
    provider: base.provider,
  }
}

async function main() {
  const store = await prisma.store.findUnique({
    where: { code: STORE_CODE },
    select: { id: true, tenantId: true, name: true },
  })
  if (!store) throw new Error(`Store not found: ${STORE_CODE}`)

  const originalKillSwitch = process.env.AI_SUPPORT_KILL_SWITCH
  const cases: SmokeCase[] = []

  try {
    cases.push(expect(
      'no config returns handled=false',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'VENDOR_AI',
        message: 'router smoke no config',
      })),
      (result) => result.handled === false && result.status === 'CONFIG_DISABLED_OR_MISSING',
    ))

    await setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MOCK', enabled: false })
    cases.push(expect(
      'enabled=false returns handled=false',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MOCK',
        message: 'router smoke disabled',
      })),
      (result) => result.handled === false && result.status === 'CONFIG_DISABLED_OR_MISSING',
    ))

    await setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MOCK', enabled: true })
    cases.push(expect(
      'MOCK success returns handled=true',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MOCK',
        message: 'router smoke mock_success',
      })),
      (result) => result.handled === true
        && result.status === 'SUCCESS'
        && result.provider === 'MOCK'
        && result.intent === 'mock_success'
        && result.confidence === 0.9,
    ))

    cases.push(expect(
      'MOCK low confidence exposes confidence=0.3',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MOCK',
        message: 'router smoke mock_low_confidence',
      })),
      (result) => result.handled === true
        && result.provider === 'MOCK'
        && result.intent === 'mock_low_confidence'
        && result.confidence === 0.3
        && result.needHuman === false,
    ))

    cases.push(expect(
      'MOCK need human exposes needHuman=true',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MOCK',
        message: 'router smoke mock_need_human',
      })),
      (result) => result.handled === true
        && result.provider === 'MOCK'
        && result.intent === 'mock_need_human'
        && result.needHuman === true
        && result.confidence === 0.95,
    ))

    await setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'UNKNOWN', enabled: true })
    cases.push(expect(
      'UNKNOWN provider returns adapter not found',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'UNKNOWN',
        message: 'router smoke unknown provider',
      })),
      (result) => result.handled === false
        && result.provider === 'UNKNOWN'
        && result.errorCode === 'ADAPTER_NOT_FOUND',
    ))

    process.env.AI_SUPPORT_KILL_SWITCH = '1'
    cases.push(expect(
      'kill switch returns handled=false',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MOCK',
        message: 'router smoke kill switch',
      })),
      (result) => result.handled === false && result.status === 'KILL_SWITCH',
    ))
  } finally {
    if (originalKillSwitch === undefined) {
      delete process.env.AI_SUPPORT_KILL_SWITCH
    } else {
      process.env.AI_SUPPORT_KILL_SWITCH = originalKillSwitch
    }

    await Promise.all([
      setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MOCK', enabled: false }),
      setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'UNKNOWN', enabled: false }),
    ])
  }

  const finalState = {
    LINGSHUO: await readProviderEnabled(store.tenantId, store.id, 'LINGSHUO'),
    MOCK: await readProviderEnabled(store.tenantId, store.id, 'MOCK'),
    UNKNOWN: await readProviderEnabled(store.tenantId, store.id, 'UNKNOWN'),
  }

  for (const item of cases) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`, JSON.stringify(summarize(item.result)))
  }
  console.log('FINAL_CONFIG', JSON.stringify(finalState))

  if (!cases.every((item) => item.pass)) {
    throw new Error('AI router smoke check failed')
  }
  if (finalState.LINGSHUO !== false || finalState.MOCK !== false || finalState.UNKNOWN !== false) {
    throw new Error('AI provider config was not restored to enabled=false')
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

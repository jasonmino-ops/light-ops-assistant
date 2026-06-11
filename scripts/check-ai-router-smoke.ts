import { prisma } from '../lib/prisma'
import { resolveAiSupportProviderForStore } from '../lib/ai-support/config'
import { tryAiSupportReply } from '../lib/ai-support/router'
import type { AiSupportProvider, AiSupportRequest, AiSupportRouterResult } from '../lib/ai-support/types'
import { canUseAiSupport } from '../lib/tier'

const STORE_CODE = 'ST169E7000'
const TELEGRAM_ID = '5314687265'

type SmokeCase = {
  name: string
  result: AiSupportRouterResult | Record<string, unknown>
  pass: boolean
}

function expect<T extends AiSupportRouterResult | Record<string, unknown>>(
  name: string,
  result: T,
  predicate: (result: T) => boolean,
): SmokeCase {
  return { name, result, pass: predicate(result) }
}

function summarize(result: AiSupportRouterResult | Record<string, unknown>) {
  if ('handled' in result) {
    const routerResult = result as AiSupportRouterResult
    return {
      handled: routerResult.handled,
      provider: routerResult.provider ?? null,
      status: routerResult.status ?? null,
      confidence: routerResult.confidence ?? null,
      needHuman: routerResult.needHuman ?? null,
      intent: routerResult.intent ?? null,
      errorCode: routerResult.errorCode ?? null,
      latencyMs: routerResult.latencyMs ?? null,
    }
  }

  return result
}

function summarizeSelection(result: Awaited<ReturnType<typeof resolveAiSupportProviderForStore>>) {
  return {
    provider: result.provider ?? null,
    enabled: result.enabled,
    reason: result.reason,
    configId: result.configId,
    tier: result.tier,
    tierAllowed: result.tierAllowed,
    shouldCallAi: result.shouldCallAi,
  }
}

async function setStoreProvider(params: {
  tenantId: string
  storeId: string
  provider: string
  enabled: boolean
  apiBaseUrl?: string
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
      apiBaseUrl: params.apiBaseUrl ?? `mock://${params.provider.toLowerCase()}`,
      allowedToolsJson: '[]',
      timeoutMs: 3000,
    },
    update: {
      enabled: params.enabled,
      ...(params.apiBaseUrl ? { apiBaseUrl: params.apiBaseUrl } : {}),
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
      'tier guard denies LITE',
      { allowed: canUseAiSupport('LITE') },
      (result) => result.allowed === false,
    ))
    cases.push(expect(
      'tier guard allows STANDARD',
      { allowed: canUseAiSupport('STANDARD') },
      (result) => result.allowed === true,
    ))
    cases.push(expect(
      'tier guard allows MULTI_STORE',
      { allowed: canUseAiSupport('MULTI_STORE') },
      (result) => result.allowed === true,
    ))

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

    await setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MOCK', enabled: false })
    await setStoreProvider({
      tenantId: store.tenantId,
      storeId: store.id,
      provider: 'LINGSHUO',
      enabled: true,
      apiBaseUrl: 'mock://lingshuo',
    })
    cases.push(expect(
      'LINGSHUO mock success returns handled=true',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'LINGSHUO',
        message: 'router smoke lingshuo mock_success',
      })),
      (result) => result.handled === true
        && result.status === 'SUCCESS'
        && result.provider === 'LINGSHUO'
        && result.intent === 'mock_reply'
        && result.confidence === 0.9,
    ))
    cases.push(expect(
      'selection picks LINGSHUO store config',
      summarizeSelection(await resolveAiSupportProviderForStore({
        tenantId: store.tenantId,
        storeId: store.id,
        scenario: 'customer_support_l3',
      })),
      (result) => result.shouldCallAi === true
        && result.provider === 'LINGSHUO'
        && result.reason === 'SELECTED_STORE_CONFIG',
    ))
    await setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'LINGSHUO', enabled: false })

    await setStoreProvider({
      tenantId: store.tenantId,
      storeId: store.id,
      provider: 'MINO_SUPPORT_SKILL',
      enabled: false,
    })
    cases.push(expect(
      'MINO_SUPPORT_SKILL disabled returns handled=false',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MINO_SUPPORT_SKILL',
        message: 'router smoke mino support disabled',
      })),
      (result) => result.handled === false && result.status === 'CONFIG_DISABLED_OR_MISSING',
    ))
    cases.push(expect(
      'selection skips disabled MINO_SUPPORT_SKILL',
      summarizeSelection(await resolveAiSupportProviderForStore({
        tenantId: store.tenantId,
        storeId: store.id,
        scenario: 'customer_support_l3',
      })),
      (result) => result.shouldCallAi === false
        && result.reason === 'CONFIG_DISABLED_OR_MISSING',
    ))

    await setStoreProvider({
      tenantId: store.tenantId,
      storeId: store.id,
      provider: 'MINO_SUPPORT_SKILL',
      enabled: true,
    })
    cases.push(expect(
      'MINO_SUPPORT_SKILL enabled returns safe human stub',
      await tryAiSupportReply(request({
        tenantId: store.tenantId,
        storeId: store.id,
        storeName: store.name,
        provider: 'MINO_SUPPORT_SKILL',
        message: 'router smoke mino support stub',
      })),
      (result) => result.handled === true
        && result.provider === 'MINO_SUPPORT_SKILL'
        && result.intent === 'mino_support_skill_stub'
        && result.needHuman === true
        && result.confidence === 0.2,
    ))
    cases.push(expect(
      'selection picks MINO_SUPPORT_SKILL store config',
      summarizeSelection(await resolveAiSupportProviderForStore({
        tenantId: store.tenantId,
        storeId: store.id,
        scenario: 'customer_support_l3',
      })),
      (result) => result.shouldCallAi === true
        && result.provider === 'MINO_SUPPORT_SKILL'
        && result.reason === 'SELECTED_STORE_CONFIG',
    ))
    await setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MINO_SUPPORT_SKILL', enabled: false })

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
      setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'LINGSHUO', enabled: false }),
      setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MOCK', enabled: false }),
      setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'MINO_SUPPORT_SKILL', enabled: false }),
      setStoreProvider({ tenantId: store.tenantId, storeId: store.id, provider: 'UNKNOWN', enabled: false }),
    ])
  }

  const finalState = {
    LINGSHUO: await readProviderEnabled(store.tenantId, store.id, 'LINGSHUO'),
    MOCK: await readProviderEnabled(store.tenantId, store.id, 'MOCK'),
    MINO_SUPPORT_SKILL: await readProviderEnabled(store.tenantId, store.id, 'MINO_SUPPORT_SKILL'),
    UNKNOWN: await readProviderEnabled(store.tenantId, store.id, 'UNKNOWN'),
  }

  for (const item of cases) {
    console.log(`${item.pass ? 'PASS' : 'FAIL'} ${item.name}`, JSON.stringify(summarize(item.result)))
  }
  console.log('FINAL_CONFIG', JSON.stringify(finalState))

  if (!cases.every((item) => item.pass)) {
    throw new Error('AI router smoke check failed')
  }
  if (
    finalState.LINGSHUO !== false
    || finalState.MOCK !== false
    || finalState.MINO_SUPPORT_SKILL !== false
    || finalState.UNKNOWN !== false
  ) {
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

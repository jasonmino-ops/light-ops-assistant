import type { AiProviderAdapter, AiSupportProvider } from '../types'
import { lingshuoProviderAdapter } from './lingshuo'
import { minoSupportSkillProviderAdapter } from './mino-support-skill'
import { mockProviderAdapter } from './mock'

const adapters: Partial<Record<AiSupportProvider, AiProviderAdapter>> = {
  LINGSHUO: lingshuoProviderAdapter,
  MINO_SUPPORT_SKILL: minoSupportSkillProviderAdapter,
  MOCK: mockProviderAdapter,
}

export function getAiProviderAdapter(provider: AiSupportProvider | string): AiProviderAdapter | null {
  return adapters[provider as AiSupportProvider] ?? null
}

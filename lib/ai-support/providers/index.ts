import type { AiProviderAdapter, AiSupportProvider } from '../types'
import { lingshuoProviderAdapter } from './lingshuo'
import { mockProviderAdapter } from './mock'

const adapters: Partial<Record<AiSupportProvider, AiProviderAdapter>> = {
  LINGSHUO: lingshuoProviderAdapter,
  MOCK: mockProviderAdapter,
}

export function getAiProviderAdapter(provider: AiSupportProvider | string): AiProviderAdapter | null {
  return adapters[provider as AiSupportProvider] ?? null
}

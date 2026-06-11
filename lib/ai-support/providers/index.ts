import type { AiProviderAdapter, AiSupportProvider } from '../types'
import { lingshuoProviderAdapter } from './lingshuo'

const adapters: Partial<Record<AiSupportProvider, AiProviderAdapter>> = {
  LINGSHUO: lingshuoProviderAdapter,
}

export function getAiProviderAdapter(provider: AiSupportProvider | string): AiProviderAdapter | null {
  return adapters[provider as AiSupportProvider] ?? null
}

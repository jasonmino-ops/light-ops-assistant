import type { AiProviderAdapter, AiSupportProvider } from '../types'

const adapters: Partial<Record<AiSupportProvider, AiProviderAdapter>> = {}

export function getAiProviderAdapter(provider: AiSupportProvider | string): AiProviderAdapter | null {
  return adapters[provider as AiSupportProvider] ?? null
}

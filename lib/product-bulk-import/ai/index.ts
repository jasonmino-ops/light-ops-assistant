import { AnthropicProductImportAiProvider } from './anthropic'
import { productImportAiConfig } from './config'
import type { ProductImportAiProvider } from './contract'

export function createProductImportAiProvider(): ProductImportAiProvider {
  const config = productImportAiConfig()
  // V0.1 intentionally has one adapter and no automatic fallback.
  return new AnthropicProductImportAiProvider(config)
}

export type {
  ProductImportAiCategoryCandidate,
  ProductImportAiPdfBlock,
  ProductImportAiProvider,
  ProductImportAiSpreadsheetMapping,
} from './contract'

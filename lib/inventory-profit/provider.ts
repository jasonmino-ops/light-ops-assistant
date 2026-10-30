import type {
  ExternalSnapshot,
  InventoryItem,
  InventoryListInput,
  ReceivingInput,
  ReceivingResult,
  SalesProfit,
  ProfitPeriod,
} from './contract'
import { ExternalGoogleProvider } from './external-google-provider'

export interface InventoryProfitProvider {
  getSalesProfit(storeId: string, period: ProfitPeriod): Promise<ExternalSnapshot<SalesProfit>>
  listInventory(storeId: string, input: InventoryListInput): Promise<ExternalSnapshot<InventoryItem[]>>
  setMinimumStock(storeId: string, minimumStock: number): Promise<ExternalSnapshot<{ minimumStock: number }>>
  recordReceiving(storeId: string, input: ReceivingInput): Promise<ExternalSnapshot<ReceivingResult>>
}

export function getInventoryProfitProvider(): InventoryProfitProvider {
  return new ExternalGoogleProvider({
    endpoint: process.env.INVENTORY_PROFIT_GOOGLE_URL?.trim() ?? '',
    secret: process.env.INVENTORY_PROFIT_GOOGLE_SECRET?.trim() ?? '',
  })
}

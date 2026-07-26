import { publicUrl } from '@/lib/public-url'

type ComputerConsoleLang = 'zh' | 'km' | 'en'

export function buildComputerConsoleCashierUrl(
  storeCode: string | null | undefined,
  lang: ComputerConsoleLang,
): string | null {
  const currentStoreCode = storeCode?.trim()
  if (!currentStoreCode) return null

  const params = new URLSearchParams({ storeCode: currentStoreCode, lang })
  return publicUrl(`/cashier?${params.toString()}`)
}

type ProductInput = {
  name: string
  imageUrl: string | null
  sellPrice: { toNumber(): number } | number
}

export type MarketingPageDraft = {
  title: string
  subtitle: string
  originalPrice: string
  salePrice: string
  soldCount: number
  buttonText: string
  features: [string, string, string, string, string]
}

export interface MarketingPageGenerator {
  generate(product: ProductInput): MarketingPageDraft
}

function productPrice(product: ProductInput): number {
  return typeof product.sellPrice === 'number' ? product.sellPrice : product.sellPrice.toNumber()
}

function money(value: number): string {
  return Math.max(0.01, value).toFixed(2)
}

export const ruleMarketingPageGenerator: MarketingPageGenerator = {
  generate(product) {
    const price = productPrice(product)
    const originalPrice = price >= 10 ? price * 1.25 : price + 2
    const salePrice = price

    return {
      title: `${product.name} · TikTok Hot Pick`,
      subtitle: 'Limited-time offer with fast local order confirmation.',
      originalPrice: money(originalPrice),
      salePrice: money(salePrice),
      soldCount: 128,
      buttonText: 'Order Now',
      features: [
        'Selected by the shop for daily customer needs',
        'Clear product photo and price before ordering',
        'Cash on delivery and local confirmation supported',
        'Fast Telegram order notification to the merchant',
        'Simple mobile order form for TikTok traffic',
      ],
    }
  },
}

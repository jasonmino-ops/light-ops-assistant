export type RecommendableProduct = {
  isRecommended: boolean
}

export function shouldShowRecommendationBadge(product: RecommendableProduct): boolean {
  return product.isRecommended === true
}

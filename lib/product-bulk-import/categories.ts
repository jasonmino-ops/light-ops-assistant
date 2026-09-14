export type ExistingCategory = {
  id: string
  name: string
  parentId: string | null
}
export type CategoryResolution =
  | { status: 'NONE'; categoryId: null }
  | { status: 'MATCHED'; categoryId: string }
  | { status: 'NOT_FOUND'; categoryId: null }
  | { status: 'AMBIGUOUS'; categoryId: null }

export function normalizeCategoryName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und')
}

export function resolveExistingCategory(
  categories: ExistingCategory[],
  rawLevel1: string | null,
  rawLevel2: string | null,
): CategoryResolution {
  if (!rawLevel1?.trim()) return { status: 'NONE', categoryId: null }

  const normalizedL1 = normalizeCategoryName(rawLevel1)
  const level1Matches = categories.filter(
    (category) => category.parentId === null && normalizeCategoryName(category.name) === normalizedL1,
  )
  if (level1Matches.length === 0) return { status: 'NOT_FOUND', categoryId: null }
  if (level1Matches.length > 1) return { status: 'AMBIGUOUS', categoryId: null }

  if (!rawLevel2?.trim()) return { status: 'MATCHED', categoryId: level1Matches[0].id }
  const normalizedL2 = normalizeCategoryName(rawLevel2)
  const level2Matches = categories.filter(
    (category) => category.parentId === level1Matches[0].id && normalizeCategoryName(category.name) === normalizedL2,
  )
  if (level2Matches.length === 0) return { status: 'NOT_FOUND', categoryId: null }
  if (level2Matches.length > 1) return { status: 'AMBIGUOUS', categoryId: null }
  return { status: 'MATCHED', categoryId: level2Matches[0].id }
}

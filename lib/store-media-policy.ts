// Existing homepage banner limits, shared by both upload destinations and the UI.
export const STORE_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
export const STORE_MEDIA_MAX_SIZE = 2 * 1024 * 1024

export function storeMediaFileError(file: { type: string; size: number }): 'invalidType' | 'tooLarge' | null {
  if (!STORE_MEDIA_TYPES.includes(file.type)) return 'invalidType'
  if (file.size > STORE_MEDIA_MAX_SIZE) return 'tooLarge'
  return null
}

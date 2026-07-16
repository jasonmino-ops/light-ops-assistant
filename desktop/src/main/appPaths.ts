import { join } from 'node:path'

export const STABLE_USER_DATA_DIR_NAME = 'eshop-desktop'

export function stableUserDataPath(appDataPath: string): string {
  return join(appDataPath, STABLE_USER_DATA_DIR_NAME)
}

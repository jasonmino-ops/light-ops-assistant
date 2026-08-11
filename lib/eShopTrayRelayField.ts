/**
 * ES-TRAY-02 Minimal Cloud Relay V0.1 field gate.
 *
 * FIELD ONLY. NOT A PRODUCTION CONTRACT.
 * This intentionally supports one configured store and one fixed Windows
 * queue. It is not activation, binding, discovery, or a runtime platform.
 */

export const ES_TRAY_02_RELAY_VERSION = '0.1' as const
export const ES_TRAY_02_FIELD_QUEUE_NAME = '前台' as const
export const ES_TRAY_02_MAX_COMMAND_BYTES = 3 * 1024 * 1024

const STORE_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const FIELD_TOKEN_MIN_LENGTH = 32
type FieldEnvironment = Readonly<Record<string, string | undefined>>

export type EshopTray02FieldConfig = {
  storeCode: string
  token: string
}

export function readEshopTray02FieldStoreCode(
  env: FieldEnvironment = process.env,
): string | null {
  const storeCode = env.ES_TRAY_02_FIELD_STORE_CODE?.trim() ?? ''
  return STORE_CODE_PATTERN.test(storeCode) ? storeCode : null
}

export function isEshopTray02FieldStore(
  storeCode: string | null | undefined,
  env: FieldEnvironment = process.env,
): boolean {
  const configured = readEshopTray02FieldStoreCode(env)
  return !!configured && configured === storeCode
}

export function readEshopTray02FieldConfig(
  env: FieldEnvironment = process.env,
): EshopTray02FieldConfig | null {
  const storeCode = readEshopTray02FieldStoreCode(env)
  const token = env.ES_TRAY_02_FIELD_TOKEN?.trim() ?? ''
  if (!storeCode || token.length < FIELD_TOKEN_MIN_LENGTH || token.length > 512) return null
  return { storeCode, token }
}

/**
 * E-Shop Desktop — 本地配置
 *
 * 配置文件：%APPDATA%/eshop-desktop/config.json
 * 环境变量覆盖（优先级更高，便于开发调试）：
 *   ESHOP_DESKTOP_BASE_URL    如 http://localhost:3000
 *   ESHOP_DESKTOP_STORE_CODE  门店编码
 *   ESHOP_DESKTOP_LANG        zh | en | km
 *   ESHOP_DESKTOP_FORCE_CUSTOMER=1  单屏开发时强制打开顾客窗口（窗口化）
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger'
import {
  categorizeDiagnosticsUrl,
  maskStoreCode,
  originHostHash,
} from '../shared/deploymentDiagnostics'

export type DesktopConfig = {
  baseUrl: string
  storeCode: string
  lang: 'zh' | 'en' | 'km'
  forceCustomerWindow: boolean
}

export const DEFAULT_BASE_URL = 'https://elifekh.com'

export function parseConfigFile(raw: string): Partial<DesktopConfig> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Partial<DesktopConfig> = {}
    if (typeof parsed.baseUrl === 'string' && /^https?:\/\//.test(parsed.baseUrl)) {
      out.baseUrl = parsed.baseUrl.replace(/\/+$/, '')
    }
    if (typeof parsed.storeCode === 'string') out.storeCode = parsed.storeCode.trim()
    if (parsed.lang === 'zh' || parsed.lang === 'en' || parsed.lang === 'km') out.lang = parsed.lang
    return out
  } catch {
    return {}
  }
}

let cached: DesktopConfig | null = null
let configPath: string | null = null

export function loadConfig(userDataDir: string): DesktopConfig {
  configPath = join(userDataDir, 'config.json')
  let fromFile: Partial<DesktopConfig> = {}
  if (existsSync(configPath)) {
    fromFile = parseConfigFile(readFileSync(configPath, 'utf8'))
  } else {
    // 首次启动写入模板，方便门店部署时手工填写 storeCode
    try {
      writeFileSync(
        configPath,
        JSON.stringify({ baseUrl: DEFAULT_BASE_URL, storeCode: '', lang: 'zh' }, null, 2),
        'utf8',
      )
    } catch (error) {
      logger.warn('config.write-template-failed', { error: String(error) })
    }
  }
  const env = process.env
  cached = {
    baseUrl: (env.ESHOP_DESKTOP_BASE_URL?.replace(/\/+$/, '') || fromFile.baseUrl || DEFAULT_BASE_URL),
    storeCode: env.ESHOP_DESKTOP_STORE_CODE?.trim() || fromFile.storeCode || '',
    lang: (env.ESHOP_DESKTOP_LANG === 'en' || env.ESHOP_DESKTOP_LANG === 'km' || env.ESHOP_DESKTOP_LANG === 'zh')
      ? env.ESHOP_DESKTOP_LANG
      : fromFile.lang || 'zh',
    forceCustomerWindow: env.ESHOP_DESKTOP_FORCE_CUSTOMER === '1',
  }
  logger.info('config.loaded', {
    baseUrlCategory: categorizeDiagnosticsUrl(cached.baseUrl),
    originHostHash: originHostHash(cached.baseUrl),
    maskedStoreCode: maskStoreCode(cached.storeCode),
    lang: cached.lang,
    configLocation: configPath ? 'userData/config.json' : 'unknown',
  })
  return cached
}

export function getConfig(): DesktopConfig {
  if (!cached) throw new Error('config not loaded')
  return cached
}

export function getConfigPath() {
  return configPath
}

function query(config: DesktopConfig, extra?: Record<string, string>) {
  const params = new URLSearchParams()
  if (config.storeCode) params.set('storeCode', config.storeCode)
  params.set('lang', config.lang)
  for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
  return `?${params.toString()}`
}

/** 员工窗口 URL：有 storeCode 直接进 POS，否则进模式选择页 */
export function employeeUrl(config: DesktopConfig = getConfig()): string {
  if (!config.storeCode) return `${config.baseUrl}/desktop${query(config)}`
  return `${config.baseUrl}/desktop/pos${query(config, { mode: 'pos' })}`
}

/** 顾客窗口 URL */
export function customerUrl(config: DesktopConfig = getConfig()): string {
  return `${config.baseUrl}/desktop/display${query(config)}`
}

/** 导航白名单：仅允许与 baseUrl 同源 */
export function isAllowedNavigation(url: string, config: DesktopConfig = getConfig()): boolean {
  try {
    return new URL(url).origin === new URL(config.baseUrl).origin
  } catch {
    return false
  }
}

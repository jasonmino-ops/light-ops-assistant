import { existsSync, readFileSync } from 'node:fs'
import type { Env } from './env'
import {
  AUTHCERT_OVERRIDE_KEY, canWriteQzDir, eshopCertPath, qzPropertiesPath,
} from './env'
import { getProperty } from './properties'
import { overrideContains } from './override'
import { loadCertificatePackage } from './certPackage'
import {
  compareVersions, fingerprintsEqual, isCurrentlyValid, parseCertificate,
} from './certificate'
import { readState } from './state'
import { detectQzVersion } from './qz'
import type { CertificatePackage, CheckResult, Status, StatusCode } from './types'

export function computeStatus(env: Env): Status {
  const checks: CheckResult[] = []
  const now = env.now()

  // ---- 证书包 ----
  let pkg: CertificatePackage | null = null
  let pkgError: string | null = null
  try {
    pkg = loadCertificatePackage(env.packageDir)
    checks.push(ok('PACKAGE_PRESENT', '随程序携带的证书包', `${pkg.manifest.displayName} v${pkg.manifest.version}`))
  } catch (e) {
    pkgError = (e as Error).message
    checks.push(bad('PACKAGE_PRESENT', '随程序携带的证书包', `不可用：${pkgError}`, false))
  }

  // ---- QZ Tray ----
  const qzVersion = env.qzInstallDir ? detectQzVersion(env) : null
  const propsPath = qzPropertiesPath(env)
  if (env.qzInstallDir) {
    checks.push(ok('QZ_INSTALLED', 'QZ Tray 已安装', env.qzInstallDir))
  } else {
    checks.push(bad('QZ_INSTALLED', 'QZ Tray 已安装', '未检测到 QZ Tray，请先安装 QZ Tray 再运行本工具', false))
  }

  const minQz = pkg?.manifest.minimumQzVersion ?? null
  if (env.qzInstallDir) {
    if (!qzVersion) {
      checks.push(bad('QZ_VERSION', 'QZ Tray 版本', '无法识别版本，无法确认是否支持 authcert.override', false))
    } else if (minQz && compareVersions(qzVersion, minQz) < 0) {
      checks.push(bad('QZ_VERSION', 'QZ Tray 版本', `${qzVersion} 低于要求的 ${minQz}，不支持自定义 Root`, false))
    } else {
      checks.push(ok('QZ_VERSION', 'QZ Tray 版本', qzVersion + (minQz ? `（要求 ≥ ${minQz}）` : '')))
    }
  }

  // ---- 管理员权限 ----
  const isAdmin = canWriteQzDir(env)
  if (env.qzInstallDir) {
    if (isAdmin) {
      checks.push(ok('ADMIN_RIGHTS', '管理员权限', '可写入 QZ Tray 配置'))
    } else {
      checks.push(bad('ADMIN_RIGHTS', '管理员权限', '当前进程无法写入 QZ Tray 目录，请以管理员身份重新运行本程序', false))
    }
  }

  // ---- 已部署的 Root ----
  const state = readState(env)
  const certPath = eshopCertPath(env)
  const certExists = existsSync(certPath)
  let installedInfo: ReturnType<typeof parseCertificate> | null = null
  let certReadError: string | null = null

  if (certExists) {
    try {
      installedInfo = parseCertificate(readFileSync(certPath, 'utf8'))
    } catch (e) {
      certReadError = (e as Error).message
    }
  }

  const everInstalled = Boolean(state) || certExists

  if (everInstalled) {
    if (!certExists) {
      checks.push(bad('ROOT_FILE', 'Root 证书文件', `记录显示已安装，但文件缺失：${certPath}`, true))
    } else if (!installedInfo) {
      checks.push(bad('ROOT_FILE', 'Root 证书文件', `文件损坏或不是有效证书：${certReadError}`, true))
    } else {
      checks.push(ok('ROOT_FILE', 'Root 证书文件', certPath))
    }
  }

  if (everInstalled && installedInfo && pkg) {
    if (fingerprintsEqual(installedInfo.fingerprint, pkg.manifest.rootFingerprint)) {
      checks.push(ok('ROOT_FINGERPRINT', 'Root 指纹', installedInfo.fingerprint))
    } else if (state && state.version < pkg.manifest.version) {
      // 版本旧属于"需要更新"，不算指纹错误
      checks.push(ok('ROOT_FINGERPRINT', 'Root 指纹', `${installedInfo.fingerprint}（旧版本）`))
    } else {
      checks.push(bad('ROOT_FINGERPRINT', 'Root 指纹', `与证书包不一致：本机 ${installedInfo.fingerprint}`, true))
    }
  }

  if (everInstalled && installedInfo) {
    if (isCurrentlyValid(installedInfo, now)) {
      checks.push(ok('ROOT_VALIDITY', 'Root 有效期', `${installedInfo.validFrom} ~ ${installedInfo.validTo}`))
    } else {
      checks.push(bad('ROOT_VALIDITY', 'Root 有效期', `已过期或尚未生效：${installedInfo.validFrom} ~ ${installedInfo.validTo}`, false))
    }
  }

  // ---- QZ authcert.override 配置 ----
  if (everInstalled && env.qzInstallDir && propsPath) {
    const propsText = existsSync(propsPath) ? readFileSync(propsPath, 'utf8') : ''
    const overrideValue = getProperty(propsText, AUTHCERT_OVERRIDE_KEY)
    if (!existsSync(propsPath)) {
      checks.push(bad('QZ_OVERRIDE_CONFIG', 'QZ 信任配置', `${propsPath} 不存在`, true))
    } else if (overrideValue === null) {
      checks.push(bad('QZ_OVERRIDE_CONFIG', 'QZ 信任配置', `${AUTHCERT_OVERRIDE_KEY} 缺失`, true))
    } else if (!overrideContains(overrideValue, certPath)) {
      checks.push(bad('QZ_OVERRIDE_CONFIG', 'QZ 信任配置', `${AUTHCERT_OVERRIDE_KEY} 未指向 E-Shop Root：${overrideValue}`, true))
    } else {
      checks.push(ok('QZ_OVERRIDE_CONFIG', 'QZ 信任配置', `${AUTHCERT_OVERRIDE_KEY}=${overrideValue}`))
    }
  }

  // ---- 版本 ----
  if (everInstalled && pkg && state) {
    if (state.version < pkg.manifest.version) {
      checks.push(bad('PACKAGE_VERSION', '证书包版本', `本机 v${state.version}，程序携带 v${pkg.manifest.version}`, false))
    } else {
      checks.push(ok('PACKAGE_VERSION', '证书包版本', `v${state.version}`))
    }
  }

  const code = deriveCode({ checks, everInstalled, hasPackage: Boolean(pkg) })

  return {
    code,
    headline: HEADLINES[code],
    checks,
    qz: {
      installed: Boolean(env.qzInstallDir),
      version: qzVersion,
      installDir: env.qzInstallDir,
      propertiesPath: propsPath,
    },
    installed: {
      certificateId: state?.certificateId ?? null,
      version: state?.version ?? null,
      fingerprint: installedInfo?.fingerprint ?? null,
      validFrom: installedInfo?.validFrom ?? null,
      validTo: installedInfo?.validTo ?? null,
    },
    package: {
      certificateId: pkg?.manifest.certificateId ?? null,
      version: pkg?.manifest.version ?? null,
      fingerprint: pkg?.manifest.rootFingerprint ?? null,
      validFrom: pkg?.manifest.validFrom ?? null,
      validTo: pkg?.manifest.validTo ?? null,
      minimumQzVersion: minQz,
      error: pkgError,
    },
    isAdmin,
  }
}

const HEADLINES: Record<StatusCode, string> = {
  NOT_INSTALLED: '未安装',
  OK: '正常',
  NEEDS_UPDATE: '需要更新',
  MISCONFIGURED: '配置异常',
}

function deriveCode(input: {
  checks: CheckResult[]
  everInstalled: boolean
  hasPackage: boolean
}): StatusCode {
  const failed = (id: CheckResult['id']) =>
    input.checks.some((c) => c.id === id && !c.ok)

  // 环境层面的问题优先于安装状态：QZ 没装/版本不够/无权限/证书包坏了，一律配置异常。
  if (failed('PACKAGE_PRESENT') || failed('QZ_INSTALLED') || failed('QZ_VERSION') || failed('ADMIN_RIGHTS')) {
    return 'MISCONFIGURED'
  }
  if (!input.everInstalled) return 'NOT_INSTALLED'
  if (failed('ROOT_FILE') || failed('ROOT_FINGERPRINT') || failed('ROOT_VALIDITY') || failed('QZ_OVERRIDE_CONFIG')) {
    return 'MISCONFIGURED'
  }
  if (failed('PACKAGE_VERSION')) return 'NEEDS_UPDATE'
  return 'OK'
}

function ok(id: CheckResult['id'], label: string, detail: string): CheckResult {
  return { id, ok: true, repairable: false, label, detail }
}

function bad(id: CheckResult['id'], label: string, detail: string, repairable: boolean): CheckResult {
  return { id, ok: false, repairable, label, detail }
}

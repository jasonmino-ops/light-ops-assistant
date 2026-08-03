import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Env } from './env'
import {
  AUTHCERT_OVERRIDE_KEY, canWriteQzDir, ensureEshopDirs, eshopBackupDir,
  eshopCertPath, eshopLogPath, eshopStatePath, qzPropertiesPath,
} from './env'
import { appendLog, atomicWrite, backupFile, restoreFile, timestamp } from './fsAtomic'
import { getProperty, removeProperty, setProperty } from './properties'
import { addToOverride, overrideContains, removeFromOverride, splitOverride } from './override'
import { loadCertificatePackage } from './certPackage'
import { compareVersions, fingerprintsEqual, parseCertificate } from './certificate'
import { clearState, readState, writeState } from './state'
import { detectQzVersion, isQzRunning, restartQzIfRunning, startQz } from './qz'
import { computeStatus } from './status'
import type { ActionName, ActionResult, ActionStep, CertificatePackage, InstallState } from './types'
import { STATE_SCHEMA } from './state'

/** 一次操作的事务上下文：记录已完成步骤 + 逆序撤销动作。 */
type Txn = {
  steps: ActionStep[]
  undo: Array<{ label: string; run: () => void }>
}

function step(txn: Txn, message: string): void {
  txn.steps.push({ message, ok: true })
}

class ActionError extends Error {}

export function install(env: Env): ActionResult {
  return run(env, 'install', (txn) => {
    const pkg = requireReadyEnvironment(env, txn)
    const state = readState(env)
    if (state && state.version === pkg.manifest.version && isFullyHealthy(env)) {
      step(txn, `已安装 ${pkg.manifest.displayName} v${pkg.manifest.version}，状态正常，无需重复安装`)
      return
    }
    deploy(env, pkg, txn)
  })
}

export function update(env: Env): ActionResult {
  return run(env, 'update', (txn) => {
    const pkg = requireReadyEnvironment(env, txn)
    const state = readState(env)
    if (!state) throw new ActionError('本机没有 E-Shop Root 安装记录，请先执行【安装】')
    if (compareVersionsNum(state.version, pkg.manifest.version) > 0) {
      throw new ActionError(`本机版本 v${state.version} 高于程序携带的 v${pkg.manifest.version}，拒绝降级`)
    }
    if (state.version === pkg.manifest.version && isFullyHealthy(env)) {
      step(txn, `已是最新版本 v${state.version}，无需更新`)
      return
    }
    step(txn, `准备从 v${state.version} 更新到 v${pkg.manifest.version}`)
    deploy(env, pkg, txn)
  })
}

export function repair(env: Env): ActionResult {
  return run(env, 'repair', (txn) => {
    const pkg = requireReadyEnvironment(env, txn)
    step(txn, '按证书包重新写入 Root 证书与 QZ 信任配置')
    deploy(env, pkg, txn)
  })
}

export function uninstall(env: Env): ActionResult {
  return run(env, 'uninstall', (txn) => {
    const propsPath = qzPropertiesPath(env)
    const certPath = eshopCertPath(env)
    const state = readState(env)
    const stamp = timestamp(env.now())
    const qzWasRunning = isQzRunning(env)

    ensureEshopDirs(env)

    // QZ 配置：只摘掉 E-Shop 自己那一条，其它条目与其它属性一律不动。
    if (propsPath && existsSync(propsPath)) {
      const backup = backupFile(propsPath, eshopBackupDir(env), stamp)
      const original = readFileSync(propsPath, 'utf8')
      if (backup) txn.undo.push({ label: '还原 qz-tray.properties', run: () => restoreFile(backup, propsPath) })

      const current = getProperty(original, AUTHCERT_OVERRIDE_KEY)
      const remaining = removeFromOverride(current, certPath)
      let next: string
      if (splitOverride(remaining).length === 0) {
        next = removeProperty(original, AUTHCERT_OVERRIDE_KEY)
        step(txn, `已移除 ${AUTHCERT_OVERRIDE_KEY}（该属性只包含 E-Shop Root）`)
      } else {
        next = setProperty(original, AUTHCERT_OVERRIDE_KEY, remaining)
        step(txn, `已从 ${AUTHCERT_OVERRIDE_KEY} 中摘除 E-Shop Root，保留其它证书：${remaining}`)
      }
      atomicWrite(propsPath, next)

      const verify = getProperty(readFileSync(propsPath, 'utf8'), AUTHCERT_OVERRIDE_KEY)
      if (overrideContains(verify, certPath)) throw new ActionError('校验失败：QZ 配置中仍指向 E-Shop Root')
      if (state && state.priorPropertyValue !== null) {
        const matches = (verify ?? '') === state.priorPropertyValue
        step(txn, matches
          ? '已恢复安装前的 authcert.override 原值'
          : `authcert.override 现为 "${verify ?? '(已删除)'}"，与安装前的 "${state.priorPropertyValue}" 不同（安装后有第三方改动，已保留）`)
      }
    } else if (propsPath) {
      step(txn, 'QZ 配置文件不存在，跳过配置清理')
    }

    // E-Shop 自己的文件
    if (existsSync(certPath)) {
      const certBackup = backupFile(certPath, eshopBackupDir(env), stamp)
      if (certBackup) txn.undo.push({ label: '还原 Root 证书', run: () => restoreFile(certBackup, certPath) })
      rmSync(certPath, { force: true })
      step(txn, `已删除 Root 证书：${certPath}`)
    }
    if (!state) step(txn, '无安装记录，仅按已知路径清理 E-Shop 自己添加的内容')
    clearState(env)
    step(txn, '已清除安装记录')

    if (qzWasRunning) {
      const restarted = restartQzIfRunning(env)
      step(txn, restarted.ok ? 'QZ Tray 已重启' : 'QZ Tray 未能自动启动，请手动启动')
    }
    step(txn, 'QZ Tray 本体与 QZ 官方证书未被改动')
  })
}

// ---------------------------------------------------------------------------

/** 安装/更新/修复共用的落地流程：备份 → 临时文件 → 原子替换 → 校验。 */
function deploy(env: Env, pkg: CertificatePackage, txn: Txn): void {
  const propsPath = qzPropertiesPath(env) as string
  const certPath = eshopCertPath(env)
  const stamp = timestamp(env.now())
  const priorState = readState(env)
  const qzWasRunning = isQzRunning(env)

  ensureEshopDirs(env)

  // 1) 备份
  const propsBackup = backupFile(propsPath, eshopBackupDir(env), stamp)
  if (propsBackup) {
    txn.undo.push({ label: '还原 qz-tray.properties', run: () => restoreFile(propsBackup, propsPath) })
    step(txn, `已备份 QZ 配置：${propsBackup}`)
  }
  const certBackup = backupFile(certPath, eshopBackupDir(env), stamp)
  if (certBackup) {
    txn.undo.push({ label: '还原原 Root 证书', run: () => restoreFile(certBackup, certPath) })
    step(txn, `已备份原 Root 证书：${certBackup}`)
  } else {
    txn.undo.push({ label: '删除新写入的 Root 证书', run: () => rmSync(certPath, { force: true }) })
  }
  if (priorState) {
    const snapshot = JSON.stringify(priorState)
    txn.undo.push({ label: '还原安装记录', run: () => atomicWrite(eshopStatePath(env), snapshot) })
  } else {
    txn.undo.push({ label: '清除安装记录', run: () => clearState(env) })
  }

  // 2) 写证书 → 校验
  mkdirSync(dirname(certPath), { recursive: true })
  atomicWrite(certPath, pkg.pem)
  const written = parseCertificate(readFileSync(certPath, 'utf8'))
  if (!fingerprintsEqual(written.fingerprint, pkg.manifest.rootFingerprint)) {
    throw new ActionError('校验失败：写入的 Root 证书指纹与证书包不一致')
  }
  step(txn, `已写入 Root 证书：${certPath}`)
  step(txn, `指纹校验通过：${written.fingerprint}`)

  // 3) 改 QZ 配置 → 校验（只动 authcert.override 一行）
  const originalProps = readFileSync(propsPath, 'utf8')
  const currentOverride = getProperty(originalProps, AUTHCERT_OVERRIDE_KEY)
  const nextOverride = addToOverride(currentOverride, certPath)
  atomicWrite(propsPath, setProperty(originalProps, AUTHCERT_OVERRIDE_KEY, nextOverride))

  const verifyText = readFileSync(propsPath, 'utf8')
  const verifyOverride = getProperty(verifyText, AUTHCERT_OVERRIDE_KEY)
  if (!overrideContains(verifyOverride, certPath)) {
    throw new ActionError('校验失败：QZ 配置未正确指向 E-Shop Root')
  }
  assertUnrelatedPropertiesIntact(originalProps, verifyText)
  step(txn, `已配置 ${AUTHCERT_OVERRIDE_KEY}=${verifyOverride}`)

  // 4) 记录状态。priorPropertyValue 永远保留"E-Shop 介入之前"的原值，
  //    否则第二次更新会把上一次自己写的值当成原值，卸载就还原不回去了。
  const state: InstallState = {
    schema: STATE_SCHEMA,
    certificateId: pkg.manifest.certificateId,
    version: pkg.manifest.version,
    rootFingerprint: pkg.manifest.rootFingerprint,
    installedAt: env.now().toISOString(),
    certPath,
    propertyCreatedByEshop: priorState ? priorState.propertyCreatedByEshop : currentOverride === null,
    priorPropertyValue: priorState ? priorState.priorPropertyValue : currentOverride,
    propertiesBackupPath: propsBackup ?? priorState?.propertiesBackupPath ?? null,
  }
  writeState(env, state)
  step(txn, `已记录安装状态 v${state.version}`)

  // 5) 重启 QZ（仅当它本来在运行）
  if (qzWasRunning) {
    const restarted = restartQzIfRunning(env)
    step(txn, restarted.ok ? 'QZ Tray 已重启，新 Root 生效' : 'QZ Tray 未能自动启动，请手动启动后生效')
  } else {
    step(txn, 'QZ Tray 当前未运行，下次启动即生效')
  }
}

/** 除了 authcert.override，其它属性必须一字不变。 */
function assertUnrelatedPropertiesIntact(before: string, after: string): void {
  const strip = (text: string) => removeProperty(text, AUTHCERT_OVERRIDE_KEY).replace(/\s+$/, '')
  if (strip(before) !== strip(after)) {
    throw new ActionError('校验失败：改动波及了 authcert.override 以外的 QZ 配置')
  }
}

function requireReadyEnvironment(env: Env, txn: Txn): CertificatePackage {
  let pkg: CertificatePackage
  try {
    pkg = loadCertificatePackage(env.packageDir)
  } catch (e) {
    throw new ActionError(`证书包不可用：${(e as Error).message}`)
  }
  if (!env.qzInstallDir) throw new ActionError('未检测到 QZ Tray，请先安装 QZ Tray')
  const propsPath = qzPropertiesPath(env) as string
  if (!existsSync(propsPath)) {
    throw new ActionError(`QZ 配置文件缺失：${propsPath}。请先修复或重装 QZ Tray，本工具不会凭空创建该文件`)
  }
  const qzVersion = detectQzVersion(env)
  if (!qzVersion) throw new ActionError('无法识别 QZ Tray 版本，拒绝继续')
  if (compareVersions(qzVersion, pkg.manifest.minimumQzVersion) < 0) {
    throw new ActionError(`QZ Tray ${qzVersion} 低于要求的 ${pkg.manifest.minimumQzVersion}，不支持自定义 Root`)
  }
  if (!canWriteQzDir(env)) {
    throw new ActionError('没有管理员权限：无法写入 QZ Tray 目录。请右键以管理员身份运行本程序')
  }
  step(txn, `环境检查通过（QZ Tray ${qzVersion}）`)
  return pkg
}

function isFullyHealthy(env: Env): boolean {
  return computeStatus(env).code === 'OK'
}

function compareVersionsNum(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1
}

function run(env: Env, action: ActionName, body: (txn: Txn) => void): ActionResult {
  const txn: Txn = { steps: [], undo: [] }
  const logPath = eshopLogPath(env)
  appendLog(logPath, `[${action}] start`, env.now())

  try {
    body(txn)
    appendLog(logPath, `[${action}] ok — ${txn.steps.map((s) => s.message).join(' | ')}`, env.now())
    return { action, ok: true, rolledBack: false, steps: txn.steps, error: null, status: computeStatus(env) }
  } catch (e) {
    const message = e instanceof ActionError ? e.message : `未预期的错误：${(e as Error).message}`
    txn.steps.push({ message: `失败：${message}`, ok: false })

    let rolledBack = true
    for (const entry of [...txn.undo].reverse()) {
      try {
        entry.run()
        txn.steps.push({ message: `已回滚：${entry.label}`, ok: true })
      } catch (undoError) {
        rolledBack = false
        txn.steps.push({ message: `回滚失败：${entry.label} — ${(undoError as Error).message}`, ok: false })
      }
    }
    if (txn.undo.length === 0) {
      txn.steps.push({ message: '未产生任何改动，无需回滚', ok: true })
    }
    // 尽力恢复 QZ 运行状态
    try {
      if (env.qzInstallDir && !isQzRunning(env)) startQz(env)
    } catch {
      // 忽略：QZ 启动失败不改变回滚结论
    }

    appendLog(logPath, `[${action}] failed — ${message} — rolledBack=${rolledBack}`, env.now())
    return { action, ok: false, rolledBack, steps: txn.steps, error: message, status: computeStatus(env) }
  }
}

/** 供 UI 使用的只读状态查询。 */
export function status(env: Env) {
  return computeStatus(env)
}

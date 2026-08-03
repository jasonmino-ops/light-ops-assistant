// 公共类型。core/ 目录内所有模块都不依赖 electron，
// 这样同一份逻辑既能在独立小程序里跑，也能直接搬进 desktop/src/main。

/** Certificate Package 清单（v1）。只描述公开证书，绝不包含任何私钥。 */
export type CertificatePackageManifest = {
  schema: 'eshop.certificate-package/v1'
  /** 证书身份，同一条 Root 链在所有门店保持一致。 */
  certificateId: string
  /** 单调递增的包版本，用于判断"需要更新"。 */
  version: number
  displayName: string
  /** 包内 Root 公钥证书文件名（PEM）。 */
  rootFile: string
  /** Root 证书 SHA-256 指纹，大写十六进制、冒号分隔。 */
  rootFingerprint: string
  validFrom: string
  validTo: string
  /** 低于此版本的 QZ Tray 不支持 authcert.override，判为配置异常。 */
  minimumQzVersion: string
}

/** 从包里解析出来的、已经过校验的证书包。 */
export type CertificatePackage = {
  manifest: CertificatePackageManifest
  /** Root 证书 PEM 文本。 */
  pem: string
  /** 包目录绝对路径。 */
  dir: string
}

export type CertificateInfo = {
  subject: string
  issuer: string
  fingerprint: string
  validFrom: string
  validTo: string
  isCa: boolean
}

/** 本机安装状态记录，由 Certificate Manager 自己写，卸载时用于精确还原。 */
export type InstallState = {
  schema: 'eshop.certificate-manager.state/v1'
  certificateId: string
  version: number
  rootFingerprint: string
  installedAt: string
  /** 已部署的 Root 证书绝对路径。 */
  certPath: string
  /**
   * true  = authcert.override 这一条属性原本不存在，是 E-Shop 新增的，卸载时整条删除；
   * false = 属性原本已存在，E-Shop 只往里追加了自己的路径，卸载时只摘掉自己那一段。
   */
  propertyCreatedByEshop: boolean
  /** 安装前 authcert.override 的原始值（不存在为 null），用于回滚。 */
  priorPropertyValue: string | null
  /** 安装前 qz-tray.properties 的备份文件绝对路径（原文件不存在为 null）。 */
  propertiesBackupPath: string | null
}

export type StatusCode =
  | 'NOT_INSTALLED'
  | 'OK'
  | 'NEEDS_UPDATE'
  | 'MISCONFIGURED'

export type CheckId =
  | 'PACKAGE_PRESENT'
  | 'QZ_INSTALLED'
  | 'QZ_VERSION'
  | 'ADMIN_RIGHTS'
  | 'ROOT_FILE'
  | 'ROOT_FINGERPRINT'
  | 'ROOT_VALIDITY'
  | 'QZ_OVERRIDE_CONFIG'
  | 'PACKAGE_VERSION'

export type CheckResult = {
  id: CheckId
  ok: boolean
  /** 该项是否可由【修复】自动处理。 */
  repairable: boolean
  label: string
  detail: string
}

export type Status = {
  code: StatusCode
  headline: string
  checks: CheckResult[]
  qz: {
    installed: boolean
    version: string | null
    installDir: string | null
    propertiesPath: string | null
  }
  installed: {
    certificateId: string | null
    version: number | null
    fingerprint: string | null
    validFrom: string | null
    validTo: string | null
  }
  package: {
    certificateId: string | null
    version: number | null
    fingerprint: string | null
    validFrom: string | null
    validTo: string | null
    minimumQzVersion: string | null
    error: string | null
  }
  isAdmin: boolean
}

export type ActionName = 'install' | 'update' | 'repair' | 'uninstall'

export type ActionStep = {
  message: string
  ok: boolean
}

export type ActionResult = {
  action: ActionName
  ok: boolean
  /** 失败时是否已成功回滚到操作前状态。 */
  rolledBack: boolean
  steps: ActionStep[]
  error: string | null
  status: Status
}

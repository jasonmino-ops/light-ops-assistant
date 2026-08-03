// 渲染层刻意不使用 import/export：以普通脚本编译，避免 CommonJS 产物在
// 浏览器环境里引用 exports。类型在本文件内联声明，和 core/types.ts 保持一致。
;(function () {
  type StatusCode = 'NOT_INSTALLED' | 'OK' | 'NEEDS_UPDATE' | 'MISCONFIGURED'

  type CheckResult = { id: string; ok: boolean; repairable: boolean; label: string; detail: string }

  type Status = {
    code: StatusCode
    headline: string
    checks: CheckResult[]
    qz: { installed: boolean; version: string | null; installDir: string | null; propertiesPath: string | null }
    installed: {
      certificateId: string | null; version: number | null; fingerprint: string | null
      validFrom: string | null; validTo: string | null
    }
    package: {
      certificateId: string | null; version: number | null; fingerprint: string | null
      validFrom: string | null; validTo: string | null; minimumQzVersion: string | null; error: string | null
    }
    isAdmin: boolean
  }

  type ActionResult = {
    action: string
    ok: boolean
    rolledBack: boolean
    steps: Array<{ message: string; ok: boolean }>
    error: string | null
    status: Status
  }

  type Bridge = {
    status: () => Promise<Status>
    log: () => Promise<string[]>
    install: () => Promise<ActionResult>
    update: () => Promise<ActionResult>
    repair: () => Promise<ActionResult>
    uninstall: () => Promise<ActionResult | null>
    openLogFolder: () => Promise<void>
  }

  const bridge = (window as unknown as { certManager: Bridge }).certManager
  const $ = (id: string) => document.getElementById(id) as HTMLElement

  const NOTES: Record<StatusCode, string> = {
    NOT_INSTALLED: '本机尚未部署 E-Shop Root Certificate，点击【安装】。',
    OK: 'E-Shop Root 已部署，QZ Tray 信任配置正确。',
    NEEDS_UPDATE: '程序携带了更新版本的 Root，点击【更新】。',
    MISCONFIGURED: '配置存在问题，请查看下方检查结果后点击【修复】。',
  }

  function setText(id: string, value: string): void {
    $(id).textContent = value
  }

  function toggle(id: string, enabled: boolean): void {
    ;($(id) as HTMLButtonElement).disabled = !enabled
  }

  function renderStatus(status: Status): void {
    $('status-card').className = `status-card state-${status.code}`
    setText('status-text', status.headline)
    setText('status-note', status.package.error ? `证书包不可用：${status.package.error}` : NOTES[status.code])

    setText('i-qz-installed', status.qz.installed ? '是' : '否')
    setText('i-qz-version', status.qz.version ?? '未识别')
    setText('i-qz-dir', status.qz.installDir ?? '—')
    setText('i-installed-version', status.installed.version === null ? '未安装' : `v${status.installed.version}`)
    setText('i-package-version', status.package.version === null ? '不可用' : `v${status.package.version}`)
    setText('i-fingerprint', status.installed.fingerprint ?? status.package.fingerprint ?? '—')
    setText(
      'i-validity',
      status.installed.validFrom
        ? `${status.installed.validFrom} ~ ${status.installed.validTo}`
        : status.package.validFrom
          ? `${status.package.validFrom} ~ ${status.package.validTo}（未安装）`
          : '—',
    )
    setText('i-admin', status.isAdmin ? '已获得' : '不足，请以管理员身份运行')

    const list = $('check-list')
    list.textContent = ''
    for (const check of status.checks) {
      const li = document.createElement('li')
      li.className = check.ok ? 'pass' : 'fail'
      const mark = document.createElement('span')
      mark.className = 'mark'
      mark.textContent = check.ok ? '✓' : '✕'
      const label = document.createElement('span')
      label.className = 'label'
      label.textContent = check.label
      const detail = document.createElement('span')
      detail.className = 'detail'
      detail.textContent = check.detail + (!check.ok && check.repairable ? '（可通过【修复】处理）' : '')
      li.append(mark, label, detail)
      list.append(li)
    }

    const envReady = status.package.error === null && status.qz.installed && status.isAdmin
    toggle('btn-install', envReady && status.code !== 'OK')
    toggle('btn-update', envReady && status.installed.version !== null)
    toggle('btn-repair', envReady && status.installed.version !== null)
    // 只有本机确实存在 E-Shop 留下的东西时才允许卸载：
    // 有安装记录，或者存在指向我们自己文件/配置的可修复异常（记录丢了但残留还在）。
    const hasEshopFootprint =
      status.installed.version !== null || status.checks.some((c) => !c.ok && c.repairable)
    toggle('btn-uninstall', hasEshopFootprint)
  }

  function setBusy(busy: boolean): void {
    for (const id of ['btn-install', 'btn-update', 'btn-repair', 'btn-uninstall', 'refresh']) {
      ;($(id) as HTMLButtonElement).disabled = busy
    }
  }

  function appendOutput(lines: string[]): void {
    $('log-output').textContent = lines.join('\n')
  }

  function describe(result: ActionResult): string[] {
    const head = `【${result.action}】${result.ok ? '成功' : '失败'}`
    const tail = result.ok
      ? []
      : [result.rolledBack ? '已回滚到操作前状态' : '⚠ 回滚未完全成功，请检查数据目录中的备份']
    return [head, ...result.steps.map((s) => `${s.ok ? '  ·' : '  ✕'} ${s.message}`), ...tail]
  }

  async function refresh(): Promise<void> {
    renderStatus(await bridge.status())
    appendOutput(await bridge.log())
  }

  async function runAction(fn: () => Promise<ActionResult | null>): Promise<void> {
    setBusy(true)
    let lines: string[] = []
    try {
      const result = await fn()
      lines = result === null ? ['已取消'] : describe(result)
    } catch (e) {
      lines = [`意外错误：${(e as Error).message}`]
    } finally {
      renderStatus(await bridge.status())
      appendOutput(lines)
      setBusy(false)
    }
  }

  $('refresh').addEventListener('click', () => void refresh())
  $('btn-install').addEventListener('click', () => void runAction(() => bridge.install()))
  $('btn-update').addEventListener('click', () => void runAction(() => bridge.update()))
  $('btn-repair').addEventListener('click', () => void runAction(() => bridge.repair()))
  $('btn-uninstall').addEventListener('click', () => void runAction(() => bridge.uninstall()))
  $('open-folder').addEventListener('click', () => void bridge.openLogFolder())

  void refresh()
})()

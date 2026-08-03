import type { Env } from './env'
import { canWriteQzDir } from './env'

/**
 * 管理员权限判定。
 *
 * 现场问题：portable exe 的 manifest 已确认是 requireAdministrator、UAC 也点了"是"，
 * 界面却仍显示"管理员权限不足"。根因是旧实现把"能不能写 QZ 安装目录"当成权限判据 ——
 * QZ 目录没被发现（qzInstallDir 为 null）时探针必然失败，权限就被误报成不足。
 *
 * 现在改成判断**进程令牌是否已提升**，与目录发现完全解耦：
 *
 *   WindowsPrincipal.IsInRole(BuiltInRole::Administrator)
 *
 * 这个调用只在令牌里的 Administrators 组处于 **enabled** 状态时才为 true。
 * 未提升的管理员用户，该组是 deny-only，返回 false —— 正是我们要的"是否已提升"。
 * 同时单独查一次组成员身份（S-1-5-32-544 是否出现在令牌里），
 * 用来区分"根本不是管理员"和"是管理员但没提权"，好给出不同的提示。
 */

export type AdminCheck = {
  /** 当前进程是否以提升的令牌运行。 */
  elevated: boolean
  /** 当前用户是否属于 Administrators 组；查不到为 null。 */
  inAdminGroup: boolean | null
  source: 'token' | 'write-probe'
  detail: string
}

const PROBE_SCRIPT = [
  '$ErrorActionPreference=\'Stop\';',
  '$id=[Security.Principal.WindowsIdentity]::GetCurrent();',
  '$p=New-Object Security.Principal.WindowsPrincipal($id);',
  '"ELEVATED=" + $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);',
  '"INGROUP=" + [bool]($id.Groups | Where-Object { $_.Value -eq \'S-1-5-32-544\' })',
].join(' ')

export function checkAdmin(env: Env): AdminCheck {
  const res = env.runProcess('powershell', ['-NoProfile', '-NonInteractive', '-Command', PROBE_SCRIPT])

  if (res.ok) {
    const elevated = readFlag(res.output, 'ELEVATED')
    const inGroup = readFlag(res.output, 'INGROUP')
    if (elevated !== null) {
      return {
        elevated,
        inAdminGroup: inGroup,
        source: 'token',
        detail: elevated
          ? '当前进程已提升（管理员令牌）'
          : inGroup === true
            ? '当前账户属于 Administrators 组，但进程未提升。请右键程序选择"以管理员身份运行"'
            : '当前账户不是管理员。请用管理员账户运行本程序',
      }
    }
  }

  // PowerShell 不可用时的兜底：退回目录写探针。
  // 只作为兜底，绝不作为主判据，而且失败时提示里说明是兜底结论。
  const writable = canWriteQzDir(env)
  return {
    elevated: writable,
    inAdminGroup: null,
    source: 'write-probe',
    detail: writable
      ? '无法读取进程令牌，改用写探针判定：可写入 QZ Tray 目录'
      : '无法读取进程令牌，改用写探针判定：不可写入 QZ Tray 目录。请以管理员身份运行本程序',
  }
}

function readFlag(output: string, name: string): boolean | null {
  const match = output.match(new RegExp(`${name}\\s*=\\s*(True|False)`, 'i'))
  if (!match) return null
  return match[1].toLowerCase() === 'true'
}

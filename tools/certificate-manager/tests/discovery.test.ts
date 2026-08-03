import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_QZ_CANDIDATES, QZ_REG_INSTALL_KEY, QZ_REG_UNINSTALL_KEY,
  discoverQzInstallDir, findQzProcesses, looksLikeQzInstallDir,
  parseJarPathFromCommandLine, readQzVersionFromRegistry, readRegistryValue,
} from '../src/core/discovery'
import type { ProcessRunner } from '../src/core/env'

/** 现场（CarGarden，Windows 10 Pro 19045）抓到的真实命令行。 */
const FIELD_COMMAND_LINE =
  '"D:\\qz tray\\runtime\\bin\\javaw.exe" -Xms512m -Xmx2048m ' +
  '-Djava.security.manager=allow -jar "D:\\qz tray/qz-tray.jar"'

const dirs: string[] = []
function tmp(name = 'qz install dir'): string {
  const root = mkdtempSync(join(tmpdir(), 'eshop-disc-'))
  dirs.push(root)
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
afterEach(() => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })) })

/** 造一个"看起来像 QZ 安装目录"的目录：只放 jar + properties，刻意不放 qz-tray.exe。 */
function makeQzDir(): string {
  const dir = tmp()
  writeFileSync(join(dir, 'qz-tray.jar'), 'stub')
  writeFileSync(join(dir, 'qz-tray.properties'), 'wss.alias=qz-tray\n')
  return dir
}

function runner(handlers: Partial<Record<string, (args: string[]) => { ok: boolean; output: string }>>): ProcessRunner {
  return (command, args) => handlers[command]?.(args) ?? { ok: false, output: '' }
}

function processRunner(commandLines: string[]): ProcessRunner {
  return runner({
    powershell: () => ({
      ok: true,
      output: commandLines.map((c, i) => `${1000 + i}|${c}`).join('\r\n'),
    }),
  })
}

describe('从进程命令行解析 QZ 安装目录', () => {
  it('现场命令行：runtime\\bin\\javaw.exe 启动、路径含空格、\\ 与 / 混用', () => {
    expect(parseJarPathFromCommandLine(FIELD_COMMAND_LINE)).toBe('D:\\qz tray')
  })

  it('全反斜杠也能解析', () => {
    expect(parseJarPathFromCommandLine('"C:\\a\\javaw.exe" -jar "C:\\Program Files\\QZ Tray\\qz-tray.jar"'))
      .toBe('C:\\Program Files\\QZ Tray')
  })

  it('未加引号且无空格的路径也能解析', () => {
    expect(parseJarPathFromCommandLine('javaw.exe -jar D:\\qz\\qz-tray.jar')).toBe('D:\\qz')
  })

  it('没有 -jar 时返回 null', () => {
    expect(parseJarPathFromCommandLine('"D:\\qz tray\\runtime\\bin\\javaw.exe" -cp foo qz.App')).toBeNull()
  })

  it('-jar 指向的不是 qz-tray.jar 时返回 null', () => {
    expect(parseJarPathFromCommandLine('javaw.exe -jar "C:\\evil\\payload.jar"')).toBeNull()
    expect(parseJarPathFromCommandLine('javaw.exe -jar "C:\\evil\\notqz-tray.jar"')).toBeNull()
  })

  it('相对路径返回 null —— 不能靠工作目录推出任意位置', () => {
    expect(parseJarPathFromCommandLine('javaw.exe -jar qz-tray.jar')).toBeNull()
    expect(parseJarPathFromCommandLine('javaw.exe -jar ..\\..\\qz-tray.jar')).toBeNull()
  })

  it('命令行里带换行/空字符时返回 null', () => {
    expect(parseJarPathFromCommandLine('javaw.exe -jar "C:\\a\\qz-tray.jar"\nrm -rf')).toBeNull()
    expect(parseJarPathFromCommandLine('javaw.exe -jar "C:\\a\\qz-tray.jar"\0')).toBeNull()
  })

  it('空串与垃圾输入返回 null', () => {
    expect(parseJarPathFromCommandLine('')).toBeNull()
    expect(parseJarPathFromCommandLine('-jar')).toBeNull()
    expect(parseJarPathFromCommandLine('-jar ""')).toBeNull()
  })
})

describe('QZ 进程枚举', () => {
  it('按命令行匹配，解析出 PID 与命令行', () => {
    const found = findQzProcesses(processRunner([FIELD_COMMAND_LINE]))
    expect(found).toEqual([{ pid: 1000, commandLine: FIELD_COMMAND_LINE }])
  })

  it('PowerShell 失败时返回空，不抛错', () => {
    expect(findQzProcesses(runner({}))).toEqual([])
  })
})

describe('安装目录发现顺序', () => {
  it('QZ 正在运行 → 用进程命令行，且必须通过目录校验', () => {
    const dir = makeQzDir()
    const result = discoverQzInstallDir(processRunner([`"x\\javaw.exe" -jar "${dir}/qz-tray.jar"`]))

    expect(result.dir).toBe(dir)
    expect(result.source).toBe('running-process')
    expect(result.detail).toContain('PID 1000')
  })

  it('目录含空格时同样可用（现场 D:\\qz tray）', () => {
    const dir = makeQzDir()
    expect(dir).toContain(' ')
    expect(discoverQzInstallDir(processRunner([`"a b\\javaw.exe" -jar "${dir}/qz-tray.jar"`])).dir).toBe(dir)
  })

  it('目录里没有 qz-tray.exe 也照样识别', () => {
    const dir = makeQzDir()
    const result = discoverQzInstallDir(processRunner([`javaw.exe -jar "${dir}/qz-tray.jar"`]))
    expect(result.dir).toBe(dir)
    expect(looksLikeQzInstallDir(dir)).toBe(true)
  })

  it('伪造的命令行指向一个不含 QZ 文件的目录时不予采信', () => {
    const bogus = tmp('not qz')
    const result = discoverQzInstallDir(processRunner([`javaw.exe -jar "${bogus}/qz-tray.jar"`]), [])
    expect(result.dir).toBeNull()
    expect(result.source).toBeNull()
  })

  it('QZ 未运行 → 回退注册表安装项', () => {
    const dir = makeQzDir()
    const result = discoverQzInstallDir(runner({
      powershell: () => ({ ok: true, output: '' }),
      reg: (args) => args.includes(QZ_REG_INSTALL_KEY)
        ? { ok: true, output: `\r\n${QZ_REG_INSTALL_KEY}\r\n    (Default)    REG_SZ    ${dir}\r\n\r\n` }
        : { ok: false, output: '' },
    }))
    expect(result.dir).toBe(dir)
    expect(result.source).toBe('registry-install')
  })

  it('QZ 未运行、安装项缺失 → 回退卸载项 DisplayIcon', () => {
    const dir = makeQzDir()
    const result = discoverQzInstallDir(runner({
      powershell: () => ({ ok: true, output: '' }),
      reg: (args) => args.includes('DisplayIcon')
        ? { ok: true, output: `    DisplayIcon    REG_SZ    ${dir}\\qz-tray.exe\r\n` }
        : { ok: false, output: '' },
    }))
    expect(result.dir).toBe(dir)
    expect(result.source).toBe('registry-uninstall')
  })

  it('都没有 → 回退默认候选目录', () => {
    const dir = makeQzDir()
    const result = discoverQzInstallDir(runner({ powershell: () => ({ ok: true, output: '' }) }), [dir])
    expect(result.dir).toBe(dir)
    expect(result.source).toBe('default-path')
  })

  it('全部落空时给出可读的原因，而不是静默返回默认路径', () => {
    const result = discoverQzInstallDir(runner({}), [])
    expect(result.dir).toBeNull()
    expect(result.detail).toContain('qz-tray.jar')
    expect(DEFAULT_QZ_CANDIDATES).toContain('C:\\Program Files\\QZ Tray')
  })
})

describe('注册表读取', () => {
  it('解析 reg query 的默认值输出', () => {
    const run = runner({
      reg: () => ({ ok: true, output: '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\QZ Tray\r\n    (Default)    REG_SZ    D:\\qz tray\r\n\r\n' }),
    })
    expect(readRegistryValue(run, QZ_REG_INSTALL_KEY, null)).toBe('D:\\qz tray')
  })

  it('解析 DisplayVersion', () => {
    const run = runner({
      reg: () => ({ ok: true, output: '    DisplayVersion    REG_SZ    2.2.6\r\n' }),
    })
    expect(readQzVersionFromRegistry(run)).toBe('2.2.6')
    expect(readRegistryValue(run, QZ_REG_UNINSTALL_KEY, 'DisplayVersion')).toBe('2.2.6')
  })

  it('reg query 失败时返回 null', () => {
    expect(readQzVersionFromRegistry(runner({}))).toBeNull()
  })
})

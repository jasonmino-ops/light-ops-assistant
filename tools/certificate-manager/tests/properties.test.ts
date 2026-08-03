import { describe, expect, it } from 'vitest'
import {
  escapeValue, getProperty, removeProperty, setProperty, unescapeValue,
} from '../src/core/properties'

const SAMPLE = [
  '#Fri Aug 01 09:12:33 ICT 2026',
  '! another comment',
  'wss.alias=qz-tray',
  'wss.keystore=C\\:\\\\Program Files\\\\QZ Tray\\\\auth\\\\qz-tray.jks',
  '',
  'wss.host : 0.0.0.0',
  '',
].join('\n')

describe('Java .properties 读写', () => {
  it('读出被转义的 Windows 路径', () => {
    expect(getProperty(SAMPLE, 'wss.keystore')).toBe('C:\\Program Files\\QZ Tray\\auth\\qz-tray.jks')
  })

  it('支持冒号分隔与空格', () => {
    expect(getProperty(SAMPLE, 'wss.host')).toBe('0.0.0.0')
  })

  it('不存在的 key 返回 null', () => {
    expect(getProperty(SAMPLE, 'authcert.override')).toBeNull()
  })

  it('新增 key 时保留全部原有行与注释', () => {
    const next = setProperty(SAMPLE, 'authcert.override', 'C:\\ProgramData\\E-Shop\\root.crt')
    expect(next).toContain('#Fri Aug 01 09:12:33 ICT 2026')
    expect(next).toContain('! another comment')
    expect(next).toContain('wss.alias=qz-tray')
    expect(getProperty(next, 'wss.keystore')).toBe('C:\\Program Files\\QZ Tray\\auth\\qz-tray.jks')
    expect(getProperty(next, 'authcert.override')).toBe('C:\\ProgramData\\E-Shop\\root.crt')
  })

  it('反斜杠按 Java 规则写成双反斜杠', () => {
    const next = setProperty('', 'authcert.override', 'C:\\a\\b.crt')
    expect(next).toContain('authcert.override=C:\\\\a\\\\b.crt')
  })

  it('更新已有 key 时就地替换，不追加重复行', () => {
    const once = setProperty(SAMPLE, 'authcert.override', 'A')
    const twice = setProperty(once, 'authcert.override', 'B')
    expect(getProperty(twice, 'authcert.override')).toBe('B')
    expect(twice.split('\n').filter((l) => l.startsWith('authcert.override')).length).toBe(1)
  })

  it('删除 key 后其余内容一字不变', () => {
    const withKey = setProperty(SAMPLE, 'authcert.override', 'A')
    const removed = removeProperty(withKey, 'authcert.override')
    expect(removed.replace(/\s+$/, '')).toBe(SAMPLE.replace(/\s+$/, ''))
  })

  it('折叠续行并整段替换', () => {
    const text = 'a=1\nlong.key=first\\\n  second\nb=2\n'
    // Java 规范：续行的前导空白被丢弃
    expect(getProperty(text, 'long.key')).toBe('firstsecond')
    const next = setProperty(text, 'long.key', 'x')
    expect(next).toContain('a=1')
    expect(next).toContain('b=2')
    expect(next).not.toContain('second')
  })

  it('同名 key 取最后一次出现，替换后只剩一条', () => {
    const text = 'k=1\nk=2\n'
    expect(getProperty(text, 'k')).toBe('2')
    const next = setProperty(text, 'k', '3')
    expect(next.split('\n').filter((l) => l.startsWith('k=')).length).toBe(1)
  })

  it('转义/反转义可往返', () => {
    const raw = 'C:\\x\ty\nz'
    expect(unescapeValue(escapeValue(raw))).toBe(raw)
  })
})

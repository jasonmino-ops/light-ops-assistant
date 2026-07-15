import { describe, it, expect } from 'vitest'
import { parseConfigFile } from '../src/main/config'

// 注意：仅测试纯函数 parseConfigFile / URL 拼接逻辑不依赖 electron 运行时

describe('Desktop 配置解析', () => {
  it('解析合法配置', () => {
    const c = parseConfigFile(JSON.stringify({ baseUrl: 'http://localhost:3000/', storeCode: ' S001 ', lang: 'km' }))
    expect(c.baseUrl).toBe('http://localhost:3000')
    expect(c.storeCode).toBe('S001')
    expect(c.lang).toBe('km')
  })

  it('拒绝非 http(s) baseUrl', () => {
    expect(parseConfigFile(JSON.stringify({ baseUrl: 'file:///etc/passwd' })).baseUrl).toBeUndefined()
    expect(parseConfigFile(JSON.stringify({ baseUrl: 'javascript:alert(1)' })).baseUrl).toBeUndefined()
  })

  it('忽略非法 lang 与损坏 JSON', () => {
    expect(parseConfigFile(JSON.stringify({ lang: 'fr' })).lang).toBeUndefined()
    expect(parseConfigFile('{not json')).toEqual({})
  })
})

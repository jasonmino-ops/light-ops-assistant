import { describe, it, expect } from 'vitest'
import { parseConfigFile, resolveDesktopConfig } from '../src/main/config'
import { PRODUCTION_BUILD_PROFILE, type DesktopBuildProfile } from '../src/main/buildProfile'

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

  it('生产构建保持环境变量优先级', () => {
    const config = resolveDesktopConfig({
      buildProfile: PRODUCTION_BUILD_PROFILE,
      fromFile: { baseUrl: 'https://file.example.com', storeCode: 'FILE01' },
      env: { ESHOP_DESKTOP_BASE_URL: 'https://env.example.com/', ESHOP_DESKTOP_STORE_CODE: ' ENV01 ' },
    })
    expect(config.baseUrl).toBe('https://env.example.com')
    expect(config.storeCode).toBe('ENV01')
    expect(config.buildChannel).toBe('PRODUCTION')
  })

  it('Staging 构建锁定 bundled origin 与门店码', () => {
    const buildProfile: DesktopBuildProfile = {
      ...PRODUCTION_BUILD_PROFILE,
      channel: 'STAGING',
      buildLabel: 'STAGING TEST ONLY',
      baseUrl: 'https://staging.example.com',
      storeCode: 'PREV06C',
      deploymentCommit: 'c95d6eda12027ce4bc29cfac8f99f60a69d81525',
      locked: true,
    }
    const config = resolveDesktopConfig({
      buildProfile,
      fromFile: { baseUrl: 'https://file.example.com', storeCode: 'FILE01' },
      env: { ESHOP_DESKTOP_BASE_URL: 'https://env.example.com', ESHOP_DESKTOP_STORE_CODE: 'ENV01' },
    })
    expect(config.baseUrl).toBe('https://staging.example.com')
    expect(config.storeCode).toBe('PREV06C')
    expect(config.buildChannel).toBe('STAGING')
  })
})

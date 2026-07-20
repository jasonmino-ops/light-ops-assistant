import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = join(__dirname, '..')
const repoRoot = join(desktopRoot, '..')
const readDesktop = (path: string) => readFileSync(join(desktopRoot, path), 'utf8')

describe('temporary Founder STAGING build', () => {
  it('uses isolated Windows identity and an unmistakable artifact name', () => {
    const builder = readDesktop('electron-builder.staging.yml')
    expect(builder).toMatch(/appId: com\.eshop\.desktop\.staging/)
    expect(builder).toMatch(/productName: E-Shop Desktop STAGING/)
    expect(builder).toMatch(/shortcutName: "E-Shop Desktop STAGING"/)
    expect(builder).toMatch(/E-Shop-Desktop-STAGING-Setup-/)
    expect(builder).toMatch(/deleteAppDataOnUninstall: true/)
  })

  it('locks PREV06C to the expected immutable deployment commit', () => {
    const profile = JSON.parse(readDesktop('build-profiles/founder-staging.json'))
    expect(profile).toMatchObject({
      channel: 'STAGING',
      storeCode: 'PREV06C',
      deploymentCommit: 'c95d6eda12027ce4bc29cfac8f99f60a69d81525',
    })
    expect(profile.baseUrl).toMatch(/^https:\/\//)
  })

  it('applies the profile only to compiled staging output', () => {
    const productionMain = readDesktop('src/main/main.ts')
    const overlay = readDesktop('scripts/prepare-staging-dist.mjs')
    expect(productionMain).toContain("loadConfig(app.getPath('userData'))")
    expect(productionMain).not.toContain('resourcesPath: process.resourcesPath')
    expect(overlay).toContain('resourcesPath: process.resourcesPath')
    expect(overlay).toContain('buildChannel: config.buildChannel')
  })

  it('CI uploads only a temporary artifact and never publishes a release', () => {
    const workflow = readFileSync(join(repoRoot, '.github/workflows/desktop-staging-acceptance.yml'), 'utf8')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('retention-days: 3')
    expect(workflow).toContain('--exclude tests/release-foundation.test.ts')
    expect(workflow).not.toMatch(/gh release|create-release|contents:\s*write/)
  })
})

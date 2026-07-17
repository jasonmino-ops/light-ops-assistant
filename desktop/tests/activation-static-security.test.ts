import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const src = (rel: string) => readFileSync(join(root, 'src', rel), 'utf8')

const activationMainFiles = [
  'main/activation/activationTypes.ts',
  'main/activation/credentialStore.ts',
  'main/activation/activationApiClient.ts',
  'main/activation/activationRuntime.ts',
  'main/activation/activationWindowController.ts',
  'main/activation/activationIpc.ts',
]

const activationRendererFiles = [
  'preload/activationPreload.ts',
  'renderer/activation/activationRenderer.ts',
]

describe('activation static security', () => {
  it('does not expose device token through preload or renderer code', () => {
    for (const file of activationRendererFiles) {
      const source = src(file)
      expect(source, file).not.toMatch(/deviceToken|Authorization|Bearer|ciphertext|installationId/)
      expect(source, file).not.toMatch(/localStorage|sessionStorage/)
      expect(source, file).not.toMatch(/http:\/\/|https:\/\//)
    }
  })

  it('does not log token, PIN, Authorization, raw request, or raw response', () => {
    for (const file of activationMainFiles) {
      const source = src(file)
      const lines = source.split('\n')
      for (const [index, line] of lines.entries()) {
        if (!/logger\.|console\./.test(line)) continue
        expect(line, `${file}:${index + 1}`).not.toMatch(/deviceToken|Authorization|Bearer|pin|ciphertext|request|response/i)
      }
    }
  })

  it('keeps activation public state secret-free by construction', () => {
    const types = src('main/activation/activationTypes.ts')
    const start = types.indexOf('export type ActivationPublicState')
    const end = types.indexOf('export type AuthorizedDesktopContext')
    const publicStateBlock = types.slice(start, end)
    expect(publicStateBlock).not.toMatch(/deviceToken|pin|Authorization|installationId|ciphertext/)
  })

  it('uses safeStorage and forbids plaintext fallback in credential store', () => {
    const source = src('main/activation/credentialStore.ts')
    expect(source).toMatch(/safeStorage/)
    expect(source).toMatch(/encryptString/)
    expect(source).toMatch(/decryptString/)
    expect(source).toMatch(/isEncryptionAvailable/)
    expect(source).not.toMatch(/createCipheriv|createDecipheriv|localStorage|sessionStorage/)
  })

  it('does not read or migrate legacy POS browser tokens', () => {
    const combined = activationMainFiles.map(src).join('\n')
    expect(combined).not.toMatch(/cashier:posDeviceToken|desktop-pos-auth|authorizeDesktopPosRequest|allowStoreCodeFallback|BindToken/)
  })
})

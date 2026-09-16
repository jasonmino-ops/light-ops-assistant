export type PosSessionPayload = {
  browserDeviceId: string
  storeCode: string
  token: string
  expiresAt: string
}

type CredentialReader = {
  readCredential(): Promise<
    | { ok: true; credential: { schemaVersion: 1; deviceToken: string } }
    | { ok: false; reason: string }
  >
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

const MAX_RESPONSE_BYTES = 64 * 1024

function parsePayload(raw: string): PosSessionPayload | null {
  if (!raw || raw.length > MAX_RESPONSE_BYTES) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (
      value.ok !== true ||
      typeof value.browserDeviceId !== 'string' ||
      !/^desktop-[A-Za-z0-9_-]+$/.test(value.browserDeviceId) ||
      typeof value.storeCode !== 'string' ||
      value.storeCode.length < 1 ||
      value.storeCode.length > 128 ||
      typeof value.token !== 'string' ||
      value.token.length < 40 ||
      value.token.length > 4096 ||
      !value.token.includes('.') ||
      typeof value.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(value.expiresAt))
    ) {
      return null
    }
    return {
      browserDeviceId: value.browserDeviceId,
      storeCode: value.storeCode,
      token: value.token,
      expiresAt: value.expiresAt,
    }
  } catch {
    return null
  }
}

/**
 * Main-process-only bridge from the safeStorage Desktop credential to a
 * one-time renderer handoff of the derived managed Browser POS session.
 */
export class PosSessionBridge {
  private pending: Promise<PosSessionPayload | null> | null = null
  private delivered = false

  constructor(
    private readonly options: {
      credentialReader: CredentialReader
      baseUrl: string
      fetchImpl?: FetchLike
    },
  ) {}

  prepare(): Promise<PosSessionPayload | null> {
    if (!this.pending) this.pending = this.requestSession()
    return this.pending
  }

  async take(): Promise<PosSessionPayload | null> {
    if (this.delivered) return null
    const payload = await this.prepare()
    if (!payload || this.delivered) return null
    this.delivered = true
    return payload
  }

  private async requestSession(): Promise<PosSessionPayload | null> {
    const credential = await this.options.credentialReader.readCredential()
    if (!credential.ok) return null

    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    try {
      const response = await fetchImpl(
        `${this.options.baseUrl.replace(/\/+$/, '')}/api/pos-session/desktop`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: {
            Authorization: `Bearer ${credential.credential.deviceToken}`,
            Accept: 'application/json',
          },
        },
      )
      if (!response.ok) return null
      return parsePayload(await response.text())
    } catch {
      return null
    }
  }
}

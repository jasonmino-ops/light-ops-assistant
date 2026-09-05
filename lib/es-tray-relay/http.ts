import { NextResponse } from 'next/server'
import { ComputerClientSecretError, assertComputerClientSecretConfigured } from '@/lib/computer-client/crypto'
import { RelayContractError } from './contract'
import { RelayConfigurationError } from './config'
import { RelayServiceError } from './service'

export const RELAY_NO_STORE_HEADERS = { 'Cache-Control': 'no-store, max-age=0' }

export function relayJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body as Record<string, unknown>, {
    ...init,
    headers: { ...RELAY_NO_STORE_HEADERS, ...(init?.headers ?? {}) },
  })
}

export function relayError(error: string, status: number, extra?: Record<string, unknown>) {
  return relayJson({ error, ...(extra ?? {}) }, { status })
}

export async function withRelayApiError(handler: () => Promise<Response>) {
  try {
    assertComputerClientSecretConfigured()
    return await handler()
  } catch (error) {
    if (error instanceof RelayContractError) return relayError(error.code, 400)
    if (error instanceof RelayServiceError) return relayError(error.code, error.status)
    if (error instanceof RelayConfigurationError || error instanceof ComputerClientSecretError) {
      console.error('[es-tray-relay] configuration unavailable')
      return relayError('ES_TRAY_02_SERVICE_NOT_CONFIGURED', 503)
    }
    if (error instanceof SyntaxError) return relayError('ES_TRAY_02_INVALID_JSON', 400)
    console.error('[es-tray-relay] unhandled server error')
    return relayError('ES_TRAY_02_SERVER_ERROR', 500)
  }
}

import type { AiProviderAdapter, AiSupportRequest, AiSupportResponse } from '../types'

function elapsedSince(start: number): number {
  return Math.max(0, Date.now() - start)
}

function buildAuditId(mode: string): string {
  return `mock_audit_${mode}_${Date.now()}`
}

export const mockProviderAdapter: AiProviderAdapter = {
  provider: 'MOCK',
  async callAiProvider(input: AiSupportRequest): Promise<AiSupportResponse> {
    const start = Date.now()
    const message = input.userMessage.toLowerCase()

    if (message.includes('mock_need_human')) {
      return {
        ok: true,
        provider: 'MOCK',
        replyText: '',
        confidence: 0.95,
        needHuman: true,
        intent: 'mock_need_human',
        auditId: buildAuditId('need_human'),
        raw: { mock: true, mode: 'needHuman' },
        latencyMs: elapsedSince(start),
      }
    }

    if (message.includes('mock_low_confidence')) {
      return {
        ok: true,
        provider: 'MOCK',
        replyText: '[mock] low confidence reply',
        confidence: 0.3,
        needHuman: false,
        intent: 'mock_low_confidence',
        auditId: buildAuditId('low_confidence'),
        raw: { mock: true, mode: 'lowConfidence' },
        latencyMs: elapsedSince(start),
      }
    }

    return {
      ok: true,
      provider: 'MOCK',
      replyText: `[mock] ${input.userMessage}`,
      confidence: 0.9,
      needHuman: false,
      intent: 'mock_success',
      auditId: buildAuditId('success'),
      raw: { mock: true, mode: 'success' },
      latencyMs: elapsedSince(start),
    }
  },
}

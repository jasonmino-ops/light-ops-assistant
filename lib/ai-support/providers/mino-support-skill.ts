import type { AiProviderAdapter, AiSupportRequest, AiSupportResponse } from '../types'

function elapsedSince(start: number): number {
  return Math.max(0, Date.now() - start)
}

export const minoSupportSkillProviderAdapter: AiProviderAdapter = {
  provider: 'MINO_SUPPORT_SKILL',
  async callAiProvider(input: AiSupportRequest): Promise<AiSupportResponse> {
    const start = Date.now()

    // Placeholder only: this is the future Mino customer support skill, not Mino Chief/Manager/Ops.
    return {
      ok: true,
      provider: 'MINO_SUPPORT_SKILL',
      replyText: '',
      confidence: 0.2,
      needHuman: true,
      intent: 'mino_support_skill_stub',
      auditId: null,
      raw: {
        stub: true,
        reason: 'MINO_SUPPORT_SKILL adapter is not connected to real Mino services yet.',
        channel: input.channel,
      },
      latencyMs: elapsedSince(start),
    }
  },
}

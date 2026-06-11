import { prisma } from '@/lib/prisma'
import type { AiSupportAuditInput } from './types'

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export async function writeAiSupportAudit(input: AiSupportAuditInput): Promise<void> {
  try {
    await prisma.aiSupportAuditLog.create({
      data: {
        tenantId: input.tenantId ?? null,
        storeId: input.storeId ?? null,
        customerId: input.customerId ?? null,
        sessionId: input.sessionId ?? null,
        provider: input.provider,
        userMessage: input.userMessage.slice(0, 4000),
        aiReply: input.aiReply ? input.aiReply.slice(0, 4000) : null,
        intent: input.intent ?? null,
        confidence: input.confidence ?? null,
        needHuman: input.needHuman ?? null,
        toolCallsJson: safeJson(input.toolCalls),
        providerAuditId: input.providerAuditId ?? null,
        latencyMs: input.latencyMs ?? null,
        status: input.status,
        errorMessage: input.errorMessage ? input.errorMessage.slice(0, 1000) : null,
      },
    })
  } catch (error) {
    console.error('[ai-support] audit write failed', error)
  }
}

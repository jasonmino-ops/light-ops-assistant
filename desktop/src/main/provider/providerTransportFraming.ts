import { HrtFrame } from '@eshop/hrt-contract'

export const MAX_PROVIDER_FRAME_BYTES = 64 * 1024

export interface ProviderTransportEnvelope {
  supervisorToken?: string
  frame: HrtFrame<unknown>
}

export type ProviderDecodedEnvelope =
  | { ok: true; envelope: ProviderTransportEnvelope }
  | { ok: false; code: 'FRAME_ZERO_LENGTH' | 'FRAME_OVERSIZED' | 'FRAME_INVALID_JSON' | 'FRAME_SCHEMA_INVALID'; errors: string[] }

export function encodeProviderEnvelope(envelope: ProviderTransportEnvelope): Buffer {
  validateFrame(envelope.frame)
  const payload = Buffer.from(JSON.stringify(envelope), 'utf8')
  if (payload.byteLength === 0 || payload.byteLength > MAX_PROVIDER_FRAME_BYTES) {
    throw new Error('PROVIDER_FRAME_OVERSIZED')
  }
  const out = Buffer.allocUnsafe(payload.byteLength + 4)
  out.writeUInt32LE(payload.byteLength, 0)
  payload.copy(out, 4)
  return out
}

function validateFrame(frame: unknown): asserts frame is HrtFrame<unknown> {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('FRAME_SCHEMA_INVALID')
  const candidate = frame as Partial<HrtFrame<unknown>>
  if (
    typeof candidate.contractVersion !== 'string' ||
    typeof candidate.messageType !== 'string' ||
    typeof candidate.correlationId !== 'string' ||
    typeof candidate.instanceId !== 'string' ||
    typeof candidate.sequence !== 'number' ||
    typeof candidate.timestamp !== 'string' ||
    !('payload' in candidate)
  ) {
    throw new Error('FRAME_SCHEMA_INVALID')
  }
}

function decodePayload(payload: Buffer): ProviderDecodedEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload.toString('utf8'))
  } catch (error) {
    return { ok: false, code: 'FRAME_INVALID_JSON', errors: [error instanceof Error ? error.message : 'invalid JSON'] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('frame' in parsed)) {
    return { ok: false, code: 'FRAME_SCHEMA_INVALID', errors: ['missing frame envelope'] }
  }
  const envelope = parsed as Partial<ProviderTransportEnvelope>
  if (envelope.supervisorToken !== undefined && typeof envelope.supervisorToken !== 'string') {
    return { ok: false, code: 'FRAME_SCHEMA_INVALID', errors: ['invalid supervisor token'] }
  }
  try {
    validateFrame(envelope.frame)
  } catch (error) {
    return { ok: false, code: 'FRAME_SCHEMA_INVALID', errors: [error instanceof Error ? error.message : 'invalid frame'] }
  }
  return { ok: true, envelope: { supervisorToken: envelope.supervisorToken, frame: envelope.frame } }
}

export class ProviderFrameDecoder {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): ProviderDecodedEnvelope[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: ProviderDecodedEnvelope[] = []
    while (this.buffer.byteLength >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (length === 0) {
        frames.push({ ok: false, code: 'FRAME_ZERO_LENGTH', errors: ['frame length must be greater than zero'] })
        this.buffer = Buffer.alloc(0)
        break
      }
      if (length > MAX_PROVIDER_FRAME_BYTES) {
        frames.push({ ok: false, code: 'FRAME_OVERSIZED', errors: [`frame exceeds ${MAX_PROVIDER_FRAME_BYTES} bytes`] })
        this.buffer = Buffer.alloc(0)
        break
      }
      if (this.buffer.byteLength < length + 4) break
      frames.push(decodePayload(this.buffer.subarray(4, 4 + length)))
      this.buffer = this.buffer.subarray(4 + length)
    }
    return frames
  }
}

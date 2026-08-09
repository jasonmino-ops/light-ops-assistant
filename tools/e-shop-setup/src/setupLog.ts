import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  SetupEvidence,
  SetupEvidenceValue,
  SetupLogger,
  SetupStageLogEntry,
} from './contracts'

const SENSITIVE_KEY = /private.?key|token|cookie|credential|claim.?secret|device.?secret|launch.?ticket|authorization|password|secret/i
const LABELED_SENSITIVE_VALUE = /(private.?key|token|cookie|credential|claim.?secret|device.?secret|launch.?ticket|authorization|password|secret)\s*[:=]\s*[^\s,;]+/gi
const MAX_STRING_LENGTH = 1_000
const MAX_ARRAY_LENGTH = 30
const MAX_DEPTH = 6

function sanitizeString(value: string): string {
  const redacted = value.replace(LABELED_SENSITIVE_VALUE, '[redacted]')
  return redacted.length > MAX_STRING_LENGTH
    ? `${redacted.slice(0, MAX_STRING_LENGTH)}…[truncated]`
    : redacted
}

function sanitizeValue(value: SetupEvidenceValue, depth: number): SetupEvidenceValue {
  if (depth > MAX_DEPTH) return '[depth-limit]'
  if (typeof value === 'string') return sanitizeString(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitizeValue(entry, depth + 1))
  }

  const sanitized: Record<string, SetupEvidenceValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue
    sanitized[key] = sanitizeValue(entry, depth + 1)
  }
  return sanitized
}

export function sanitizeSetupEvidence(evidence: SetupEvidence): SetupEvidence {
  return sanitizeValue(evidence, 0) as SetupEvidence
}

export class JsonLinesSetupLogger implements SetupLogger {
  constructor(private readonly logPath: string) {}

  async write(entry: SetupStageLogEntry): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true })
    const safeEntry: SetupStageLogEntry = {
      ...entry,
      evidenceSummary: sanitizeSetupEvidence(entry.evidenceSummary),
    }
    await appendFile(this.logPath, `${JSON.stringify(safeEntry)}\n`, 'utf8')
  }
}

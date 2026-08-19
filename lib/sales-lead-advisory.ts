import crypto from 'node:crypto'

export function getSalesLeadTelegramAdvisoryKey(telegramId: string): bigint {
  return crypto.createHash('sha256')
    .update(`sales-lead-telegram:${telegramId}`)
    .digest()
    .readBigInt64BE(0)
}

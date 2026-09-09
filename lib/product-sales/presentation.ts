import { COPY, type ReportLang } from './copy'
import type { ProductSalesResult } from './contract'
import { localDate } from './dates'

function localTime(iso: string) {
  return new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 19).replace('T', ' ')
}

// Read the result's saved windows, never reinterpret an old daily report using
// today's query rules. This also keeps screen and receipt cutoffs identical.
export function reportPeriodPresentation(result: ProductSalesResult, lang: ReportLang) {
  const copy = COPY[lang]
  const { range } = result
  const from = range.windows[0]?.from ?? result.generatedAt
  const to = range.windows.at(-1)?.to ?? result.generatedAt
  const live = range.dateTo === localDate(new Date(result.generatedAt))
    && Date.parse(to) <= Date.parse(result.generatedAt)
  const legacy = range.windows.some((window) => localTime(window.from).slice(11) !== '00:00:00')
  return {
    interval: `${copy.interval}: ${localTime(from)} → ${localTime(to)} (${range.timezone}; ${copy.endExclusive})`,
    status: live ? `${copy.provisional}: ${localTime(to)}` : copy.completePeriod,
    legacy: legacy ? copy.legacyPeriod : null,
  }
}

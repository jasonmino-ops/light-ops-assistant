import { MAX_DAYS, REPORT_TIMEZONE, ReportError, type Period, type ReportRange, type Window } from './contract'

const DAY = 86_400_000
// Cambodia has a fixed +07:00 offset for the supported contemporary dates.
export function localDate(now = new Date()) { return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10) }
export function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) throw new ReportError('INVALID_DATE')
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new ReportError('INVALID_DATE')
  return value
}
export function shiftDate(date: string, days: number) {
  return new Date(new Date(`${validDate(date)}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10)
}
export function businessWindow(date: string): Window {
  validDate(date)
  return { from: new Date(`${date}T00:00:00+07:00`).toISOString(), to: new Date(`${shiftDate(date, 1)}T00:00:00+07:00`).toISOString() }
}
export function reportRange(input: { period: unknown; dateFrom?: unknown; dateTo?: unknown }, now = new Date()): ReportRange {
  const today = localDate(now)
  const period = input.period as Period
  let dateFrom = today
  let dateTo = today
  let continuous = false
  switch (period) {
    case 'TODAY': continuous = true; break
    case 'YESTERDAY': dateFrom = dateTo = shiftDate(today, -1); break
    case 'WEEK': {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
      dateFrom = shiftDate(today, -(weekday === 0 ? 6 : weekday - 1)); continuous = true; break
    }
    case 'MONTH': dateFrom = `${today.slice(0, 7)}-01`; continuous = true; break
    case 'CUSTOM': dateFrom = validDate(input.dateFrom); dateTo = validDate(input.dateTo); break
    default: throw new ReportError('INVALID_PERIOD')
  }
  const days = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / DAY + 1
  if (days < 1 || days > MAX_DAYS || dateTo > today) throw new ReportError('INVALID_DATE_RANGE')
  const windows: Window[] = []
  if (continuous) {
    const from = businessWindow(dateFrom).from
    if (Date.parse(from) < now.getTime()) windows.push({ from, to: now.toISOString() })
  } else {
    for (let index = 0; index < days; index++) {
      const window = businessWindow(shiftDate(dateFrom, index))
      // A custom range may include today, but never a future part of today.
      if (Date.parse(window.to) > now.getTime()) window.to = now.toISOString()
      if (Date.parse(window.from) < Date.parse(window.to)) windows.push(window)
    }
  }
  return { period, dateFrom, dateTo, windows, continuous, timezone: REPORT_TIMEZONE }
}

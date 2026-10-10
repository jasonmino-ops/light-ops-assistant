/**
 * Kitchen notice rules shared by the server and the Desktop page. Pure: no
 * database, no browser API, no printing.
 *
 * One rule governs everything here: each kitchen notice identity is handed to a
 * page once and submitted to the print bridge once. Nothing in this module, and
 * nothing that calls it, submits the same identity a second time.
 */

export type DiningNoticeStatus =
  | 'NOT_REQUIRED'
  /** Needs a notice; no page has been given printable content yet. */
  | 'PENDING_SUBMIT'
  /** Every kitchen line was voided before any page took the content. */
  | 'WITHDRAWN'
  /** An order notice that was never handed out before the meal stopped being open. It never will be. */
  | 'NOT_NOTIFIED_SETTLED'
  /** Bytes reached the printer. Not proof of paper, nor that the kitchen saw it. */
  | 'SENT'
  /** Certain that nothing was sent. */
  | 'NOT_SENT'
  /** Cannot tell whether anything was sent. */
  | 'UNKNOWN'

/** Classification of the existing print job row, from lib/v3-print-operator-status. */
export type DiningNoticeEvidence = 'PRINTED' | 'DEFINITELY_NOT_PRINTED' | 'AMBIGUOUS' | null

/** Kitchen notices go stale quickly; same window the H5 kitchen ticket uses. */
export const DINING_NOTICE_TTL_MS = 30 * 60 * 1000

/**
 * A notice that no page took within the window after its batch was created is stale:
 * its print identity is never handed out any more. The batch, its meal and its place
 * in every list stay; a person who still wants the kitchen told asks for a manual
 * re-notification, which is a new batch with a new identity.
 */
export function diningNoticeStale(batchCreatedAt: Date, now: Date): boolean {
  return now.getTime() - batchCreatedAt.getTime() > DINING_NOTICE_TTL_MS
}

/** Every value a page may report after its single submit attempt. */
export const DINING_NOTICE_REPORT_OUTCOMES = [
  'CROSSED',
  'FAILED_NOT_CROSSED',
  'CROSSING_UNKNOWN',
  'NOT_EXECUTED',
  'REJECTED',
  'HELD',
  'V2_FALLBACK_REQUIRED',
  'MODE_BLOCKED',
  'AUTHORITY_REJECTED',
  'BRIDGE_UNAVAILABLE',
  'RENDER_FAILED',
  'SUBMIT_THREW',
  'NO_RESPONSE',
  'UNRECOGNIZED',
] as const
export type DiningNoticeReportOutcome = typeof DINING_NOTICE_REPORT_OUTCOMES[number]

/**
 * What a page says its own print bridge answered is a hint, never evidence that
 * anything was sent: only the print job row, written by the Desktop print core's own
 * report, is. A page saying "sent" therefore proves nothing by itself; it only keeps a
 * "certainly not sent" row from being believed without question.
 */
const REPORTED_SENT: ReadonlySet<string> = new Set(['CROSSED'])
/**
 * Reports that prove nothing left the machine: the core confirmed zero bytes, or
 * the page never called the bridge at all. Every refusal and fallback stays
 * UNKNOWN on purpose: the shared core also answers REJECTED when bytes were sent
 * but the ledger write failed.
 */
const REPORTED_NOT_SENT: ReadonlySet<string> = new Set(['FAILED_NOT_CROSSED', 'BRIDGE_UNAVAILABLE', 'RENDER_FAILED'])

export function isDiningNoticeReportOutcome(value: unknown): value is DiningNoticeReportOutcome {
  return typeof value === 'string' && (DINING_NOTICE_REPORT_OUTCOMES as readonly string[]).includes(value)
}

/** Maps whatever the bridge returned to the closed set above. */
export function bridgeResultToReportOutcome(result: unknown): DiningNoticeReportOutcome {
  if (!result || typeof result !== 'object') return 'NO_RESPONSE'
  const row = result as { status?: unknown; execution?: { status?: unknown } | null }
  const status = row.status === 'EXECUTION_RECORDED_REPORT_PENDING' ? row.execution?.status : row.status
  return isDiningNoticeReportOutcome(status) && !['BRIDGE_UNAVAILABLE', 'RENDER_FAILED', 'SUBMIT_THREW', 'NO_RESPONSE'].includes(status)
    ? status
    : 'UNRECOGNIZED'
}

/**
 * Whether a notice that no page has taken yet may still be handed out.
 *
 * A notice asking the kitchen to cook is only handed out while the meal is open:
 * once the bill is paid, cleared or voided, nothing new is sent for cooking. A
 * notice telling the kitchen to stop (a void) stays available afterwards, because
 * the dish may still be on the stove whatever happened to the bill.
 */
export function diningNoticeDeliverable(mealOpen: boolean, subject: 'ORDER' | 'VOID'): boolean {
  return mealOpen || subject === 'VOID'
}

export function deriveDiningNoticeStatus(input: {
  required: boolean
  claimed: boolean
  withdrawn: boolean
  reportedOutcome: string | null
  /** See diningNoticeDeliverable. Only matters while the notice is unclaimed. */
  deliverable: boolean
  /** See diningNoticeStale. Only matters while the notice is unclaimed. */
  stale: boolean
  evidence: DiningNoticeEvidence
}): DiningNoticeStatus {
  if (!input.required) return 'NOT_REQUIRED'
  if (input.withdrawn) return 'WITHDRAWN'
  if (!input.claimed) {
    if (!input.deliverable) return 'NOT_NOTIFIED_SETTLED'
    // Never handed to a page, and too old to be handed out now: certainly not sent.
    return input.stale ? 'NOT_SENT' : 'PENDING_SUBMIT'
  }

  const reportedSent = input.reportedOutcome !== null && REPORTED_SENT.has(input.reportedOutcome)
  const reportedNotSent = input.reportedOutcome !== null && REPORTED_NOT_SENT.has(input.reportedOutcome)

  // The print job row saying "printed" is the only thing that makes a notice SENT.
  if (input.evidence === 'PRINTED') return 'SENT'
  // The page says sent, the row says not sent: a conflict, so nobody knows.
  if (input.evidence === 'DEFINITELY_NOT_PRINTED') return reportedSent ? 'UNKNOWN' : 'NOT_SENT'
  // A job row that exists but is not conclusive contradicts "nothing was sent".
  if (reportedNotSent) return input.evidence === 'AMBIGUOUS' ? 'UNKNOWN' : 'NOT_SENT'
  // Everything else — including a page that reported "sent" while the row is missing,
  // late or inconclusive — stays unknown until the row says otherwise.
  return 'UNKNOWN'
}

export type DiningKitchenAwareness = 'NEVER_TOLD' | 'NOT_SENT' | 'SENT' | 'UNKNOWN'

/**
 * Sending evidence for one batch, across its own notice and every manual
 * re-notification of it. 'SENT' means there is evidence that bytes went to the
 * printer. It is never a statement that paper came out or that anyone in the kitchen
 * saw, accepted or confirmed anything: the system has no such knowledge.
 */
export function kitchenAwareness(chain: readonly DiningNoticeStatus[]): DiningKitchenAwareness {
  const handedOut = chain.filter((status) => status === 'SENT' || status === 'NOT_SENT' || status === 'UNKNOWN')
  if (handedOut.length === 0) return 'NEVER_TOLD'
  if (handedOut.includes('SENT')) return 'SENT'
  if (handedOut.includes('UNKNOWN')) return 'UNKNOWN'
  return 'NOT_SENT'
}

/**
 * The value placed in the existing `orderNo` slot of the print contract. The bill
 * number and the in-meal sequence are both persisted, so the identity survives
 * retries, reloads and restarts.
 */
export function diningNoticePrintOrderNo(billNo: string, seq: number): string {
  return `${billNo}.${seq}`
}

export const PRINT_ORDER_NO_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

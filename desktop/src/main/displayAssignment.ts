export type DisplayMode = 'single' | 'dual'
export type EffectiveDisplayMode = DisplayMode

export type DisplayRect = { x: number; y: number; width: number; height: number }
export type DisplaySize = { width: number; height: number }

export type DisplaySnapshot = {
  id: number
  label?: string
  bounds: DisplayRect
  workArea: DisplayRect
  size: DisplaySize
  scaleFactor: number
  internal: boolean
}

export type DisplayReference = {
  id: number
  label?: string
  internal?: boolean
  size?: DisplaySize
  scaleFactor?: number
}

export type DisplayAssignmentSettings = {
  version: 1
  displayMode: DisplayMode
  swapped: boolean
  employeeDisplay?: DisplayReference
  customerDisplay?: DisplayReference
}

export type DisplayAssignmentPlan = {
  configuredMode: DisplayMode
  effectiveMode: EffectiveDisplayMode
  displayCount: number
  primaryDisplayId: number | null
  employeeDisplay: DisplaySnapshot | null
  customerDisplay: DisplaySnapshot | null
  customerVisible: boolean
  canSwap: boolean
  degraded: boolean
  reason: string
}

export const DEFAULT_DISPLAY_SETTINGS: DisplayAssignmentSettings = {
  version: 1,
  displayMode: 'dual',
  swapped: false,
}

export function referenceFromDisplay(display: DisplaySnapshot): DisplayReference {
  return {
    id: display.id,
    label: display.label,
    internal: display.internal,
    size: { ...display.size },
    scaleFactor: display.scaleFactor,
  }
}

export function planDisplayAssignment(
  displays: DisplaySnapshot[],
  primaryDisplayId: number | null,
  settings: DisplayAssignmentSettings = DEFAULT_DISPLAY_SETTINGS,
): DisplayAssignmentPlan {
  const sorted = sortDisplays(displays, primaryDisplayId)
  const primary = sorted.find((display) => display.id === primaryDisplayId) ?? sorted[0] ?? null
  if (!primary) {
    return {
      configuredMode: settings.displayMode,
      effectiveMode: 'single',
      displayCount: 0,
      primaryDisplayId: null,
      employeeDisplay: null,
      customerDisplay: null,
      customerVisible: false,
      canSwap: false,
      degraded: true,
      reason: 'no-displays',
    }
  }

  if (settings.displayMode === 'single') {
    const employee = matchDisplay(settings.employeeDisplay, sorted, primaryDisplayId) ?? primary
    return {
      configuredMode: 'single',
      effectiveMode: 'single',
      displayCount: sorted.length,
      primaryDisplayId: primary.id,
      employeeDisplay: employee,
      customerDisplay: null,
      customerVisible: false,
      canSwap: false,
      degraded: false,
      reason: 'configured-single',
    }
  }

  if (sorted.length < 2) {
    const employee = matchDisplay(settings.employeeDisplay, sorted, primaryDisplayId) ?? primary
    return {
      configuredMode: 'dual',
      effectiveMode: 'single',
      displayCount: sorted.length,
      primaryDisplayId: primary.id,
      employeeDisplay: employee,
      customerDisplay: null,
      customerVisible: false,
      canSwap: false,
      degraded: true,
      reason: 'dual-degraded-single-display',
    }
  }

  const savedEmployee = matchDisplay(settings.employeeDisplay, sorted, primaryDisplayId)
  const savedCustomer = matchDisplay(settings.customerDisplay, sorted, primaryDisplayId, savedEmployee?.id)
  const defaultPair = defaultDualPair(sorted, primary.id, settings.swapped)
  const employee = savedEmployee ?? defaultPair.employee
  let customer = savedCustomer ?? defaultPair.customer
  if (customer && customer.id === employee.id) {
    customer = firstOtherDisplay(sorted, employee.id) ?? null
  }
  if (!customer) {
    return {
      configuredMode: 'dual',
      effectiveMode: 'single',
      displayCount: sorted.length,
      primaryDisplayId: primary.id,
      employeeDisplay: employee,
      customerDisplay: null,
      customerVisible: false,
      canSwap: false,
      degraded: true,
      reason: 'customer-display-unavailable',
    }
  }

  return {
    configuredMode: 'dual',
    effectiveMode: 'dual',
    displayCount: sorted.length,
    primaryDisplayId: primary.id,
    employeeDisplay: employee,
    customerDisplay: customer,
    customerVisible: true,
    canSwap: true,
    degraded: false,
    reason: savedEmployee && savedCustomer ? 'saved-assignment' : 'default-assignment',
  }
}

export function settingsForMode(
  current: DisplayAssignmentSettings,
  mode: DisplayMode,
  plan: DisplayAssignmentPlan,
): DisplayAssignmentSettings {
  return {
    version: 1,
    displayMode: mode,
    swapped: current.swapped,
    employeeDisplay: plan.employeeDisplay ? referenceFromDisplay(plan.employeeDisplay) : current.employeeDisplay,
    customerDisplay: mode === 'dual' && plan.customerDisplay ? referenceFromDisplay(plan.customerDisplay) : current.customerDisplay,
  }
}

export function settingsForSwap(
  current: DisplayAssignmentSettings,
  plan: DisplayAssignmentPlan,
): DisplayAssignmentSettings | null {
  if (!plan.employeeDisplay || !plan.customerDisplay || !plan.canSwap) return null
  return {
    version: 1,
    displayMode: 'dual',
    swapped: !current.swapped,
    employeeDisplay: referenceFromDisplay(plan.customerDisplay),
    customerDisplay: referenceFromDisplay(plan.employeeDisplay),
  }
}

export function displayContainsRect(display: DisplaySnapshot, rect: DisplayRect): boolean {
  const area = display.workArea
  const center = {
    x: rect.x + Math.max(1, rect.width) / 2,
    y: rect.y + Math.max(1, rect.height) / 2,
  }
  return center.x >= area.x
    && center.x <= area.x + area.width
    && center.y >= area.y
    && center.y <= area.y + area.height
}

export function boundsForWindow(display: DisplaySnapshot, preferred: DisplaySize): DisplayRect {
  const width = Math.min(Math.max(800, preferred.width), display.workArea.width)
  const height = Math.min(Math.max(600, preferred.height), display.workArea.height)
  return {
    x: display.workArea.x + Math.max(0, Math.floor((display.workArea.width - width) / 2)),
    y: display.workArea.y + Math.max(0, Math.floor((display.workArea.height - height) / 2)),
    width,
    height,
  }
}

export function fullDisplayBounds(display: DisplaySnapshot): DisplayRect {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  }
}

function matchDisplay(
  ref: DisplayReference | undefined,
  displays: DisplaySnapshot[],
  primaryDisplayId: number | null,
  excludedId?: number,
): DisplaySnapshot | null {
  if (!ref) return null
  const candidates = displays.filter((display) => display.id !== excludedId)
  const exact = candidates.find((display) => display.id === ref.id)
  if (exact) return exact
  const scored = candidates
    .map((display) => ({ display, score: featureScore(ref, display, primaryDisplayId) }))
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score || stableDisplayCompare(a.display, b.display, primaryDisplayId))
  return scored[0]?.display ?? null
}

function featureScore(ref: DisplayReference, display: DisplaySnapshot, primaryDisplayId: number | null): number {
  let score = 0
  if (ref.label && display.label && ref.label === display.label) score += 4
  if (typeof ref.internal === 'boolean' && ref.internal === display.internal) score += 2
  if (ref.size && ref.size.width === display.size.width && ref.size.height === display.size.height) score += 2
  if (typeof ref.scaleFactor === 'number' && Math.abs(ref.scaleFactor - display.scaleFactor) < 0.01) score += 1
  if (ref.internal === true && display.id === primaryDisplayId) score += 1
  return score
}

function defaultDualPair(
  displays: DisplaySnapshot[],
  primaryDisplayId: number,
  swapped: boolean,
): { employee: DisplaySnapshot; customer: DisplaySnapshot | null } {
  const primary = displays.find((display) => display.id === primaryDisplayId) ?? displays[0]
  const external = firstOtherDisplay(displays, primary.id)
  if (!swapped) return { employee: primary, customer: external }
  return { employee: external ?? primary, customer: external ? primary : null }
}

function firstOtherDisplay(displays: DisplaySnapshot[], displayId: number): DisplaySnapshot | null {
  return displays.find((display) => display.id !== displayId) ?? null
}

function sortDisplays(displays: DisplaySnapshot[], primaryDisplayId: number | null): DisplaySnapshot[] {
  return [...displays].sort((a, b) => stableDisplayCompare(a, b, primaryDisplayId))
}

function stableDisplayCompare(a: DisplaySnapshot, b: DisplaySnapshot, primaryDisplayId: number | null): number {
  if (a.id === primaryDisplayId && b.id !== primaryDisplayId) return -1
  if (b.id === primaryDisplayId && a.id !== primaryDisplayId) return 1
  return a.bounds.x - b.bounds.x
    || a.bounds.y - b.bounds.y
    || a.bounds.width - b.bounds.width
    || a.bounds.height - b.bounds.height
    || a.id - b.id
}

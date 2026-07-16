import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DISPLAY_SETTINGS,
  boundsForWindow,
  displayContainsRect,
  planDisplayAssignment,
  settingsForSwap,
  type DisplaySnapshot,
} from '../src/main/displayAssignment'

function display(id: number, x: number, overrides: Partial<DisplaySnapshot> = {}): DisplaySnapshot {
  return {
    id,
    label: `DISPLAY-${id}`,
    bounds: { x, y: 0, width: 1280, height: 720 },
    workArea: { x, y: 0, width: 1280, height: 680 },
    size: { width: 1280, height: 720 },
    scaleFactor: 1,
    internal: id === 1,
    ...overrides,
  }
}

describe('display assignment planning', () => {
  it('guards an empty display collection', () => {
    const plan = planDisplayAssignment([], null, DEFAULT_DISPLAY_SETTINGS)
    expect(plan).toMatchObject({ effectiveMode: 'single', employeeDisplay: null, customerVisible: false, degraded: true })
  })

  it('keeps single display as employee only even when configured dual', () => {
    const plan = planDisplayAssignment([display(1, 0)], 1, { version: 1, displayMode: 'dual', swapped: false })
    expect(plan).toMatchObject({ configuredMode: 'dual', effectiveMode: 'single', customerDisplay: null, canSwap: false })
    expect(plan.employeeDisplay?.id).toBe(1)
  })

  it('defaults primary to employee and first sorted non-primary to customer', () => {
    const plan = planDisplayAssignment([display(3, 2000), display(2, 1300), display(1, 0)], 1)
    expect(plan.effectiveMode).toBe('dual')
    expect(plan.employeeDisplay?.id).toBe(1)
    expect(plan.customerDisplay?.id).toBe(2)
  })

  it('uses only two displays when more are available', () => {
    const plan = planDisplayAssignment([display(1, 0), display(3, 2600), display(2, 1300)], 1)
    expect(plan.employeeDisplay?.id).toBe(1)
    expect(plan.customerDisplay?.id).toBe(2)
  })

  it('restores saved display ids exactly', () => {
    const plan = planDisplayAssignment([display(1, 0), display(2, 1300)], 1, {
      version: 1,
      displayMode: 'dual',
      swapped: true,
      employeeDisplay: { id: 2 },
      customerDisplay: { id: 1 },
    })
    expect(plan.employeeDisplay?.id).toBe(2)
    expect(plan.customerDisplay?.id).toBe(1)
    expect(plan.reason).toBe('saved-assignment')
  })

  it('falls back to feature matching when saved ids changed', () => {
    const plan = planDisplayAssignment([display(10, 0, { internal: true }), display(20, 1300, { label: 'Customer HDMI' })], 10, {
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1, internal: true, size: { width: 1280, height: 720 }, scaleFactor: 1 },
      customerDisplay: { id: 2, label: 'Customer HDMI', internal: false, size: { width: 1280, height: 720 }, scaleFactor: 1 },
    })
    expect(plan.employeeDisplay?.id).toBe(10)
    expect(plan.customerDisplay?.id).toBe(20)
  })

  it('uses default assignment when feature matching is weak', () => {
    const plan = planDisplayAssignment([display(1, 0), display(2, 1300)], 1, {
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 99, label: 'Missing' },
      customerDisplay: { id: 98, label: 'Also Missing' },
    })
    expect(plan.employeeDisplay?.id).toBe(1)
    expect(plan.customerDisplay?.id).toBe(2)
  })

  it('restores swapped state without saved references', () => {
    const plan = planDisplayAssignment([display(1, 0), display(2, 1300)], 1, { version: 1, displayMode: 'dual', swapped: true })
    expect(plan.employeeDisplay?.id).toBe(2)
    expect(plan.customerDisplay?.id).toBe(1)
  })

  it('falls back when customer display is disconnected', () => {
    const plan = planDisplayAssignment([display(1, 0)], 1, {
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1 },
      customerDisplay: { id: 2 },
    })
    expect(plan.effectiveMode).toBe('single')
    expect(plan.customerVisible).toBe(false)
  })

  it('moves employee to remaining display when employee display is disconnected', () => {
    const plan = planDisplayAssignment([display(2, 0)], 2, {
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1 },
      customerDisplay: { id: 2 },
    })
    expect(plan.employeeDisplay?.id).toBe(2)
    expect(plan.customerDisplay).toBeNull()
  })

  it('responds to primary display changes without using Windows APIs', () => {
    const plan = planDisplayAssignment([display(1, 0), display(2, 1300)], 2)
    expect(plan.employeeDisplay?.id).toBe(2)
    expect(plan.customerDisplay?.id).toBe(1)
  })

  it('bounds changes do not invert saved roles', () => {
    const plan = planDisplayAssignment([display(1, 1300), display(2, 0)], 1, {
      version: 1,
      displayMode: 'dual',
      swapped: false,
      employeeDisplay: { id: 1 },
      customerDisplay: { id: 2 },
    })
    expect(plan.employeeDisplay?.id).toBe(1)
    expect(plan.customerDisplay?.id).toBe(2)
  })

  it('single mode never assigns a customer display', () => {
    const plan = planDisplayAssignment([display(1, 0), display(2, 1300)], 1, { version: 1, displayMode: 'single', swapped: false })
    expect(plan.effectiveMode).toBe('single')
    expect(plan.customerDisplay).toBeNull()
  })

  it('creates swap settings from a dual plan', () => {
    const plan = planDisplayAssignment([display(1, 0), display(2, 1300)], 1)
    const swapped = settingsForSwap(DEFAULT_DISPLAY_SETTINGS, plan)
    expect(swapped?.employeeDisplay?.id).toBe(2)
    expect(swapped?.customerDisplay?.id).toBe(1)
  })

  it('validates workArea containment and fallback bounds', () => {
    const target = display(1, 0)
    expect(displayContainsRect(target, { x: 10, y: 10, width: 500, height: 300 })).toBe(true)
    expect(displayContainsRect(target, { x: 5000, y: 10, width: 500, height: 300 })).toBe(false)
    expect(boundsForWindow(target, { width: 1600, height: 900 })).toMatchObject({ x: 0, y: 0, width: 1280, height: 680 })
  })
})

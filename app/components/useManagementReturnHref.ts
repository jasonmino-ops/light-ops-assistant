'use client'

import { useEffect, useState } from 'react'
import { readManagementReturnHref } from '@/lib/management-navigation'

/**
 * Returns the validated Management Center return href when the current page
 * was opened from /management (ES-MANAGEMENT-CENTER-P5-01), otherwise null so
 * the page keeps its existing legacy back target.
 */
export function useManagementReturnHref(): string | null {
  const [href, setHref] = useState<string | null>(null)
  useEffect(() => {
    setHref(readManagementReturnHref(window.location.search))
  }, [])
  return href
}

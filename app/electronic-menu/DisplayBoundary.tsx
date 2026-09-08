'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { isElectronicMenuPath } from '@/lib/electronic-menu'

/** Lives only inside the display document, never around merchant pages. */
export function DisplayDocumentBoundary({ children }: { children: ReactNode }) {
  const displayPath = isElectronicMenuPath(usePathname())
  useEffect(() => {
    if (!displayPath) window.location.replace(window.location.href)
  }, [displayPath])
  return displayPath ? children : null
}

/** App root layouts persist on SPA navigation; mount the screen only in its own document. */
export function DisplayPageBoundary({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (document.body.dataset.electronicMenuDocument !== 'true') {
      window.location.replace(window.location.href)
      return
    }
    setReady(true)
  }, [])
  return ready ? children : null
}

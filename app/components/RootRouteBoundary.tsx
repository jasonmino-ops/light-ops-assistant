'use client'

import { useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { isElectronicMenuPath } from '@/lib/electronic-menu'

/** Root layouts persist across client navigation. Cross this boundary as a new document. */
export default function RootRouteBoundary({ initialPublicMenu, children }: {
  initialPublicMenu: boolean
  children: ReactNode
}) {
  const pathname = usePathname()
  const changedShell = isElectronicMenuPath(pathname) !== initialPublicMenu

  useEffect(() => {
    if (changedShell) window.location.replace(window.location.href)
  }, [changedShell])

  // Unmount merchant providers immediately, before the new document loads.
  return changedShell ? null : children
}

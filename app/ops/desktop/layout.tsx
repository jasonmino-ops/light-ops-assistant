import type { ReactNode } from 'react'
import DesktopShell from './_components/DesktopShell'

export default function OpsDesktopLayout({ children }: { children: ReactNode }) {
  return <DesktopShell>{children}</DesktopShell>
}

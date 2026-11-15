'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'
import { path, useInventory, type Access } from '@/app/native-inventory/client'

export default function ComputerClientLayout({ children }: { children: ReactNode }) {
  const { t } = useLocale()
  const { effectiveRole, storeCode } = useWorkMode()
  const access = useInventory<Access>(effectiveRole === 'OWNER' && storeCode ? path('access', { storeCode }) : null)
  return <>
    {access?.data?.role === 'OWNER' && <div style={{ padding: '12px 16px 0', maxWidth: 760, margin: '0 auto' }}>
      <Link href="/desktop/inventory/authorize" style={{
        display: 'inline-flex', alignItems: 'center', minHeight: 44, color: 'var(--blue)', fontWeight: 600,
      }}>{t('management.inventoryDesktopOperator')}</Link>
    </div>}
    {children}
  </>
}

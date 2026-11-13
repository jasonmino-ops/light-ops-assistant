'use client'

import Link from 'next/link'
import type { CSSProperties } from 'react'
import { useLocale, type Lang } from '@/app/components/LangProvider'

const labels: Record<Lang, string> = {
  zh: '库存与入库',
  en: 'Inventory & Receiving',
  km: 'ស្តុក និងការទទួលទំនិញ',
}

export default function InventoryEntry({ style }: { style: CSSProperties }) {
  const { lang } = useLocale()
  return (
    <Link
      href="/inventory"
      prefetch={false}
      data-testid="inventory-entry"
      style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', textDecoration: 'none' }}
    >
      {labels[lang]}
    </Link>
  )
}

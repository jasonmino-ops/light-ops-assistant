'use client'

import Link from 'next/link'

export default function SalesProfitEntry() {
  return (
    <Link
      href="/sales-profit"
      data-testid="sales-profit-entry"
      style={{
        display: 'block',
        margin: '12px 0',
        padding: '16px 20px',
        border: '1px solid #dbeafe',
        borderRadius: 16,
        background: '#eff6ff',
        color: '#1e3a8a',
        textDecoration: 'none',
        fontWeight: 700,
      }}
    >
      销售利润 <span aria-hidden="true">›</span>
    </Link>
  )
}

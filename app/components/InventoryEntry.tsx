'use client'

import Link from 'next/link'

export default function InventoryEntry() {
  return (
    <Link
      href="/inventory"
      data-testid="inventory-entry"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        margin: '14px 0',
        padding: '16px 18px',
        border: '1px solid #fed7aa',
        borderRadius: 14,
        background: '#fff7ed',
        color: '#9a3412',
        textDecoration: 'none',
        fontWeight: 700,
      }}
    >
      <span>商品库存</span>
      <span aria-hidden="true">›</span>
    </Link>
  )
}

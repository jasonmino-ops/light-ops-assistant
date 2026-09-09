'use client'
import Link from 'next/link'
import { useLocale } from './LangProvider'
import { COPY } from '@/lib/product-sales/copy'

export default function ProductSalesEntry() {
  const { lang } = useLocale()
  return <Link href="/product-sales" data-testid="product-sales-entry" style={{ display: 'block', margin: '12px 0', padding: '16px 20px', border: '1px solid #e2e8f0', borderRadius: 16, background: '#fff', color: '#334155', textDecoration: 'none', fontWeight: 600 }}>{COPY[lang].title} <span aria-hidden="true">›</span></Link>
}

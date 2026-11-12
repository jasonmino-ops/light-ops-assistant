'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { dateLabel, money, receiptNumber, type Receipt } from './client'

export function Choices({ values, value, onChange, tabs = false }: { values: string[]; value: string; onChange: (v: string) => void; tabs?: boolean }) {
  return <div className={tabs ? 'tabs' : 'chips'}>{values.map((option) => <button key={option} type="button"
    className={`${tabs ? '' : 'chip '}${value === option ? 'on' : ''}`} aria-pressed={value === option} onClick={() => onChange(option)}>{option}</button>)}</div>
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children}</div>
}

export function Panel({ title, sub, children, footer, onClose, drawer = false }: {
  title: string; sub?: ReactNode; children: ReactNode; footer?: ReactNode; onClose?: () => void; drawer?: boolean
}) {
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const previous = document.activeElement
    panel.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  return <div className={'ov' + (drawer ? '' : ' center')}>
    <section ref={panel} className={drawer ? 'drawer' : 'modal'} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close.current?.()
        if (e.key !== 'Tab') return
        const focusable = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'))
        const first = focusable[0]
        const last = focusable.at(-1)
        if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
          e.preventDefault()
          last?.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first?.focus()
        }
      }}>
      {drawer ? <>
        <div className="dhead"><div className="grow"><h1>{title}</h1>{sub && <small>{sub}</small>}</div><button className="btn" onClick={onClose}>关闭</button></div>
        <div className="dbody">{children}</div>
        {footer && <div className="dfoot">{footer}</div>}
      </> : <><h1>{title}</h1>{children}{footer && <div className="mfoot">{footer}</div>}</>}
    </section>
  </div>
}

export function Icon({ kind }: { kind: 'stock' | 'suppliers' | 'profit' }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
    {kind === 'stock' ? <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></>
      : kind === 'suppliers' ? <><path d="M2 7h11v9H2zM13 10h5l3 3v3h-8z" /><circle cx="6.5" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>
        : <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />}
  </svg>
}

export function ReceiptStatus({ receipt, pending }: { receipt: Receipt; pending?: boolean }) {
  return <span className={`tag ${receipt.postedAt ? 'green' : pending ? 'amber' : 'gray'}`}>{receipt.postedAt ? '已入库' : pending ? '待确认' : '草稿'}</span>
}

export function ReceiptSummary({ receipt, metadata = false }: { receipt: Receipt; metadata?: boolean }) {
  return <>
    <div className="card">
      <div className="kv"><span>供应商</span><b>{receipt.supplier.name}</b></div>
      {metadata && <>
        <div className="kv"><span>日期</span><span>{dateLabel(receipt.postedAt ?? receipt.createdAt)}</span></div>
        <div className="kv"><span>请求号</span><span className="receipt-number">{receipt.id}</span></div>
      </>}
    </div>
    <div className="card">
      {receipt.lines.map((line) => <div className="kv" key={line.lineNo}>
        <span className="c-main"><b>{line.itemName}</b><small>{line.quantity} {line.unitName} × {money(line.unitPrice, receipt.currencyCode)}</small></span>
        <b>{money(line.amount, receipt.currencyCode)}</b>
      </div>)}
      <div className="kv"><span>{receipt.lines.length} 行 · 合计</span><b className="big">{money(receipt.total, receipt.currencyCode)}</b></div>
    </div>
  </>
}

export function ReceiptRow({ receipt, pending, onOpen }: { receipt: Receipt; pending?: boolean; onOpen: () => void }) {
  const date = dateLabel(receipt.postedAt ?? receipt.createdAt)
  return <button className="row g-rec" onClick={onOpen}>
    <span className="c-main"><b>{receiptNumber(receipt.id)}</b><small className="mo">{receipt.supplier.name} · {date}</small></span>
    <span className="dx">{date}</span><span className="dx">{receipt.supplier.name}</span>
    <span className="num dx">{receipt.lines.length}</span><span className="num"><b>{money(receipt.total, receipt.currencyCode)}</b></span>
    <span><ReceiptStatus receipt={receipt} pending={pending} /></span>
  </button>
}

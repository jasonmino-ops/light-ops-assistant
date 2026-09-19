'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type IconName =
  | 'receipt'
  | 'refund'
  | 'orders'
  | 'box'
  | 'chart'
  | 'user'
  | 'store'
  | 'invite'
  | 'qrcode'
  | 'settings'
  | 'printer'
  | 'help'

type Entry = {
  href?: string
  label: string
  description: string
  icon: IconName
  ownerOnly?: boolean
  status?: string
}

type Group = {
  key: 'business' | 'data' | 'members' | 'stores' | 'system'
  title: string
  icon: IconName
  accent: string
  entries: Entry[]
}

function SemanticIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'receipt':
      return <svg {...common}><path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" /><path d="M9 8h6M9 11.5h6M9 15h3" /></svg>
    case 'refund':
      return <svg {...common}><path d="M7 7h9a4 4 0 0 1 0 8H8" /><path d="m10 4-3 3 3 3" /><path d="M5 18h7" /></svg>
    case 'orders':
      return <svg {...common}><path d="M5 6.5h14v12H5z" /><path d="M8 6.5V5a4 4 0 0 1 8 0v1.5M8 11h8M8 14.5h5" /></svg>
    case 'box':
      return <svg {...common}><path d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10" /><path d="m8 5 8 4" /></svg>
    case 'chart':
      return <svg {...common}><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 19h18" /></svg>
    case 'user':
      return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></svg>
    case 'store':
      return <svg {...common}><path d="M4 10v10h16V10M3 10l2-6h14l2 6" /><path d="M3 10a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-5h6v5" /></svg>
    case 'invite':
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0M18 8v6M15 11h6" /></svg>
    case 'qrcode':
      return <svg {...common}><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2M18 14h2M14 18h2M18 18h2M14 20h6" /></svg>
    case 'settings':
      return <svg {...common}><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /><circle cx="12" cy="12" r="4.2" /></svg>
    case 'printer':
      return <svg {...common}><path d="M6 9V4h12v5M6 17H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2" /><path d="M6 14h12v7H6zM17 12h.01" /></svg>
    case 'help':
      return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M9.6 9a2.5 2.5 0 1 1 4.2 1.8c-1.1.9-1.8 1.3-1.8 2.7M12 16.8h.01" /></svg>
  }
}

export default function ManagementPage() {
  const { t } = useLocale()
  const { effectiveRole, storeName, storeCode, tenantName } = useWorkMode()
  const isOwner = effectiveRole === 'OWNER'
  const currentStore = storeName ?? tenantName
  const [navigationContext, setNavigationContext] = useState({ fromDesktop: false, storeCode: null as string | null })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setNavigationContext({
      fromDesktop: params.get('from') === 'desktop',
      storeCode: params.get('storeCode')?.trim() || null,
    })
  }, [])

  const navigationStoreCode = navigationContext.storeCode ?? storeCode
  const cashierHref = navigationContext.fromDesktop
    ? navigationStoreCode
      ? `/desktop/pos?mode=pos&storeCode=${encodeURIComponent(navigationStoreCode)}`
      : '/desktop/pos?mode=pos'
    : navigationStoreCode
      ? `/cashier?storeCode=${encodeURIComponent(navigationStoreCode)}`
      : '/cashier'

  const groups: Group[] = [
    {
      key: 'business',
      title: t('management.business'),
      icon: 'receipt',
      accent: '#eaf3ff',
      entries: [
        { href: '/records', label: t('management.salesRecords'), description: t('management.salesRecordsDesc'), icon: 'receipt' },
        { href: '/refund', label: t('management.refunds'), description: t('management.refundsDesc'), icon: 'refund' },
        { href: cashierHref, label: t('management.pendingOrders'), description: t('management.pendingOrdersDesc'), icon: 'orders' },
      ],
    },
    {
      key: 'data',
      title: t('management.data'),
      icon: 'chart',
      accent: '#f1efff',
      entries: [
        { href: '/products', label: t('management.products'), description: t('management.productsDesc'), icon: 'box', ownerOnly: true },
        { href: '/product-sales', label: t('management.productSales'), description: t('management.productSalesDesc'), icon: 'chart', ownerOnly: true },
      ],
    },
    {
      key: 'members',
      title: t('management.members'),
      icon: 'user',
      accent: '#edf8f3',
      entries: [
        { href: '/members', label: t('management.memberManagement'), description: t('management.memberManagementDesc'), icon: 'user', ownerOnly: true },
      ],
    },
    {
      key: 'stores',
      title: t('management.stores'),
      icon: 'store',
      accent: '#fff6e8',
      entries: [
        { href: '/my-stores', label: t('management.storeList'), description: t('management.storeListDesc'), icon: 'store', ownerOnly: true },
        { href: '/invite', label: t('management.staffInvite'), description: t('management.staffInviteDesc'), icon: 'invite', ownerOnly: true },
        { href: '/table-qrcodes', label: t('management.tableQrcodes'), description: t('management.tableQrcodesDesc'), icon: 'qrcode', ownerOnly: true },
      ],
    },
    {
      key: 'system',
      title: t('management.system'),
      icon: 'settings',
      accent: '#f1f3f6',
      entries: [
        { label: t('management.printConfig'), description: t('management.printConfigDesc'), icon: 'printer', status: t('management.comingSoon') },
        { href: '/contact', label: t('management.support'), description: t('management.supportDesc'), icon: 'help' },
      ],
    },
  ]

  return (
    <main style={styles.page}>
      <style>{responsiveStyles}</style>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <h1 style={styles.title}>{t('management.title')}</h1>
            <div style={styles.storeChip}>
              <span style={styles.storeChipIcon}><SemanticIcon name="store" size={16} /></span>
              {currentStore ? (
                <span style={styles.storeChipLabel}>{currentStore}</span>
              ) : (
                <span style={styles.storeSkeleton} aria-hidden="true" />
              )}
            </div>
          </div>
          <div style={styles.headerActions}>
            <span style={styles.rolePill}>
              <SemanticIcon name="user" size={14} />
              {isOwner ? t('management.ownerRole') : t('management.staffRole')}
            </span>
            <Link href={cashierHref} style={styles.backLink}>
              <SemanticIcon name="receipt" size={16} />
              {t('management.backToCashier')}
            </Link>
          </div>
        </header>

        <div className="management-hub-grid" style={styles.groups}>
          {groups.filter((group) => isOwner || group.entries.some((entry) => !entry.ownerOnly)).map((group) => {
            const visibleEntries = group.entries.filter((entry) => isOwner || !entry.ownerOnly)
            return (
              <section
                key={group.key}
                className={`management-group ${group.key === 'system' ? 'management-system-group' : ''}`}
                style={{ ...styles.group, background: `linear-gradient(145deg, ${group.accent} 0%, #ffffff 72%)` }}
              >
                <div style={styles.groupHeading}>
                  <span style={{ ...styles.groupIcon, background: group.accent }}>
                    <SemanticIcon name={group.icon} size={21} />
                  </span>
                  <h2 style={styles.groupTitle}>{group.title}</h2>
                </div>
                <div style={styles.entries}>
                  {visibleEntries.map((entry) => {
                    const content = (
                      <>
                        <span style={styles.entryIcon}><SemanticIcon name={entry.icon} size={18} /></span>
                        <span style={styles.entryBody}>
                          <span style={styles.entryLabel}>{entry.label}</span>
                          <span style={styles.entryDescription}>{entry.description}</span>
                        </span>
                        {entry.status ? (
                          <span style={styles.entryStatus}>{entry.status}</span>
                        ) : (
                          <span style={styles.entryArrow} aria-hidden="true">›</span>
                        )}
                      </>
                    )

                    return entry.href ? (
                      <Link key={entry.label} href={entry.href} style={styles.entry}>
                        {content}
                      </Link>
                    ) : (
                      <div key={entry.label} style={{ ...styles.entry, ...styles.disabledEntry }} aria-disabled="true">
                        {content}
                      </div>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}

const responsiveStyles = `
  .management-hub-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .management-system-group { grid-column: span 2; }
  @media (max-width: 1080px) {
    .management-hub-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .management-system-group { grid-column: span 1; }
  }
  @media (max-width: 640px) {
    .management-hub-grid { grid-template-columns: 1fr; }
    .management-system-group { grid-column: span 1; }
  }
`

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: 'calc(100dvh - 76px)',
    boxSizing: 'border-box',
    background: '#f7f9fc',
    color: '#182234',
    padding: '28px 24px 40px',
  },
  shell: {
    width: 'min(1240px, 100%)',
    margin: '0 auto',
  },
  header: {
    minHeight: 72,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    marginBottom: 24,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 },
  title: { margin: 0, fontSize: 25, lineHeight: 1.1, letterSpacing: '-0.035em', fontWeight: 760, whiteSpace: 'nowrap' },
  storeChip: {
    minWidth: 164,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '0 12px',
    border: '1px solid #e3e8f0',
    borderRadius: 999,
    background: '#fff',
    color: '#5d6a7c',
    fontSize: 13,
    fontWeight: 650,
  },
  storeChipIcon: { display: 'inline-flex', color: '#6c7a8e' },
  storeChipLabel: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  storeSkeleton: { display: 'block', width: 112, height: 10, borderRadius: 999, background: '#e9edf3' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  rolePill: {
    height: 34,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 11px',
    border: '1px solid #e3e8f0',
    borderRadius: 999,
    background: '#fff',
    color: '#536174',
    fontSize: 12,
    fontWeight: 700,
  },
  backLink: {
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '0 14px',
    borderRadius: 10,
    background: '#155dcc',
    color: '#fff',
    boxShadow: '0 5px 14px rgba(29, 111, 232, 0.16)',
    fontSize: 13,
    fontWeight: 720,
    textDecoration: 'none',
  },
  groups: { display: 'grid', gap: 18, alignItems: 'stretch' },
  group: {
    minWidth: 0,
    padding: 20,
    border: '1px solid rgba(221, 227, 236, 0.92)',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(33, 48, 74, 0.035)',
  },
  groupHeading: { display: 'flex', alignItems: 'center', gap: 11, marginBottom: 17 },
  groupIcon: {
    width: 38,
    height: 38,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 11,
    color: '#526175',
  },
  groupTitle: { margin: 0, fontSize: 18, lineHeight: 1.2, letterSpacing: '-0.025em', fontWeight: 750 },
  entries: { display: 'flex', flexDirection: 'column', gap: 9 },
  entry: {
    minHeight: 64,
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    padding: '11px 12px',
    border: '1px solid rgba(224, 230, 239, 0.92)',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.78)',
    color: 'inherit',
    textDecoration: 'none',
  },
  disabledEntry: { background: 'rgba(247, 249, 252, 0.72)', color: '#2f3d52' },
  entryIcon: { width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, borderRadius: 10, background: '#f3f5f8', color: '#6e7c8e' },
  entryBody: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 },
  entryLabel: { fontSize: 14, lineHeight: 1.2, fontWeight: 720 },
  entryDescription: { color: '#8792a2', fontSize: 12, lineHeight: 1.3 },
  entryArrow: { color: '#aeb8c7', fontSize: 21, lineHeight: 1, fontWeight: 350 },
  entryStatus: { flexShrink: 0, padding: '5px 8px', borderRadius: 8, background: '#eef1f5', color: '#8792a2', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' },
}

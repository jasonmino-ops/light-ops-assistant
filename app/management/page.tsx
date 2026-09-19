'use client'

import Link from 'next/link'
import { useLocale } from '@/app/components/LangProvider'
import { useWorkMode } from '@/app/components/WorkModeProvider'

type Entry = {
  href: string
  label: string
  description: string
  icon: string
  ownerOnly?: boolean
}

type Group = {
  title: string
  description: string
  entries: Entry[]
}

export default function ManagementPage() {
  const { t } = useLocale()
  const { effectiveRole, storeName, storeCode, tenantName } = useWorkMode()
  const isOwner = effectiveRole === 'OWNER'
  const currentStore = storeName ?? tenantName ?? t('management.storePending')
  const storeSuffix = storeCode ? ` · ${storeCode}` : ''
  const cashierHref = storeCode ? `/cashier?storeCode=${encodeURIComponent(storeCode)}` : '/cashier'

  const groups: Group[] = [
    {
      title: t('management.business'),
      description: t('management.businessDesc'),
      entries: [
        { href: '/records', label: t('management.salesRecords'), description: t('management.salesRecordsDesc'), icon: '↗' },
        { href: '/refund', label: t('management.refunds'), description: t('management.refundsDesc'), icon: '↩' },
        { href: cashierHref, label: t('management.pendingOrders'), description: t('management.pendingOrdersDesc'), icon: '▣' },
      ],
    },
    {
      title: t('management.data'),
      description: t('management.dataDesc'),
      entries: [
        { href: '/products', label: t('management.products'), description: t('management.productsDesc'), icon: '□', ownerOnly: true },
        { href: '/product-sales', label: t('management.productSales'), description: t('management.productSalesDesc'), icon: '▥', ownerOnly: true },
      ],
    },
    {
      title: t('management.members'),
      description: t('management.membersDesc'),
      entries: [
        { href: '/members', label: t('management.memberManagement'), description: t('management.memberManagementDesc'), icon: '◎', ownerOnly: true },
      ],
    },
    {
      title: t('management.stores'),
      description: t('management.storesDesc'),
      entries: [
        { href: '/my-stores', label: t('management.storeList'), description: t('management.storeListDesc'), icon: '⌂', ownerOnly: true },
        { href: '/invite', label: t('management.staffInvite'), description: t('management.staffInviteDesc'), icon: '＋', ownerOnly: true },
        { href: '/table-qrcodes', label: t('management.tableQrcodes'), description: t('management.tableQrcodesDesc'), icon: '▦', ownerOnly: true },
      ],
    },
    {
      title: t('management.system'),
      description: t('management.systemDesc'),
      entries: [
        { href: '/contact', label: t('management.support'), description: t('management.supportDesc'), icon: '?' },
      ],
    },
  ]

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div style={styles.headerCopy}>
            <div style={styles.eyebrow}>{t('management.currentStore')}</div>
            <div style={styles.storeLine}>
              <span style={styles.storeMark}>{currentStore.slice(0, 1).toUpperCase()}</span>
              <span style={styles.storeName}>{currentStore}{storeSuffix}</span>
            </div>
            <h1 style={styles.title}>{t('management.title')}</h1>
            <p style={styles.subtitle}>{t('management.subtitle')}</p>
          </div>
          <div style={styles.headerActions}>
            <span style={styles.rolePill}>{isOwner ? t('management.ownerRole') : t('management.staffRole')}</span>
            <Link href="/home" style={styles.backLink}>{t('management.backToBusiness')}</Link>
          </div>
        </header>

        <div style={styles.groups}>
          {groups.filter((group) => isOwner || group.entries.some((entry) => !entry.ownerOnly)).map((group) => {
            const visibleEntries = group.entries.filter((entry) => isOwner || !entry.ownerOnly)
            return (
              <section key={group.title} style={styles.group}>
                <div style={styles.groupHeading}>
                  <div>
                    <h2 style={styles.groupTitle}>{group.title}</h2>
                    <p style={styles.groupDescription}>{group.description}</p>
                  </div>
                  <span style={styles.groupRule} aria-hidden="true" />
                </div>
                {visibleEntries.length > 0 ? (
                  <div style={styles.cardGrid}>
                    {visibleEntries.map((entry) => (
                      <Link key={entry.href} href={entry.href} style={styles.card}>
                        <span style={styles.cardIcon} aria-hidden="true">{entry.icon}</span>
                        <span style={styles.cardBody}>
                          <span style={styles.cardLabel}>{entry.label}</span>
                          <span style={styles.cardDescription}>{entry.description}</span>
                        </span>
                        <span style={styles.cardArrow} aria-hidden="true">›</span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p style={styles.emptyGroup}>{t('management.ownerOnlyHint')}</p>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </main>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f5f7fb',
    color: '#162033',
    padding: 'clamp(24px, 5vw, 64px) 20px 72px',
  },
  shell: {
    width: 'min(1120px, 100%)',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: 28,
    padding: '0 4px 34px',
  },
  headerCopy: { minWidth: 0 },
  eyebrow: {
    color: '#8a96a8',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: 11,
  },
  storeLine: { display: 'flex', alignItems: 'center', gap: 9, marginBottom: 26 },
  storeMark: {
    width: 30,
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    background: '#e5efff',
    color: '#1467d8',
    fontSize: 13,
    fontWeight: 800,
  },
  storeName: { color: '#4d5b70', fontSize: 14, fontWeight: 650 },
  title: { margin: 0, fontSize: 'clamp(32px, 5vw, 48px)', lineHeight: 1.05, letterSpacing: '-0.045em', fontWeight: 760 },
  subtitle: { margin: '10px 0 0', color: '#7b8798', fontSize: 15, lineHeight: 1.5 },
  headerActions: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12, flexShrink: 0 },
  rolePill: {
    color: '#536174',
    background: '#fff',
    border: '1px solid #e4e9f1',
    borderRadius: 999,
    padding: '7px 12px',
    fontSize: 12,
    fontWeight: 700,
  },
  backLink: { color: '#1467d8', fontSize: 13, fontWeight: 700, textDecoration: 'none' },
  groups: { display: 'flex', flexDirection: 'column', gap: 30 },
  group: { padding: '25px 0 0', borderTop: '1px solid #e5eaf1' },
  groupHeading: { display: 'flex', alignItems: 'center', gap: 18, marginBottom: 15 },
  groupTitle: { margin: 0, fontSize: 19, lineHeight: 1.25, letterSpacing: '-0.02em', fontWeight: 750 },
  groupDescription: { margin: '5px 0 0', color: '#8994a4', fontSize: 13, lineHeight: 1.4 },
  groupRule: { height: 1, flex: 1, background: '#e9edf3' },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 245px), 1fr))', gap: 12 },
  card: {
    minHeight: 96,
    display: 'flex',
    alignItems: 'center',
    gap: 13,
    padding: '17px 16px',
    background: 'rgba(255,255,255,0.82)',
    border: '1px solid rgba(224,230,239,0.9)',
    borderRadius: 16,
    boxShadow: '0 8px 24px rgba(28, 44, 72, 0.045)',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'transform 140ms ease, box-shadow 140ms ease',
  },
  cardIcon: {
    width: 36,
    height: 36,
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    background: '#edf4ff',
    color: '#1467d8',
    fontSize: 20,
    fontWeight: 650,
  },
  cardBody: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 },
  cardLabel: { fontSize: 15, lineHeight: 1.2, fontWeight: 720 },
  cardDescription: { color: '#8792a2', fontSize: 12, lineHeight: 1.35 },
  cardArrow: { color: '#aeb8c7', fontSize: 25, lineHeight: 1, fontWeight: 350 },
  emptyGroup: { margin: 0, color: '#a2acba', fontSize: 13 },
}

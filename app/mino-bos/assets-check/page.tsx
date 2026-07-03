'use client'

import { useEffect, useMemo, useState } from 'react'

type ApiStatus = {
  status?: string
  scope?: string
  generatedAt?: string
  assets?: {
    stores?: AssetList<StoreItem>
    products?: AssetList
    sales?: AssetList<SaleItem>
    customerOrders?: AssetList<CustomerOrderItem>
    paymentMethodStats?: {
      groups?: PaymentMethodGroup[]
    }
    memberStats?: {
      total?: number
      byStatus?: { status: string; count: number }[]
      balanceExposure?: boolean
      ledgerExposure?: boolean
    }
    telegramEntryStatus?: StatusObject
    inviteBindBotEntryStatus?: StatusObject
    deviceStatus?: StatusObject
    printerStatus?: StatusObject
    posStatus?: StatusObject
    offlineSyncStatus?: StatusObject
  }
  warnings?: string[]
  error?: string
  message?: string
}

type AssetList<T = unknown> = {
  total?: number
  returned?: number
  items?: T[]
}

type StoreItem = {
  name?: string
  code?: string
  status?: string
  createdAt?: string
  updatedAt?: string
}

type SaleItem = {
  orderNo: string | null
  saleType: string
  status: string
  lineAmount: number
  createdAt: string
}

type CustomerOrderItem = {
  orderNo: string
  status: string
  paymentStatus: string
  totalAmount: number
  createdAt: string
  paidAt: string | null
}

type PaymentMethodGroup = {
  paymentMethod: string
  paymentStatus: string
  count: number
  amount: number
}

type StatusObject = {
  status?: string
  message?: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ok'; data: ApiStatus }
  | { status: 'unauthorized'; statusCode: number; apiStatus: string; message: string }
  | { status: 'error'; statusCode?: number; message: string }

type CheckTone = 'pass' | 'pending' | 'readonly' | 'fail' | 'reserved'

const todayKey = new Date().toLocaleDateString('en-CA')

function sameLocalDay(value: string | null | undefined) {
  if (!value) return false
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return false
  return date.toLocaleDateString('en-CA') === todayKey
}

function money(value: number) {
  return `$${value.toFixed(2)}`
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unavailable'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sumTodaySales(sales: SaleItem[]) {
  return sales
    .filter((sale) => sale.saleType === 'SALE' && sale.status === 'COMPLETED' && sameLocalDay(sale.createdAt))
    .reduce((sum, sale) => sum + (Number(sale.lineAmount) || 0), 0)
}

function sumTodayCustomerOrders(orders: CustomerOrderItem[]) {
  return orders
    .filter((order) => order.status === 'COMPLETED' && order.paymentStatus === 'PAID' && sameLocalDay(order.paidAt ?? order.createdAt))
    .reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0)
}

function countTodayOrders(sales: SaleItem[], orders: CustomerOrderItem[]) {
  const saleOrderNos = new Set(
    sales
      .filter((sale) => sale.saleType === 'SALE' && sale.status === 'COMPLETED' && sameLocalDay(sale.createdAt))
      .map((sale) => sale.orderNo || `sale:${sale.createdAt}:${sale.lineAmount}`),
  )
  const customerOrderNos = new Set(
    orders
      .filter((order) => order.status === 'COMPLETED' && order.paymentStatus === 'PAID' && sameLocalDay(order.paidAt ?? order.createdAt))
      .map((order) => order.orderNo),
  )
  return saleOrderNos.size + customerOrderNos.size
}

function latestSaleTime(sales: SaleItem[]) {
  const latest = sales
    .map((sale) => sale.createdAt)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))[0]
  return formatDateTime(latest)
}

function paymentSummary(groups: PaymentMethodGroup[]) {
  if (groups.length === 0) return 'no aggregate payment data'
  return groups
    .map((group) => `${group.paymentMethod}/${group.paymentStatus}: ${group.count} orders · ${money(Number(group.amount) || 0)}`)
    .join(' | ')
}

function countPaymentGroups(groups: PaymentMethodGroup[], status: string, paymentMethod?: string) {
  return groups
    .filter((group) => {
      const matchesStatus = group.paymentStatus === status
      const matchesMethod = paymentMethod ? group.paymentMethod === paymentMethod : true
      return matchesStatus && matchesMethod
    })
    .reduce((sum, group) => sum + (Number(group.count) || 0), 0)
}

function statusTone(status?: string): CheckTone {
  if (status === 'pending_real_device_validation') return 'pending'
  if (status === 'placeholder_only') return 'readonly'
  if (status) return 'pass'
  return 'fail'
}

function getErrorText(data: ApiStatus, statusCode: number) {
  return data.message || data.error || `接口请求失败，HTTP ${statusCode}`
}

function getApiStatus(data: ApiStatus, statusCode: number) {
  if (statusCode === 401) return 'unauthorized / login_required'
  if (statusCode === 403) return 'forbidden'
  return data.error || `http_${statusCode}`
}

export default function MinoBosAssetsCheckPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  async function load() {
    setState({ status: 'loading' })
    try {
      const response = await fetch('/api/mino-bos/business-assets', {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      })
      const data = await response.json().catch(() => ({} as ApiStatus))
      if (!response.ok) {
        if (response.status === 401) {
          setState({
            status: 'unauthorized',
            statusCode: response.status,
            apiStatus: getApiStatus(data, response.status),
            message: getErrorText(data, response.status),
          })
          return
        }
        setState({ status: 'error', statusCode: response.status, message: getErrorText(data, response.status) })
        return
      }
      setState({ status: 'ok', data })
    } catch (error) {
      setState({ status: 'error', message: error instanceof Error ? error.message : '无法连接只读资产接口' })
    }
  }

  useEffect(() => { load() }, [])

  const data = state.status === 'ok' ? state.data : null
  const assets = data?.assets
  const stores = assets?.stores?.items ?? []
  const sales = assets?.sales?.items ?? []
  const customerOrders = assets?.customerOrders?.items ?? []
  const paymentGroups = assets?.paymentMethodStats?.groups ?? []
  const primaryStore = stores[0]

  const summary = useMemo(() => {
    const todaySales = sumTodaySales(sales)
    const todayCustomerOrderSales = sumTodayCustomerOrders(customerOrders)
    return {
      todaySalesAmount: todaySales + todayCustomerOrderSales,
      todayOrderCount: countTodayOrders(sales, customerOrders),
      latestSaleAt: latestSaleTime(sales),
      hasRealBusinessData:
        (assets?.sales?.total ?? 0) > 0 ||
        (assets?.customerOrders?.total ?? 0) > 0 ||
        (assets?.products?.total ?? 0) > 0,
    }
  }, [assets?.customerOrders?.total, assets?.products?.total, assets?.sales?.total, sales, customerOrders])

  const outputPreview = useMemo(() => {
    const pendingKhqrCount = countPaymentGroups(paymentGroups, 'PENDING', 'KHQR')
    const cancelledPaymentCount = countPaymentGroups(paymentGroups, 'CANCELLED')
    const hasCustomerOrders = (assets?.customerOrders?.total ?? 0) > 0
    const productCount = assets?.products?.total ?? 0

    return {
      paymentDistributionSummary: paymentSummary(paymentGroups),
      pendingKhqrCount,
      cancelledPaymentCount,
      reminders: [
        {
          name: '今日订单数为 0',
          detail: summary.todayOrderCount === 0 ? 'reminder preview only' : `${summary.todayOrderCount} orders today`,
          tone: summary.todayOrderCount === 0 ? 'pending' : 'readonly',
        },
        {
          name: '今日销售额为 0',
          detail: summary.todaySalesAmount === 0 ? 'reminder preview only' : money(summary.todaySalesAmount),
          tone: summary.todaySalesAmount === 0 ? 'pending' : 'readonly',
        },
        {
          name: 'KHQR PENDING 聚合记录',
          detail: pendingKhqrCount > 0 ? `${pendingKhqrCount} aggregate records · no auto-confirm` : 'none in aggregate data',
          tone: pendingKhqrCount > 0 ? 'pending' : 'readonly',
        },
        {
          name: 'CANCELLED 聚合记录',
          detail: cancelledPaymentCount > 0 ? `${cancelledPaymentCount} aggregate records · not an incident confirmation` : 'none in aggregate data',
          tone: cancelledPaymentCount > 0 ? 'pending' : 'readonly',
        },
        {
          name: '商品数量是否为 0',
          detail: productCount === 0 ? '0 products in read-only asset data' : `${productCount} products`,
          tone: productCount === 0 ? 'pending' : 'readonly',
        },
        {
          name: '顾客订单是否存在',
          detail: hasCustomerOrders ? `${assets?.customerOrders?.total ?? 0} customer orders` : 'no customer orders in read-only asset data',
          tone: hasCustomerOrders ? 'readonly' : 'pending',
        },
        {
          name: 'Device / Printer / POS / Offline sync',
          detail: 'pending_real_device_validation · no recovery action',
          tone: 'pending',
        },
      ] satisfies { name: string; detail: string; tone: CheckTone }[],
    }
  }, [
    assets?.customerOrders?.total,
    assets?.products?.total,
    paymentGroups,
    summary.todayOrderCount,
    summary.todaySalesAmount,
  ])

  return (
    <main style={s.page}>
      <section style={s.hero}>
        <div>
          <p style={s.eyebrow}>Chief Founder Console V1</p>
          <h1 style={s.title}>Mino BOS Founder Console V1</h1>
          <p style={s.subtitle}>Read-only Preview</p>
          <p style={s.heroHint}>Batch 3D · 基于 Batch 3C 已验证只读资产 · 内部观察页</p>
        </div>
        <button style={s.refreshButton} onClick={load} disabled={state.status === 'loading'}>
          {state.status === 'loading' ? 'Loading' : 'Refresh'}
        </button>
      </section>

      <section style={s.gridFour}>
        <InfoCard label="当前状态" value="read_only" tone="readonly" />
        <InfoCard label="数据来源" value="Batch 3C Business Asset Adapter" tone="readonly" />
        <InfoCard label="设备验证" value="Pending Real Device Validation" tone="pending" />
        <InfoCard label="写回能力" value="Disabled" tone="fail" />
      </section>

      {state.status === 'error' && (
        <section style={{ ...s.panel, borderColor: '#ef4444' }}>
          <StatusBadge tone="fail" label="FAIL" />
          <h2 style={s.panelTitle}>接口请求失败</h2>
          <p style={s.errorText}>{state.message}</p>
          {state.statusCode ? <p style={s.muted}>HTTP status: {state.statusCode}</p> : null}
        </section>
      )}

      {state.status === 'unauthorized' && (
        <>
          <section style={{ ...s.panel, borderColor: '#f59e0b' }}>
            <StatusBadge tone="pending" label="LOGIN REQUIRED" />
            <h2 style={s.panelTitle}>未检测到商户登录态</h2>
            <div style={s.checkGrid}>
              <CheckRow name="当前状态" detail="未检测到有效 OWNER / STAFF 登录态" tone="pending" />
              <CheckRow name="API 状态" detail={`${state.apiStatus} (${state.message})`} tone="pending" />
              <CheckRow name="权限说明" detail="真实业务资产读取必须通过 OWNER / STAFF 登录态" tone="readonly" />
              <CheckRow name="下一步" detail="请从 Telegram 商户端进入店小二后再访问本页面" tone="readonly" />
            </div>
          </section>
          <section style={s.panel}>
            <h2 style={s.panelTitle}>只读静态检查</h2>
            <div style={s.checkGrid}>
              <CheckRow name="页面部署" detail="OK" tone="pass" />
              <CheckRow name="当前路径" detail="/mino-bos/assets-check" tone="pass" />
              <CheckRow name="API 真实数据读取" detail="需要 OWNER / STAFF 登录态" tone="pending" />
              <CheckRow name="Device / Printer / POS" detail="pending_real_device_validation" tone="pending" />
            </div>
          </section>
        </>
      )}

      {state.status === 'loading' && (
        <section style={s.panel}>
          <StatusBadge tone="pending" label="PENDING" />
          <h2 style={s.panelTitle}>正在读取只读资产接口</h2>
          <p style={s.muted}>GET /api/mino-bos/business-assets</p>
        </section>
      )}

      {data && (
        <>
          <section style={s.panel}>
            <h2 style={s.panelTitle}>商户 / 门店状态</h2>
            <div style={s.metricGrid}>
              <Metric label="门店名称" value={primaryStore?.name ?? 'unavailable'} />
              <Metric label="门店数量 / 当前门店" value={`${assets?.stores?.total ?? 0} / ${primaryStore?.code ?? 'unavailable'}`} />
              <Metric label="最近销售时间" value={summary.latestSaleAt} />
              <Metric label="真实业务数据" value={summary.hasRealBusinessData ? 'available' : 'unavailable'} />
            </div>
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>今日经营摘要</h2>
            <div style={s.metricGrid}>
              <Metric label="今日销售额" value={money(summary.todaySalesAmount)} />
              <Metric label="今日订单数" value={String(summary.todayOrderCount)} />
              <Metric label="商品数量" value={String(assets?.products?.total ?? 0)} />
              <Metric label="顾客订单数量" value={String(assets?.customerOrders?.total ?? 0)} />
              <Metric label="会员数量统计" value={String(assets?.memberStats?.total ?? 0)} />
            </div>

            <div style={s.subsection}>
              <h3 style={s.subTitle}>支付方式分布</h3>
              {(assets?.paymentMethodStats?.groups?.length ?? 0) > 0 ? (
                <div style={s.table}>
                  {assets?.paymentMethodStats?.groups?.map((group) => (
                    <div key={`${group.paymentMethod}:${group.paymentStatus}`} style={s.tableRow}>
                      <span>{group.paymentMethod} / {group.paymentStatus}</span>
                      <span>{group.count} orders</span>
                      <span>{money(Number(group.amount) || 0)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={s.muted}>暂无支付方式统计</p>
              )}
            </div>

            <div style={s.subsection}>
              <h3 style={s.subTitle}>会员状态统计</h3>
              {(assets?.memberStats?.byStatus?.length ?? 0) > 0 ? (
                <div style={s.table}>
                  {assets?.memberStats?.byStatus?.map((group) => (
                    <div key={group.status} style={s.tableRowTwo}>
                      <span>{group.status}</span>
                      <span>{group.count} members</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={s.muted}>暂无会员状态统计</p>
              )}
            </div>
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>业务资产只读状态</h2>
            <div style={s.checkGrid}>
              <CheckRow name="Store" detail={`已接入 · ${assets?.stores?.returned ?? 0}/${assets?.stores?.total ?? 0} returned`} tone="readonly" />
              <CheckRow name="Product" detail={`已接入 · ${assets?.products?.returned ?? 0}/${assets?.products?.total ?? 0} returned`} tone="readonly" />
              <CheckRow name="SaleRecord" detail={`已接入 · ${assets?.sales?.returned ?? 0}/${assets?.sales?.total ?? 0} returned`} tone="readonly" />
              <CheckRow name="Customer order" detail={`已接入 · ${assets?.customerOrders?.returned ?? 0}/${assets?.customerOrders?.total ?? 0} returned`} tone="readonly" />
              <CheckRow name="PaymentMethod stats" detail={`aggregate only · ${assets?.paymentMethodStats?.groups?.length ?? 0} groups`} tone="readonly" />
              <CheckRow name="Member stats" detail={`aggregate only · ${assets?.memberStats?.total ?? 0} members`} tone="readonly" />
            </div>
          </section>

          <section style={s.panel}>
            <h2 style={s.panelTitle}>占位与设备验证状态</h2>
            <div style={s.checkGrid}>
              <CheckRow name="Telegram binding" detail={assets?.telegramEntryStatus?.status ?? 'placeholder_only'} tone={statusTone(assets?.telegramEntryStatus?.status)} />
              <CheckRow name="Invite / Bind / Bot entry" detail={assets?.inviteBindBotEntryStatus?.status ?? 'placeholder_only'} tone={statusTone(assets?.inviteBindBotEntryStatus?.status)} />
              <CheckRow name="Device" detail={assets?.deviceStatus?.status ?? 'pending_real_device_validation'} tone="pending" />
              <CheckRow name="Printer" detail={assets?.printerStatus?.status ?? 'pending_real_device_validation'} tone="pending" />
              <CheckRow name="POS" detail={assets?.posStatus?.status ?? 'pending_real_device_validation'} tone="pending" />
              <CheckRow name="Offline sync" detail={assets?.offlineSyncStatus?.status ?? 'pending_real_device_validation'} tone="pending" />
            </div>
            <p style={s.note}>以上 pending 项不是已完成验证，不代表真实设备、打印机、POS 或离线同步已通过现场验收。</p>
          </section>
        </>
      )}

      <section style={s.panel}>
        <StatusBadge tone="readonly" label="READ-ONLY" />
        <h2 style={s.panelTitle}>Business Digital Employee Output Preview</h2>
        <p style={s.sectionLead}>Batch 3E · Read-only · Founder Decision Support Only</p>
        <p style={s.noteStrong}>Real Device First &gt; Digital Employee Preview</p>

        <div style={s.subsection}>
          <h3 style={s.subTitle}>Daily Business Summary Preview</h3>
          <div style={s.metricGrid}>
            <Metric label="今日销售额" value={data ? money(summary.todaySalesAmount) : 'read-only login required'} />
            <Metric label="今日订单数" value={data ? String(summary.todayOrderCount) : 'read-only login required'} />
            <Metric label="商品数量" value={data ? String(assets?.products?.total ?? 0) : 'read-only login required'} />
            <Metric label="顾客订单数量" value={data ? String(assets?.customerOrders?.total ?? 0) : 'read-only login required'} />
            <Metric label="会员数量统计" value={data ? String(assets?.memberStats?.total ?? 0) : 'read-only login required'} />
            <Metric label="最近销售时间" value={data ? summary.latestSaleAt : 'read-only login required'} />
            <Metric label="是否已有真实业务数据" value={data ? (summary.hasRealBusinessData ? 'available' : 'unavailable') : 'read-only login required'} />
            <Metric label="Device / Printer / POS / Offline sync" value="pending_real_device_validation" />
          </div>
          <div style={s.subsectionTight}>
            <CheckRow
              name="支付方式分布摘要"
              detail={data ? outputPreview.paymentDistributionSummary : 'read-only login required'}
              tone="readonly"
            />
          </div>
        </div>

        <div style={s.subsection}>
          <h3 style={s.subTitle}>Exception Reminder Preview</h3>
          <div style={s.checkGrid}>
            {(data
              ? outputPreview.reminders
              : [
                  { name: '只读数据状态', detail: '需要 OWNER / STAFF 登录态后展示静态提醒', tone: 'pending' as CheckTone },
                  { name: 'Device / Printer / POS / Offline sync', detail: 'pending_real_device_validation · no recovery action', tone: 'pending' as CheckTone },
                ]
            ).map((item) => (
              <CheckRow key={item.name} name={item.name} detail={item.detail} tone={item.tone} />
            ))}
          </div>
          <p style={s.note}>以上只是只读提醒预览，不是事故确认，不会自动修复，不会触发 Recovery。</p>
        </div>

        <div style={s.subsection}>
          <h3 style={s.subTitle}>Merchant Pilot Record Preview</h3>
          <div style={s.checkGrid}>
            <CheckRow name="试点门店名称" detail={data ? primaryStore?.name ?? 'unavailable' : 'read-only login required'} tone="readonly" />
            <CheckRow name="是否已有真实业务数据" detail={data ? (summary.hasRealBusinessData ? 'available' : 'unavailable') : 'read-only login required'} tone="readonly" />
            <CheckRow name="最近销售时间" detail={data ? summary.latestSaleAt : 'read-only login required'} tone="readonly" />
            <CheckRow name="当前只读接入状态" detail="read_only_adapter_connected · no write-back" tone="readonly" />
            <CheckRow name="设备验证状态" detail="pending_real_device_validation" tone="pending" />
            <CheckRow name="商户反馈" detail="reserved" tone="reserved" />
            <CheckRow name="店员反馈" detail="reserved" tone="reserved" />
            <CheckRow name="收费意愿" detail="reserved" tone="reserved" />
            <CheckRow name="下一步人工跟进事项" detail="reserved" tone="reserved" />
          </div>
        </div>

        <div style={s.subsection}>
          <h3 style={s.subTitle}>Output Permission Labels</h3>
          <div style={s.permissionGrid}>
            <PermissionColumn
              tone="readonly"
              title="Allowed Now"
              items={[
                '今日经营摘要',
                '支付方式聚合摘要',
                '业务资产接入状态摘要',
                '设备 pending 提醒',
                '长时间无销售提醒',
                'KHQR PENDING 较多提醒',
                '试点门店基础信息',
              ]}
            />
            <PermissionColumn
              tone="reserved"
              title="Reserved"
              items={[
                '试点复盘建议',
                '商户反馈总结',
                '设备更换建议',
                '付费模式建议',
                'Recovery 建议',
                '数字员工主动通知',
                '商户活跃度评分',
              ]}
            />
            <PermissionColumn
              tone="fail"
              title="Forbidden Now"
              items={[
                '自动改订单',
                '自动改支付状态',
                '自动扣会员余额',
                '自动确认 KHQR',
                '自动发券',
                '自动联系顾客',
                '自动触发 Recovery',
                '自动改权限',
                '自动写回任何业务数据',
                '读取支付凭证 / MemberBalanceLedger / token',
              ]}
            />
          </div>
        </div>

        <div style={s.subsection}>
          <h3 style={s.subTitle}>Real Device Validation Boundary</h3>
          <div style={s.checkGrid}>
            {[
              '打印失败自动判断',
              'POS 在线状态判断',
              '扫码枪状态判断',
              '双屏状态判断',
              'Offline sync 真实异常判断',
              'KHQR 自动查询 / 回调确认',
              '商户活跃度真实判断',
              '收费模式真实建议',
              'Recovery action 自动建议',
              '数字员工主动通知',
            ].map((item) => (
              <CheckRow key={item} name={item} detail="requires real device / real merchant validation" tone="pending" />
            ))}
          </div>
        </div>
        <p style={s.note}>本区域不接 AI、不调用模型 API、不新增任务、cron 或 worker、不写回任何业务数据。</p>
      </section>

      <section style={s.panel}>
        <h2 style={s.panelTitle}>风险提示</h2>
        <div style={s.riskGrid}>
          {[
            '本页面只读',
            '不写回店小二',
            '不修改订单',
            '不修改支付状态',
            '不读取会员余额',
            '不读取支付凭证',
            '不自动确认 KHQR',
            '不触发 Recovery action',
            '设备状态等待真实设备验证',
            '当前不是 OPCR / Operational Completion',
          ].map((item) => (
            <div key={item} style={s.riskItem}>
              <StatusBadge tone="readonly" label="READ-ONLY" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

function InfoCard(props: { label: string; value: string; tone: CheckTone }) {
  return (
    <section style={s.infoCard}>
      <StatusBadge tone={props.tone} label={badgeLabel(props.tone)} />
      <div style={s.infoLabel}>{props.label}</div>
      <div style={s.infoValue}>{props.value}</div>
    </section>
  )
}

function CheckRow(props: { name: string; detail: string; tone: CheckTone }) {
  return (
    <div style={s.checkRow}>
      <StatusBadge tone={props.tone} label={badgeLabel(props.tone)} />
      <div>
        <div style={s.checkName}>{props.name}</div>
        <div style={s.muted}>{props.detail}</div>
      </div>
    </div>
  )
}

function Metric(props: { label: string; value: string }) {
  return (
    <div style={s.metric}>
      <div style={s.metricLabel}>{props.label}</div>
      <div style={s.metricValue}>{props.value}</div>
    </div>
  )
}

function PermissionColumn(props: { title: string; tone: CheckTone; items: string[] }) {
  return (
    <div style={s.permissionColumn}>
      <StatusBadge tone={props.tone} label={props.title} />
      <ul style={s.permissionList}>
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function badgeLabel(tone: CheckTone) {
  if (tone === 'readonly') return 'READ-ONLY'
  if (tone === 'pending') return 'PENDING'
  if (tone === 'reserved') return 'RESERVED'
  return tone.toUpperCase()
}

function StatusBadge(props: { tone: CheckTone; label: string }) {
  const palette = {
    pass: { bg: '#dcfce7', color: '#166534' },
    pending: { bg: '#fef3c7', color: '#92400e' },
    readonly: { bg: '#dbeafe', color: '#1e40af' },
    fail: { bg: '#fee2e2', color: '#991b1b' },
    reserved: { bg: '#f1f5f9', color: '#475569' },
  }[props.tone]

  return <span style={{ ...s.badge, background: palette.bg, color: palette.color }}>{props.label}</span>
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    color: '#111827',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  hero: {
    maxWidth: 1120,
    width: '100%',
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    gap: 16,
    alignItems: 'flex-start',
    padding: 18,
    borderRadius: 8,
    background: '#0f172a',
    color: '#fff',
  },
  eyebrow: { margin: 0, fontSize: 12, color: '#bfdbfe', fontWeight: 800 },
  title: { margin: '4px 0 0', fontSize: 26, lineHeight: 1.2 },
  subtitle: { margin: '2px 0 0', fontSize: 16, fontWeight: 800, color: '#dbeafe' },
  heroHint: { margin: '8px 0 0', fontSize: 13, color: '#cbd5e1' },
  refreshButton: {
    border: '1px solid rgba(255,255,255,0.32)',
    background: '#fff',
    color: '#0f172a',
    borderRadius: 8,
    padding: '8px 12px',
    fontWeight: 800,
    cursor: 'pointer',
  },
  gridFour: {
    maxWidth: 1120,
    width: '100%',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
    gap: 12,
  },
  panel: {
    maxWidth: 1120,
    width: '100%',
    margin: '0 auto',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
  },
  panelTitle: { margin: '8px 0 12px', fontSize: 16 },
  infoCard: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 16,
    minHeight: 104,
  },
  infoLabel: { marginTop: 12, color: '#64748b', fontSize: 12, fontWeight: 800 },
  infoValue: { marginTop: 6, fontSize: 15, fontWeight: 800, wordBreak: 'break-word' },
  checkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 10,
  },
  checkRow: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    gap: 10,
    alignItems: 'flex-start',
  },
  checkName: { fontWeight: 800, marginBottom: 4 },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 10,
  },
  metric: { border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 },
  metricLabel: { color: '#64748b', fontSize: 12, fontWeight: 800 },
  metricValue: { marginTop: 6, fontSize: 20, fontWeight: 900, wordBreak: 'break-word' },
  subsection: { marginTop: 16 },
  subsectionTight: { marginTop: 10 },
  subTitle: { margin: '0 0 8px', fontSize: 14 },
  sectionLead: { margin: '-4px 0 0', color: '#475569', fontSize: 13, fontWeight: 800 },
  table: { border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' },
  tableRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 12,
    padding: '10px 12px',
    borderBottom: '1px solid #e2e8f0',
    fontSize: 13,
  },
  tableRowTwo: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 12,
    padding: '10px 12px',
    borderBottom: '1px solid #e2e8f0',
    fontSize: 13,
  },
  riskGrid: { display: 'grid', gap: 8 },
  riskItem: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 },
  permissionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 10,
  },
  permissionColumn: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: 12,
  },
  permissionList: {
    margin: '10px 0 0',
    paddingLeft: 18,
    color: '#334155',
    fontSize: 13,
    lineHeight: 1.65,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    padding: '3px 7px',
    fontSize: 11,
    fontWeight: 900,
    whiteSpace: 'nowrap',
  },
  note: {
    margin: '12px 0 0',
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.55,
  },
  noteStrong: {
    margin: '10px 0 0',
    color: '#92400e',
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 13,
    fontWeight: 900,
  },
  muted: { color: '#64748b', fontSize: 12, margin: 0, wordBreak: 'break-word' },
  errorText: { color: '#991b1b', fontWeight: 800 },
}

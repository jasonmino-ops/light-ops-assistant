'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import QRCode from 'react-qr-code'
import { apiFetch, OWNER_CTX } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

type Store = { id: string; name: string; code: string; eLifeFeatured: boolean; eLifeFeaturedSort: number; businessType: string }
type Member = { id: string; username: string; displayName: string; role: string; bound: boolean; telegramId: string | null; staffNumber: number | null; storeName: string }
type TodayStats = { saleCount: number; saleAmount: number; refundCount: number; lastActiveAt: string | null }
type AiSupportConfigRow = {
  id: string
  provider: string
  enabled: boolean
  scope: 'TENANT' | 'STORE' | string
  tenantId: string
  storeId: string | null
  storeName: string | null
  storeCode: string | null
  apiBaseUrlMasked: string | null
  timeoutMs: number
  createdAt: string
  updatedAt: string
}
type AiSupportSummary = {
  totalConfigs: number
  enabledCount: number
  hasMultipleEnabled: boolean
  allDisabled: boolean
  blockedByTier: boolean
  canBeSelected: boolean
  safeStateLabel: string
  notes: string[]
}
type AiSupportOpsView = {
  tier: string
  canUseAiSupport: boolean
  configs: AiSupportConfigRow[]
  selectionSummary: AiSupportSummary
}
type AiPhotoStoreUsage = {
  storeId: string
  storeName: string
  storeCode: string
  tier: string
  statusLabel: string
  usedToday: number
  dailyLimit: number
  limitSource: 'OPS_OVERRIDE' | 'ENV_TRIAL' | 'TIER_DEFAULT' | string
  config: {
    id: string
    enabled: boolean
    dailyLimitOverride: number | null
    trialUntil: string | null
    opsNote: string
    updatedAt: string
  } | null
  latest: {
    id: string
    createdAt: string
    status: string
    message: string | null
    errorCode: string | null
    candidateCount: number | null
    latencyMs: number | null
  } | null
  last7Days: {
    totalCalls: number
    successCalls: number
    failedCalls: number
    limitReachedCalls: number
  }
}
type AiPhotoOpsView = {
  tier: string
  stores: AiPhotoStoreUsage[]
}

type TenantDetail = {
  id: string
  name: string
  status: string
  tier: string
  createdAt: string
  stores: Store[]
  members: Member[]
  today: TodayStats
  aiSupport: AiSupportOpsView
  aiPhoto: AiPhotoOpsView
}

const TIER_META: Record<string, { label: string; color: string; bg: string; border: string; desc: string; scan: string }> = {
  LITE:        { label: '轻试用版',     color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f', desc: '手机即用，适合个体小摊初次体验数字化',     scan: '摄像头扫码（强制）· 连续5次失败提示手动输入' },
  STANDARD:    { label: '标准收银版',   color: '#1677ff', bg: '#e6f4ff', border: '#91caff', desc: '单店实体零售，含商品管理与条码扫描',         scan: 'HID扫码枪优先 · 输入框默认聚焦 · 5次失败切换摄像头' },
  MULTI_STORE: { label: '门店标准化版', color: '#722ed1', bg: '#f9f0ff', border: '#d3adf7', desc: '多门店连锁，老板视角概览与店员模式',         scan: '继承标准收银版扫码策略 · 打印/贴标能力单独定义' },
}

type GenResult = { token: string; role: string; storeName: string; expiresAt: string; tgLink: string | null }

type BizOverview = { saleAmount: number; saleCount: number; refundAmount: number; refundCount: number; netAmount: number; cashSaleAmount?: number; khqrSaleAmount?: number }
type BizProduct  = { name: string; spec: string | null; qty: number; amount: number }
type BizRecord   = { id: string; createdAt: string; saleType: string; productName: string; spec: string | null; qty: number; lineAmount: number; storeName: string; operator: string; orderNo: string | null }
type BizStaff    = { displayName: string; saleCount: number; saleAmount: number }
type BizData     = { days: number; overview: BizOverview; topProducts: BizProduct[]; recentRecords: BizRecord[]; staffStats: BizStaff[]; productCount: number }

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TenantDetailPage() {
  const { tenantId } = useParams<{ tenantId: string }>()
  const [detail, setDetail] = useState<TenantDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}`, undefined, OWNER_CTX)
      if (r.ok) setDetail(await r.json())
      else setError('加载失败')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [tenantId])

  if (loading) return (
    <div style={s.center}>
      <div style={s.spinner} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
  if (error || !detail) return (
    <div style={s.center}>
      <p style={{ color: '#ff4d4f' }}>{error ?? '未找到商户'}</p>
      <Link href="/ops" style={s.backLink}>← 返回列表</Link>
    </div>
  )

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.headerTitle}>{detail.name}</div>
          <div style={s.headerSub}>ID: {detail.id.slice(0, 20)}…</div>
        </div>
        <Link href="/ops" style={s.backLink}>← 返回列表</Link>
      </div>

      <div style={s.body}>

        {/* Basic info */}
        <Section title="基本信息">
          <InfoGrid rows={[
            ['状态', detail.status === 'ACTIVE' ? '✅ 运营中' : '🔴 已归档停用'],
            ['创建时间', new Date(detail.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })],
            ['门店数', String(detail.stores.length)],
            ['成员数', String(detail.members.length)],
          ]} />
        </Section>

        {/* Lifecycle actions */}
        <Section title="商户管理">
          <LifecyclePanel tenantId={detail.id} currentStatus={detail.status} onChanged={load} />
        </Section>

        {/* Tier */}
        <Section title="产品档次">
          <TierPanel tenantId={detail.id} currentTier={detail.tier} onChanged={load} />
        </Section>

        {/* AI Support provider config — read-only ops view */}
        <Section title="AI Support 配置">
          <AiSupportPanel aiSupport={detail.aiSupport} />
        </Section>

        {/* AI photo recognition usage — read-only ops view */}
        <Section title="AI 拍照识别">
          <AiPhotoPanel tenantId={detail.id} aiPhoto={detail.aiPhoto} onChanged={load} />
        </Section>

        {/* Today stats */}
        <Section title="今日数据">
          <div style={s.statsRow}>
            <StatBox label="成交单数" value={String(detail.today.saleCount)} color="#1677ff" />
            <StatBox label="成交金额" value={`¥${detail.today.saleAmount.toFixed(2)}`} color="#52c41a" />
            <StatBox label="退款次数" value={String(detail.today.refundCount)} color={detail.today.refundCount > 0 ? '#ff4d4f' : '#bbb'} />
            <StatBox label="最近活跃"
              value={detail.today.lastActiveAt
                ? new Date(detail.today.lastActiveAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '无记录'}
              color="#888"
            />
          </div>
        </Section>

        {/* Business data — read-only ops view */}
        <Section title="经营数据（只读）">
          <BizDataPanel tenantId={detail.id} />
        </Section>

        {/* 门店列表（顾客资产 + E-Life 推荐） */}
        <Section title="门店列表">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {detail.stores.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>该商户暂无门店</div>
            ) : detail.stores.map((st) => (
              <StoreRow key={st.id} st={st} onChanged={load} />
            ))}
          </div>
        </Section>

        {/* Bind code generator */}
        <Section title="生成绑定码">
          <GenCodePanel tenantId={detail.id} stores={detail.stores} />
        </Section>

        {/* Member list */}
        <Section title="成员列表">
          <MemberList tenantId={detail.id} members={detail.members} onUnbound={load} />
        </Section>

      </div>
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={s.section}>
      <div style={s.sectionTitle}>{title}</div>
      {children}
    </div>
  )
}

// ─── StoreRow — 门店卡片（代运营 + 顾客资产 + E-Life 推荐） ─────────────────────

const BIZ_LABELS: Record<string, string> = {
  FOOD: '餐饮', RETAIL: '零售', SERVICE: '服务', GENERAL: '综合',
}

function StoreRow({ st, onChanged }: { st: Store; onChanged: () => void }) {
  const [featured, setFeatured] = useState(st.eLifeFeatured)
  const [sort, setSort]         = useState(String(st.eLifeFeaturedSort))
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')

  useEffect(() => {
    setFeatured(st.eLifeFeatured)
    setSort(String(st.eLifeFeaturedSort))
  }, [st.eLifeFeatured, st.eLifeFeaturedSort])

  async function patch(data: object) {
    setSaving(true); setErr('')
    try {
      const r = await apiFetch(`/api/ops/stores/${st.id}/e-life-featured`, {
        method: 'PATCH', body: JSON.stringify(data),
      }, OWNER_CTX)
      if (!r.ok) { const b = await r.json().catch(() => ({})); setErr(b.error ?? '保存失败') }
      else { onChanged() }
    } catch { setErr('网络错误') }
    finally { setSaving(false) }
  }

  function toggleFeatured() { const v = !featured; setFeatured(v); patch({ eLifeFeatured: v }) }
  function saveSort() { const v = parseInt(sort, 10); patch({ eLifeFeaturedSort: isNaN(v) ? 0 : v }) }

  return (
    <div style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${featured ? 'rgba(7,193,96,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: 10, overflow: 'hidden', marginBottom: 0 }}>

      {/* ── 信息区 ── */}
      <div style={{ padding: '12px 12px 10px' }}>
        {/* 店名 + code + 类型 + 推荐 badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, marginRight: 2 }}>{st.name}</span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', fontFamily: 'monospace', background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: 4, letterSpacing: '0.03em' }}>
            {st.code}
          </span>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', background: 'rgba(255,255,255,0.08)', padding: '1px 6px', borderRadius: 4 }}>
            {BIZ_LABELS[st.businessType] ?? st.businessType}
          </span>
          {/* E-Life 推荐 badge */}
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: featured ? 'rgba(7,193,96,0.18)' : 'rgba(255,255,255,0.06)',
            color:      featured ? '#4ade80'             : 'rgba(255,255,255,0.3)',
            border:     featured ? '1px solid rgba(7,193,96,0.35)' : '1px solid rgba(255,255,255,0.1)',
          }}>
            {featured ? '✓ E-Life 推荐' : 'E-Life 未推荐'}
          </span>
        </div>

        {/* 操作按钮 — 换行排列，代运营优先 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Link
            href={`/ops/stores/${encodeURIComponent(st.id)}/delegate`}
            style={{
              display: 'inline-block', padding: '7px 16px',
              background: '#d97706', color: '#fff',
              fontSize: 12, fontWeight: 700, borderRadius: 7,
              textDecoration: 'none', flexShrink: 0,
              boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
            }}
          >
            🛠 进入代运营
          </Link>
          <Link
            href={`/ops/stores/${encodeURIComponent(st.id)}/customers`}
            style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', textDecoration: 'none', flexShrink: 0, padding: '7px 4px' }}
          >
            顾客资产 ›
          </Link>
        </div>
      </div>

      {/* ── E-Life 推荐控件 ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {featured ? (
          <>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>排序：</span>
            <input
              type="number" value={sort} onChange={(e) => setSort(e.target.value)}
              style={{ width: 52, height: 26, textAlign: 'center', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, color: '#fff', fontSize: 11, outline: 'none' }}
            />
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', flexShrink: 0 }}>越小越前</span>
            <button disabled={saving} onClick={saveSort}
              style={{ height: 26, padding: '0 10px', fontSize: 11, cursor: 'pointer', borderRadius: 6, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.65)', border: '1px solid rgba(255,255,255,0.15)', opacity: saving ? 0.5 : 1, flexShrink: 0 }}>
              {saving ? '…' : '保存排序'}
            </button>
            <button disabled={saving} onClick={toggleFeatured}
              style={{ height: 26, padding: '0 10px', fontSize: 11, cursor: 'pointer', borderRadius: 6, background: 'rgba(220,50,50,0.18)', color: 'rgba(255,110,110,0.9)', border: '1px solid rgba(220,60,60,0.25)', opacity: saving ? 0.5 : 1, flexShrink: 0 }}>
              取消推荐
            </button>
          </>
        ) : (
          <button disabled={saving} onClick={toggleFeatured}
            style={{ height: 26, padding: '0 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', borderRadius: 6, background: '#07c160', color: '#fff', border: 'none', opacity: saving ? 0.5 : 1, flexShrink: 0 }}>
            {saving ? '…' : '设为 E-Life 推荐'}
          </button>
        )}
        {err && <span style={{ fontSize: 11, color: '#ff7875' }}>{err}</span>}
      </div>
    </div>
  )
}

// ─── InfoGrid ─────────────────────────────────────────────────────────────────

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div style={s.infoGrid}>
      {rows.map(([label, value]) => (
        <div key={label} style={s.infoRow}>
          <span style={s.infoLabel}>{label}</span>
          <span style={s.infoValue}>{value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── StatBox ─────────────────────────────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={s.statBox}>
      <div style={{ ...s.statBoxValue, color: color ?? '#333' }}>{value}</div>
      <div style={s.statBoxLabel}>{label}</div>
    </div>
  )
}

// ─── TierPanel ───────────────────────────────────────────────────────────────

function TierPanel({ tenantId, currentTier, onChanged }: { tenantId: string; currentTier: string; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const tm = TIER_META[currentTier] ?? TIER_META.LITE

  async function changeTier(tier: string) {
    if (tier === currentTier) return
    const target = TIER_META[tier]
    if (!confirm(`确认将档次从「${tm.label}」调整为「${target?.label ?? tier}」？`)) return
    setSaving(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tier }),
      }, OWNER_CTX)
      if (r.ok) { setExpanded(false); onChanged() }
      else setErr('更新失败')
    } catch {
      setErr('网络错误')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {/* Current tier display */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ ...s.tierBadge, background: tm.bg, color: tm.color, borderColor: tm.border }}>{tm.label}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#52c41a', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 8, padding: '1px 8px' }}>当前使用中</span>
      </div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{tm.desc}</div>
      <div style={{ fontSize: 11, color: '#aaa', marginBottom: 12, paddingLeft: 2 }}>
        📷 扫码策略：{tm.scan}
      </div>

      {/* Adjust trigger */}
      {!expanded && (
        <button style={s.adjustBtn} onClick={() => setExpanded(true)}>
          调整档次
        </button>
      )}

      {/* Expanded picker */}
      {expanded && (
        <div style={s.tierPicker}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>选择新档次（当前档次不可重复选择）：</div>
          <div style={s.tierRow}>
            {Object.entries(TIER_META).map(([key, meta]) => {
              const isCurrent = key === currentTier
              return (
                <button
                  key={key}
                  disabled={isCurrent || saving}
                  onClick={() => changeTier(key)}
                  style={{
                    ...s.tierBtn,
                    ...(isCurrent
                      ? { background: meta.bg, color: meta.color, borderColor: meta.border, fontWeight: 700, opacity: 0.5, cursor: 'not-allowed' }
                      : {}),
                  }}
                >
                  {meta.label}{isCurrent ? ' ✓' : ''}
                </button>
              )
            })}
          </div>
          <button style={s.cancelBtn} onClick={() => { setExpanded(false); setErr(null) }}>取消</button>
        </div>
      )}

      {err && <div style={s.errMsg}>{err}</div>}
    </div>
  )
}

// ─── AiSupportPanel — Provider 配置只读摘要 ───────────────────────────────────

function AiSupportPanel({ aiSupport }: { aiSupport: AiSupportOpsView }) {
  const tierMeta = TIER_META[aiSupport.tier] ?? TIER_META.LITE
  const summary = aiSupport.selectionSummary
  const statusCopy = getAiSupportStatusCopy(summary)
  const statusColor = summary.hasMultipleEnabled
    ? '#ff4d4f'
    : summary.canBeSelected
      ? '#fa8c16'
      : '#52c41a'
  const statusBg = summary.hasMultipleEnabled
    ? '#fff1f0'
    : summary.canBeSelected
      ? '#fff7e6'
      : '#f6ffed'
  const statusBorder = summary.hasMultipleEnabled
    ? '#ffa39e'
    : summary.canBeSelected
      ? '#ffd591'
      : '#b7eb8f'
  const productionConfigs = aiSupport.configs.filter((config) => !isTestAiProvider(config.provider))
  const testConfigs = aiSupport.configs.filter((config) => isTestAiProvider(config.provider))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...s.aiStatusBox, color: statusColor, background: statusBg, borderColor: statusBorder }}>
        <div style={{ fontSize: 14, fontWeight: 800 }}>{statusCopy.title}</div>
        <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.55 }}>{statusCopy.description}</div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: '#666' }}>套餐权限</div>
      <div style={s.aiSummaryGrid}>
        <div style={s.aiSummaryBox}>
          <div style={s.aiSummaryLabel}>当前档次</div>
          <div style={s.aiSummaryValue}>{tierMeta.label}</div>
          <div style={s.aiSummaryHint}>{aiSupport.tier}</div>
        </div>
        <div style={s.aiSummaryBox}>
          <div style={s.aiSummaryLabel}>AI Support L3</div>
          <div style={{ ...s.aiSummaryValue, color: aiSupport.canUseAiSupport ? '#52c41a' : '#ff4d4f' }}>
            {aiSupport.canUseAiSupport ? '允许' : '不允许'}
          </div>
          <div style={s.aiSummaryHint}>LITE 不允许；STANDARD / MULTI_STORE 允许</div>
        </div>
      </div>

      {summary.notes.length > 0 && (
        <div style={s.aiNotes}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#333', marginBottom: 4 }}>安全检查</div>
          <div style={s.aiNoteItem}>• 当前配置 {summary.totalConfigs} 条，开启 {summary.enabledCount} 条。</div>
          {summary.notes.map((note) => (
            <div key={note} style={s.aiNoteItem}>• {note}</div>
          ))}
        </div>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#666', marginBottom: 8 }}>Provider 配置</div>
        {aiSupport.configs.length === 0 ? (
          <div style={s.aiEmpty}>暂无 AI Support Provider 配置。</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AiSupportProviderGroup title="正式 / 可灰度 Provider" configs={productionConfigs} summary={summary} />
            <AiSupportProviderGroup title="测试 / 调试 Provider" configs={testConfigs} summary={summary} />
          </div>
        )}
      </div>
    </div>
  )
}

function getAiSupportStatusCopy(summary: AiSupportSummary): { title: string; description: string } {
  if (summary.blockedByTier) {
    return {
      title: 'AI Support 当前状态：套餐未开放',
      description: '当前套餐不允许 AI Support L3，即使存在 Provider 配置也不会调用 AI。',
    }
  }
  if (summary.hasMultipleEnabled) {
    return {
      title: 'AI Support 当前状态：配置冲突',
      description: '存在多个 enabled=true 的 Provider，selection policy 会拒绝调用 AI。',
    }
  }
  if (summary.canBeSelected) {
    return {
      title: 'AI Support 当前状态：存在可选 Provider',
      description: '当前存在一个可选 Provider，需确认是否为测试门店与灰度场景。',
    }
  }
  return {
    title: 'AI Support 当前状态：安全关闭',
    description: '当前没有启用任何 AI Provider，顾客消息不会调用 AI。',
  }
}

function isTestAiProvider(provider: string): boolean {
  return provider === 'MOCK' || provider === 'UNKNOWN'
}

function AiSupportProviderGroup({ title, configs, summary }: { title: string; configs: AiSupportConfigRow[]; summary: AiSupportSummary }) {
  if (configs.length === 0) {
    return (
      <div>
        <div style={s.aiGroupTitle}>{title}</div>
        <div style={s.aiEmpty}>暂无配置。</div>
      </div>
    )
  }

  return (
    <div>
      <div style={s.aiGroupTitle}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {configs.map((config) => (
          <AiSupportConfigCard key={config.id} config={config} summary={summary} />
        ))}
      </div>
    </div>
  )
}

function getAiProviderSafetyLabel(config: AiSupportConfigRow, summary: AiSupportSummary): { label: string; color: string; bg: string; border: string } {
  if (!config.enabled) return { label: '关闭', color: '#999', bg: '#f5f5f5', border: '#e8e8e8' }
  if (summary.hasMultipleEnabled) return { label: '冲突', color: '#ff4d4f', bg: '#fff1f0', border: '#ffa39e' }
  if (isTestAiProvider(config.provider)) return { label: '测试', color: '#1677ff', bg: '#e6f4ff', border: '#91caff' }
  if (summary.canBeSelected) return { label: '可选', color: '#fa8c16', bg: '#fff7e6', border: '#ffd591' }
  return { label: '关闭', color: '#999', bg: '#f5f5f5', border: '#e8e8e8' }
}

function AiSupportConfigCard({ config, summary }: { config: AiSupportConfigRow; summary: AiSupportSummary }) {
  const scopeLabel = config.scope === 'STORE' ? 'store 级' : 'tenant 级'
  const storeLabel = config.scope === 'STORE'
    ? `${config.storeName ?? '未知门店'}${config.storeCode ? ` / ${config.storeCode}` : ''}`
    : '全部门店（tenant 级）'
  const safety = getAiProviderSafetyLabel(config, summary)

  return (
    <div style={s.aiConfigCard}>
      <div style={s.aiConfigTop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={s.aiProviderName}>{config.provider}</span>
          <span style={{
            ...s.aiEnabledBadge,
            background: config.enabled ? '#f6ffed' : '#f5f5f5',
            color: config.enabled ? '#389e0d' : '#999',
            borderColor: config.enabled ? '#b7eb8f' : '#e8e8e8',
          }}>
            {config.enabled ? '开启' : '关闭'}
          </span>
          <span style={s.aiScopeBadge}>{scopeLabel}</span>
          <span style={{ ...s.aiSafetyBadge, color: safety.color, background: safety.bg, borderColor: safety.border }}>
            {safety.label}
          </span>
        </div>
      </div>

      <div style={s.aiStoreLine}>绑定门店：{storeLabel}</div>

      <details style={s.aiDetails}>
        <summary style={s.aiDetailsSummary}>查看技术详情</summary>
        <InfoGrid rows={[
          ['apiBaseUrl', config.apiBaseUrlMasked ?? '—'],
          ['timeoutMs', String(config.timeoutMs)],
          ['创建时间', new Date(config.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })],
          ['更新时间', new Date(config.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })],
          ['configId', `${config.id.slice(0, 8)}…`],
        ]} />
      </details>
    </div>
  )
}

// ─── AiPhotoPanel — AI 拍照识别用量只读摘要 ───────────────────────────────────

function AiPhotoPanel({ tenantId, aiPhoto, onChanged }: { tenantId: string; aiPhoto: AiPhotoOpsView; onChanged: () => void }) {
  const tierMeta = TIER_META[aiPhoto.tier] ?? TIER_META.LITE

  if (aiPhoto.stores.length === 0) {
    return <div style={s.aiEmpty}>暂无 ACTIVE 门店，无法统计 AI 拍照识别用量。</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={s.aiSummaryGrid}>
        <div style={s.aiSummaryBox}>
          <div style={s.aiSummaryLabel}>当前套餐</div>
          <div style={s.aiSummaryValue}>{tierMeta.label}</div>
          <div style={s.aiSummaryHint}>{aiPhoto.tier}</div>
        </div>
        <div style={s.aiSummaryBox}>
          <div style={s.aiSummaryLabel}>统计来源</div>
          <div style={s.aiSummaryValue}>OperationLog</div>
          <div style={s.aiSummaryHint}>actionType = AI_PHOTO_RECOGNIZE</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {aiPhoto.stores.map((store) => (
          <AiPhotoStoreCard key={store.storeId} tenantId={tenantId} store={store} onChanged={onChanged} />
        ))}
      </div>
    </div>
  )
}

function getAiPhotoStatusTone(statusLabel: string): { color: string; bg: string; border: string } {
  if (statusLabel === '今日已超限') return { color: '#ff4d4f', bg: '#fff1f0', border: '#ffa39e' }
  if (statusLabel === '最近失败') return { color: '#fa8c16', bg: '#fff7e6', border: '#ffd591' }
  if (statusLabel === '今日未使用') return { color: '#999', bg: '#f5f5f5', border: '#e8e8e8' }
  return { color: '#389e0d', bg: '#f6ffed', border: '#b7eb8f' }
}

function getAiPhotoLimitSourceLabel(source: string): string {
  if (source === 'OPS_OVERRIDE') return 'OPS 单店配置'
  if (source === 'ENV_TRIAL' || source === 'TRIAL_STORE_ENV') return '试点门店 env 覆盖'
  if (source === 'TIER_DEFAULT') return '套餐默认'
  return '未知'
}

function formatOpsTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

function AiPhotoStoreCard({ tenantId, store, onChanged }: { tenantId: string; store: AiPhotoStoreUsage; onChanged: () => void }) {
  const tone = getAiPhotoStatusTone(store.statusLabel)
  const latest = store.latest
  const [enabled, setEnabled] = useState(store.config?.enabled ?? true)
  const [dailyLimitOverride, setDailyLimitOverride] = useState(
    store.config?.dailyLimitOverride == null ? '' : String(store.config.dailyLimitOverride),
  )
  const [trialUntil, setTrialUntil] = useState(toDateInputValue(store.config?.trialUntil ?? null))
  const [opsNote, setOpsNote] = useState(store.config?.opsNote ?? '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setEnabled(store.config?.enabled ?? true)
    setDailyLimitOverride(store.config?.dailyLimitOverride == null ? '' : String(store.config.dailyLimitOverride))
    setTrialUntil(toDateInputValue(store.config?.trialUntil ?? null))
    setOpsNote(store.config?.opsNote ?? '')
    setMsg(null)
  }, [store.config?.enabled, store.config?.dailyLimitOverride, store.config?.trialUntil, store.config?.opsNote])

  async function saveConfig() {
    setSaving(true)
    setMsg(null)
    try {
      const r = await apiFetch(
        `/api/ops/tenants/${encodeURIComponent(tenantId)}/stores/${encodeURIComponent(store.storeId)}/ai-photo-config`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            enabled,
            dailyLimitOverride: dailyLimitOverride.trim() === '' ? null : dailyLimitOverride.trim(),
            trialUntil: trialUntil || null,
            opsNote,
          }),
        },
        OWNER_CTX,
      )
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        setMsg(body.message ?? body.error ?? '保存失败')
        return
      }
      setMsg('已保存')
      onChanged()
    } catch {
      setMsg('网络错误')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={s.aiConfigCard}>
      <div style={s.aiConfigTop}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={s.aiProviderName}>{store.storeName}</span>
          <span style={s.aiScopeBadge}>{store.storeCode}</span>
          <span style={{ ...s.aiSafetyBadge, color: tone.color, background: tone.bg, borderColor: tone.border }}>
            {store.statusLabel}
          </span>
        </div>
      </div>

      <div style={s.aiSummaryGrid}>
        <div style={s.aiSummaryBox}>
          <div style={s.aiSummaryLabel}>今日用量</div>
          <div style={s.aiSummaryValue}>{store.usedToday} / {store.dailyLimit} 次</div>
          <div style={s.aiSummaryHint}>{getAiPhotoLimitSourceLabel(store.limitSource)}</div>
        </div>
        <div style={s.aiSummaryBox}>
          <div style={s.aiSummaryLabel}>近 7 天</div>
          <div style={s.aiSummaryValue}>{store.last7Days.totalCalls} 次</div>
          <div style={s.aiSummaryHint}>
            成功 {store.last7Days.successCalls} · 失败 {store.last7Days.failedCalls} · 超限 {store.last7Days.limitReachedCalls}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={s.aiGroupTitle}>最近一次识别</div>
        {latest ? (
          <InfoGrid rows={[
            ['时间', formatOpsTime(latest.createdAt)],
            ['状态', latest.status],
            ['errorCode', latest.errorCode ?? '—'],
            ['candidateCount', latest.candidateCount == null ? '—' : String(latest.candidateCount)],
            ['latencyMs', latest.latencyMs == null ? '—' : String(latest.latencyMs)],
          ]} />
        ) : (
          <div style={s.aiEmpty}>暂无识别记录。</div>
        )}
      </div>

      <div style={s.aiPhotoConfigBox}>
        <div style={s.aiGroupTitle}>OPS 单店配置</div>
        <label style={s.aiPhotoFormRow}>
          <span style={s.aiPhotoFormLabel}>启用</span>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>
        <label style={s.aiPhotoFormRow}>
          <span style={s.aiPhotoFormLabel}>每日额度 override</span>
          <input
            style={s.aiPhotoInput}
            type="number"
            min={1}
            max={10000}
            placeholder="清空则回退"
            value={dailyLimitOverride}
            onChange={(e) => setDailyLimitOverride(e.target.value)}
          />
        </label>
        <label style={s.aiPhotoFormRow}>
          <span style={s.aiPhotoFormLabel}>试用到期</span>
          <input
            style={s.aiPhotoInput}
            type="date"
            value={trialUntil}
            onChange={(e) => setTrialUntil(e.target.value)}
          />
        </label>
        <label style={{ ...s.aiPhotoFormRow, alignItems: 'flex-start' }}>
          <span style={s.aiPhotoFormLabel}>OPS 备注</span>
          <textarea
            style={{ ...s.aiPhotoInput, minHeight: 54, resize: 'vertical' }}
            value={opsNote}
            maxLength={500}
            placeholder="可留空"
            onChange={(e) => setOpsNote(e.target.value)}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          {msg && <span style={{ fontSize: 12, color: msg === '已保存' ? '#52c41a' : '#ff4d4f' }}>{msg}</span>}
          <button
            type="button"
            style={{ ...s.actionBtn, height: 30, opacity: saving ? 0.6 : 1 }}
            disabled={saving}
            onClick={saveConfig}
          >
            {saving ? '保存中…' : '保存配置'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── LifecyclePanel ───────────────────────────────────────────────────────────

function LifecyclePanel({ tenantId, currentStatus, onChanged }: { tenantId: string; currentStatus: string; onChanged: () => void }) {
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const isActive = currentStatus === 'ACTIVE'

  async function toggleStatus() {
    const next = isActive ? 'ARCHIVED' : 'ACTIVE'
    const msg = isActive ? `确认归档/停用该商户？停用后商户前台将立即无法使用（现有 session 被拒绝）。` : `确认恢复该商户为运营状态？`
    if (!confirm(msg)) return
    setSaving(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }, OWNER_CTX)
      if (r.ok) onChanged()
      else setErr('操作失败')
    } catch {
      setErr('网络错误')
    } finally {
      setSaving(false)
    }
  }

  async function downloadBackup() {
    setDownloading(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/export`, undefined, OWNER_CTX)
      if (!r.ok) { setErr('导出失败'); return }
      const blob = await r.blob()
      const cd = r.headers.get('content-disposition') ?? ''
      const match = cd.match(/filename="([^"]+)"/)
      const filename = match?.[1] ?? `tenant_${tenantId}_export.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setErr('网络错误')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          style={{
            ...s.actionBtn,
            background: isActive ? '#fff1f0' : '#f6ffed',
            color: isActive ? '#ff4d4f' : '#52c41a',
            borderColor: isActive ? '#ffa39e' : '#b7eb8f',
            opacity: saving ? 0.6 : 1,
          }}
          disabled={saving}
          onClick={toggleStatus}
        >
          {saving ? '…' : isActive ? '停用商户' : '恢复运营'}
        </button>
        <button
          style={{ ...s.actionBtn, opacity: downloading ? 0.6 : 1 }}
          disabled={downloading}
          onClick={downloadBackup}
        >
          {downloading ? '导出中…' : '下载数据备份'}
        </button>
      </div>
      {!isActive && (
        <div style={{ fontSize: 12, color: '#fa8c16', marginTop: 8, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '6px 10px' }}>
          ⚠️ 该商户已归档停用，前台所有 API 调用将被拒绝（401）。数据保留。如需永久删除请先导出备份，联系技术人员手动处理。
        </div>
      )}
      {err && <div style={s.errMsg}>{err}</div>}
    </div>
  )
}

// ─── BizDataPanel ────────────────────────────────────────────────────────────

function BizDataPanel({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<BizData | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [days, setDays] = useState(7)

  async function load(d = days) {
    setLoading(true)
    setErr(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/bizview?days=${d}`, undefined, OWNER_CTX)
      if (r.ok) setData(await r.json())
      else setErr('加载失败')
    } catch {
      setErr('网络错误')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [tenantId])

  function switchDays(d: number) {
    setDays(d)
    load(d)
  }

  if (loading && !data) return <div style={{ color: '#bbb', fontSize: 13, padding: '12px 0' }}>加载中…</div>
  if (err && !data) return <div style={{ color: '#ff4d4f', fontSize: 13 }}>{err}</div>
  if (!data) return null

  const ov = data.overview
  const fmtAmt = (n: number) => `¥${n.toFixed(2)}`
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div>
      {/* Day toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[7, 30].map((d) => (
          <button key={d} onClick={() => switchDays(d)} style={{
            height: 26, padding: '0 12px', fontSize: 12, borderRadius: 13, cursor: 'pointer',
            border: `1.5px solid ${days === d ? '#1677ff' : '#e8e8e8'}`,
            background: days === d ? '#e6f4ff' : '#fff',
            color: days === d ? '#1677ff' : '#888',
            fontWeight: days === d ? 700 : 400,
          }}>最近 {d} 天</button>
        ))}
        <span style={{ fontSize: 12, color: '#bbb', lineHeight: '26px', marginLeft: 4 }}>共 {data.productCount} 个在售商品</span>
      </div>

      {/* Overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginBottom: 8 }}>
        {[
          { label: '销售额', value: fmtAmt(ov.saleAmount), color: '#52c41a' },
          { label: '销售单数', value: String(ov.saleCount), color: '#1677ff' },
          { label: '退款额', value: fmtAmt(ov.refundAmount), color: ov.refundCount > 0 ? '#ff4d4f' : '#bbb' },
          { label: '退款次数', value: String(ov.refundCount), color: ov.refundCount > 0 ? '#ff4d4f' : '#bbb' },
          { label: '净收入', value: fmtAmt(ov.netAmount), color: '#722ed1' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Payment breakdown */}
      {((ov.cashSaleAmount ?? 0) > 0 || (ov.khqrSaleAmount ?? 0) > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
          {[
            { label: '💵 现金收款', value: fmtAmt(ov.cashSaleAmount ?? 0), color: '#389e0d' },
            { label: '📱 KHQR 扫码', value: fmtAmt(ov.khqrSaleAmount ?? 0), color: '#1677ff' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: '#888' }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top products */}
      {data.topProducts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={s.bizSubTitle}>热销商品 Top {data.topProducts.length}</div>
          <table style={s.bizTable}>
            <thead><tr>{['商品', '规格', '数量', '销售额'].map(h => <th key={h} style={s.bizTh}>{h}</th>)}</tr></thead>
            <tbody>
              {data.topProducts.map((p, i) => (
                <tr key={i}>
                  <td style={s.bizTd}>{p.name}</td>
                  <td style={s.bizTd}>{p.spec ?? '—'}</td>
                  <td style={s.bizTd}>{p.qty}</td>
                  <td style={s.bizTd}>{fmtAmt(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Staff stats */}
      {data.staffStats.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={s.bizSubTitle}>员工销售表现</div>
          <table style={s.bizTable}>
            <thead><tr>{['员工', '销售单数', '销售额'].map(h => <th key={h} style={s.bizTh}>{h}</th>)}</tr></thead>
            <tbody>
              {data.staffStats.map((st, i) => (
                <tr key={i}>
                  <td style={s.bizTd}>{st.displayName}</td>
                  <td style={s.bizTd}>{st.saleCount}</td>
                  <td style={s.bizTd}>{fmtAmt(st.saleAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent records */}
      <div>
        <div style={s.bizSubTitle}>最近记录（最新 {data.recentRecords.length} 条）</div>
        {data.recentRecords.length === 0 ? (
          <div style={{ fontSize: 13, color: '#bbb', padding: '8px 0' }}>暂无记录</div>
        ) : (
          <table style={s.bizTable}>
            <thead><tr>{['时间', '类型', '商品', '数量', '金额', '店员'].map(h => <th key={h} style={s.bizTh}>{h}</th>)}</tr></thead>
            <tbody>
              {data.recentRecords.map((r) => (
                <tr key={r.id}>
                  <td style={s.bizTd}>{fmtTime(r.createdAt)}</td>
                  <td style={{ ...s.bizTd, color: r.saleType === 'SALE' ? '#52c41a' : '#ff4d4f', fontWeight: 600 }}>
                    {r.saleType === 'SALE' ? '销售' : '退款'}
                  </td>
                  <td style={s.bizTd}>{r.productName}{r.spec ? ` · ${r.spec}` : ''}</td>
                  <td style={s.bizTd}>{r.qty}</td>
                  <td style={s.bizTd}>{fmtAmt(Math.abs(r.lineAmount))}</td>
                  <td style={s.bizTd}>{r.operator}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ─── GenCodePanel ─────────────────────────────────────────────────────────────

function GenCodePanel({ tenantId, stores }: { tenantId: string; stores: Store[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? '')
  const [role, setRole] = useState<'OWNER' | 'STAFF'>('OWNER')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<GenResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)

  async function generate() {
    if (!storeId) { setErr('请选择门店'); return }
    setGenerating(true)
    setErr(null)
    setResult(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/tokens`, {
        method: 'POST',
        body: JSON.stringify({ storeId, role, expiresInHours: 24 }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) setResult(body)
      else setErr(body.error ?? '生成失败')
    } catch {
      setErr('网络错误')
    } finally {
      setGenerating(false)
    }
  }

  function copyLink() {
    if (!result?.tgLink) return
    navigator.clipboard.writeText(result.tgLink).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function downloadQR() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const size = 240
    const xml = new XMLSerializer().serializeToString(svg)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size, size)
      ctx.drawImage(img, 0, 0, size, size)
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      const roleLabel = result?.role === 'OWNER' ? 'owner' : 'staff'
      a.download = `bind_qr_${roleLabel}.png`
      a.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
  }

  return (
    <div>
      <div style={s.genRow}>
        <select style={s.select} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
        </select>
        <button
          style={{ ...s.roleBtn, ...(role === 'OWNER' ? s.roleBtnActive : {}) }}
          onClick={() => setRole('OWNER')}
        >老板码</button>
        <button
          style={{ ...s.roleBtn, ...(role === 'STAFF' ? s.roleBtnActive : {}) }}
          onClick={() => setRole('STAFF')}
        >员工码</button>
        <button style={{ ...s.genBtn, opacity: generating ? 0.7 : 1 }} disabled={generating} onClick={generate}>
          {generating ? '生成中…' : '生成'}
        </button>
      </div>
      {err && <div style={s.errMsg}>{err}</div>}
      {result && (
        <div style={s.genResult}>
          <div style={s.genMeta}>
            <span style={s.genTag}>{result.role === 'OWNER' ? '老板' : '员工'} · {result.storeName}</span>
            <span style={s.genExp}>过期：{new Date(result.expiresAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          {result.tgLink && (
            <div ref={qrRef} style={s.qrWrap}>
              <QRCode value={result.tgLink} size={160} />
            </div>
          )}
          {result.tgLink && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button style={s.qrActionBtn} onClick={copyLink}>
                {copied ? '已复制 ✓' : '复制链接'}
              </button>
              <button style={s.qrActionBtn} onClick={downloadQR}>
                下载二维码
              </button>
            </div>
          )}
          {result.tgLink && (
            <div style={s.tgLinkBox}>
              <a href={result.tgLink} target="_blank" rel="noreferrer" style={s.tgLink}>{result.tgLink}</a>
            </div>
          )}
          <div style={s.tokenBox}>Token: <code>{result.token}</code></div>
        </div>
      )}
    </div>
  )
}

// ─── MemberList ───────────────────────────────────────────────────────────────

function MemberList({ tenantId, members, onUnbound }: { tenantId: string; members: Member[]; onUnbound: () => void }) {
  const [unbinding, setUnbinding] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // composing: { memberId, telegramId } | null
  const [composing, setComposing] = useState<{ memberId: string; telegramId: string } | null>(null)
  const [composeText, setComposeText] = useState('')
  const [sending, setSending] = useState(false)

  async function unbind(userId: string, displayName: string) {
    if (!confirm(`确认解绑「${displayName}」的 Telegram 账号？`)) return
    setUnbinding(userId)
    setMsg(null)
    try {
      const r = await apiFetch(`/api/ops/tenants/${tenantId}/members/${userId}/unbind`, { method: 'POST' }, OWNER_CTX)
      const body = await r.json()
      if (r.ok) { setMsg(`已解绑：${body.displayName}`); onUnbound() }
      else setMsg(body.error ?? '解绑失败')
    } catch {
      setMsg('网络错误')
    } finally {
      setUnbinding(null)
    }
  }

  function openCompose(memberId: string, telegramId: string) {
    setComposing({ memberId, telegramId })
    setComposeText('')
    setMsg(null)
  }

  async function sendMessage() {
    if (!composing || !composeText.trim()) return
    setSending(true)
    setMsg(null)
    try {
      const r = await apiFetch('/api/ops/messages', {
        method: 'POST',
        body: JSON.stringify({ recipientTelegramId: composing.telegramId, text: composeText.trim(), tenantId }),
      }, OWNER_CTX)
      const body = await r.json()
      if (r.ok && body.ok) {
        setMsg('✓ 消息已发送')
        setComposing(null)
        setComposeText('')
      } else {
        setMsg(body.message ?? body.error ?? '发送失败')
      }
    } catch {
      setMsg('网络错误，请重试')
    } finally {
      setSending(false)
    }
  }

  if (members.length === 0) return <div style={s.emptyHint}>暂无成员</div>

  return (
    <div>
      {msg && <div style={s.infoMsg}>{msg}</div>}
      <div style={s.memberList}>
        {members.map((m) => (
          <div key={m.id}>
            <div style={s.memberRow}>
              <div style={s.memberLeft}>
                <span style={{ ...s.roleBadge, background: m.role === 'OWNER' ? '#fff7e6' : '#f6f6f6', color: m.role === 'OWNER' ? '#fa8c16' : '#666' }}>
                  {m.role === 'OWNER' ? '老板' : '员工'}
                </span>
                <div>
                  <div style={s.memberName}>{m.displayName || m.username}</div>
                  <div style={s.memberSub}>
                    {m.username}
                    {m.staffNumber != null && <span style={s.staffNumBadge}>#{m.staffNumber}</span>}
                    {' · '}{m.storeName}
                  </div>
                </div>
              </div>
              <div style={s.memberRight}>
                <span style={{ ...s.boundBadge, color: m.bound ? '#52c41a' : '#bbb' }}>
                  {m.bound ? '已绑定' : '未绑定'}
                </span>
                {m.bound && m.telegramId && (
                  <button
                    style={s.msgBtn}
                    onClick={() => composing?.memberId === m.id ? setComposing(null) : openCompose(m.id, m.telegramId!)}
                  >
                    {composing?.memberId === m.id ? '取消' : '发消息'}
                  </button>
                )}
                {m.bound && (
                  <button
                    style={{ ...s.unbindBtn, opacity: unbinding === m.id ? 0.6 : 1 }}
                    disabled={unbinding === m.id}
                    onClick={() => unbind(m.id, m.displayName || m.username)}
                  >
                    {unbinding === m.id ? '…' : '解绑'}
                  </button>
                )}
              </div>
            </div>
            {composing?.memberId === m.id && (
              <div style={s.composeBox}>
                <textarea
                  style={s.composeArea}
                  rows={3}
                  placeholder="输入消息内容…"
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                />
                <button
                  style={{ ...s.composeSendBtn, opacity: sending || !composeText.trim() ? 0.6 : 1 }}
                  disabled={sending || !composeText.trim()}
                  onClick={sendMessage}
                >
                  {sending ? '发送中…' : '发送'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f0f2f5', paddingBottom: 40 },
  header: {
    background: '#1a1a2e', padding: '18px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 700 },
  headerSub: { color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2, fontFamily: 'monospace' },
  backLink: { color: 'rgba(255,255,255,0.7)', fontSize: 13, textDecoration: 'none' },
  body: { maxWidth: 680, margin: '0 auto', padding: '14px 12px' },

  section: {
    background: '#fff', borderRadius: 12, padding: '14px 16px',
    marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
  },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#888', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.04em' },

  infoGrid: { display: 'flex', flexDirection: 'column', gap: 8 },
  infoRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { fontSize: 13, color: '#888' },
  infoValue: { fontSize: 13, fontWeight: 600, color: '#333' },

  statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 },
  statBox: { background: '#f8f8f8', borderRadius: 8, padding: '10px 8px', textAlign: 'center' },
  statBoxValue: { fontSize: 16, fontWeight: 700 },
  statBoxLabel: { fontSize: 11, color: '#aaa', marginTop: 4 },

  genRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 },
  select: {
    flex: 1, minWidth: 120, height: 34, border: '1.5px solid #e8e8e8',
    borderRadius: 6, padding: '0 8px', fontSize: 13, background: '#fff',
  },
  roleBtn: {
    height: 34, padding: '0 14px', border: '1.5px solid #e8e8e8',
    borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#f5f5f5', color: '#666',
  },
  roleBtnActive: { background: '#1677ff', color: '#fff', borderColor: '#1677ff' },
  genBtn: {
    height: 34, padding: '0 18px', background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  genResult: {
    background: '#f8faff', borderRadius: 10, padding: '14px',
    border: '1px solid #d6e4ff', marginTop: 4,
  },
  genMeta: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  genTag: { fontSize: 13, fontWeight: 700, color: '#1677ff' },
  genExp: { fontSize: 12, color: '#888' },
  qrWrap: { display: 'flex', justifyContent: 'center', marginBottom: 12, padding: '12px', background: '#fff', borderRadius: 8 },
  tgLinkBox: { marginBottom: 8 },
  tgLink: { fontSize: 11, color: '#1677ff', wordBreak: 'break-all' },
  tokenBox: { fontSize: 11, color: '#888', fontFamily: 'monospace' },

  memberList: { display: 'flex', flexDirection: 'column', gap: 1 },
  memberRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 4px', borderBottom: '1px solid #f5f5f5',
  },
  memberLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  roleBadge: { fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10, border: '1px solid #f0f0f0' },
  memberName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  memberSub: { fontSize: 11, color: '#bbb', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 },
  staffNumBadge: { fontSize: 10, fontWeight: 700, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff', borderRadius: 4, padding: '0 4px' },
  memberRight: { display: 'flex', alignItems: 'center', gap: 8 },
  boundBadge: { fontSize: 12, fontWeight: 600 },
  msgBtn: {
    height: 26, padding: '0 10px', background: '#e6f4ff', border: '1px solid #91caff',
    borderRadius: 4, fontSize: 11, fontWeight: 600, color: '#1677ff', cursor: 'pointer',
  },
  composeBox: {
    margin: '0 0 8px 0', padding: '10px 12px', background: '#f5f7fa',
    borderRadius: 8, border: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column' as const, gap: 8,
  },
  composeArea: {
    width: '100%', fontSize: 14, border: '1px solid #d9d9d9', borderRadius: 6,
    padding: '8px 10px', resize: 'none' as const, outline: 'none', boxSizing: 'border-box' as const,
  },
  composeSendBtn: {
    alignSelf: 'flex-end' as const, height: 32, padding: '0 18px', background: '#1677ff',
    color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  unbindBtn: {
    height: 28, padding: '0 12px', background: '#fff1f0', color: '#ff4d4f',
    border: '1px solid #ffa39e', borderRadius: 6, fontSize: 12, cursor: 'pointer',
  },

  tierBadge: {
    fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 10,
    border: '1px solid', flexShrink: 0,
  },
  tierRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  tierBtn: {
    height: 32, padding: '0 14px', border: '1.5px solid #e8e8e8',
    borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: '#f5f5f5', color: '#888',
  },
  adjustBtn: {
    height: 32, padding: '0 16px', border: '1.5px solid #d9d9d9',
    borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: '#fafafa', color: '#555',
  },
  tierPicker: {
    marginTop: 4, padding: '12px 14px', background: '#fafafa',
    border: '1.5px solid #e8e8e8', borderRadius: 10,
  },
  cancelBtn: {
    marginTop: 10, height: 28, padding: '0 14px', border: '1px solid #e8e8e8',
    borderRadius: 6, fontSize: 12, cursor: 'pointer', background: '#fff', color: '#888',
  },
  errMsg: { fontSize: 13, color: '#ff4d4f', marginBottom: 8 },
  infoMsg: { fontSize: 13, color: '#52c41a', marginBottom: 8, padding: '8px 12px', background: '#f6ffed', borderRadius: 6, border: '1px solid #b7eb8f' },
  aiSummaryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  aiSummaryBox: { background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 12px' },
  aiSummaryLabel: { fontSize: 11, color: '#999', marginBottom: 4 },
  aiSummaryValue: { fontSize: 15, fontWeight: 700, color: '#333' },
  aiSummaryHint: { fontSize: 11, color: '#aaa', marginTop: 4, lineHeight: 1.4 },
  aiStatusBox: { border: '1px solid', borderRadius: 8, padding: '9px 12px' },
  aiNotes: { background: '#f8faff', border: '1px solid #d6e4ff', borderRadius: 8, padding: '8px 10px' },
  aiNoteItem: { fontSize: 12, color: '#555', lineHeight: 1.55 },
  aiEmpty: { fontSize: 12, color: '#999', background: '#fafafa', border: '1px dashed #d9d9d9', borderRadius: 8, padding: '12px' },
  aiGroupTitle: { fontSize: 11, fontWeight: 800, color: '#999', marginBottom: 6 },
  aiConfigCard: { background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 10, padding: '10px 12px' },
  aiConfigTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 },
  aiProviderName: { fontSize: 13, fontWeight: 800, color: '#1a1a1a', fontFamily: 'monospace' },
  aiEnabledBadge: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, border: '1px solid' },
  aiScopeBadge: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, border: '1px solid #d6e4ff', color: '#1677ff', background: '#f8faff' },
  aiSafetyBadge: { fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 10, border: '1px solid' },
  aiStoreLine: { fontSize: 12, color: '#666', lineHeight: 1.45, marginBottom: 7 },
  aiDetails: { borderTop: '1px solid #f0f0f0', paddingTop: 7 },
  aiDetailsSummary: { fontSize: 12, color: '#1677ff', fontWeight: 700, cursor: 'pointer', marginBottom: 7 },
  aiPhotoConfigBox: { marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 8 },
  aiPhotoFormRow: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' },
  aiPhotoFormLabel: { fontSize: 12, color: '#666', fontWeight: 700 },
  aiPhotoInput: {
    width: '100%', boxSizing: 'border-box' as const,
    border: '1px solid #d9d9d9', borderRadius: 6,
    padding: '6px 8px', fontSize: 13, background: '#fff',
  },
  actionBtn: {
    height: 34, padding: '0 16px', border: '1.5px solid #e8e8e8',
    borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: '#f5f5f5', color: '#666',
  },
  qrActionBtn: {
    flex: 1, height: 32, border: '1.5px solid #d6e4ff', borderRadius: 6,
    fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#f0f7ff', color: '#1677ff',
  },
  emptyHint: { fontSize: 13, color: '#bbb', textAlign: 'center', padding: '16px 0' },
  bizSubTitle: { fontSize: 12, fontWeight: 700, color: '#8c8c8c', textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 6 },
  bizTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  bizTh: { textAlign: 'left' as const, padding: '4px 8px', color: '#aaa', fontWeight: 600, borderBottom: '1px solid #f0f0f0' },
  bizTd: { padding: '5px 8px', borderBottom: '1px solid #f5f5f5', color: '#333', verticalAlign: 'top' as const },
  center: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 12, background: '#f0f2f5',
  },
  spinner: {
    width: 32, height: 32, borderRadius: '50%', border: '3px solid #e8e8e8',
    borderTopColor: '#1677ff', animation: 'spin 0.8s linear infinite',
  },
}

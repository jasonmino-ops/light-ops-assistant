'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { request, type Access } from './client'
import type { SalesControlIntent, SalesControlResult, SalesControlState } from '@/lib/native-inventory/sales-control'

const reasons: Record<string, string> = {
  FIELD_CONFIRMATION_REQUIRED: '请确认三项现场条件后再开启。',
  UNSETTLED_OPERATIONS: '门店仍有未结订单、待付款或待同步记录，请先处理。',
  PILOT_NOT_READY: '试点库存或旧 Feed 退役条件尚未满足，请联系管理员。',
  CONTROL_STATE_CHANGED: '状态已被其他操作更新，请核对最新状态。',
  REQUEST_NOT_APPLIED: '原请求未执行，已阻止其迟到执行。',
}
const emptyChecks = { terminalsRefreshed: false, offlineQueueEmpty: false, noCheckout: false }
export function SalesControl({ access }: { access: Access }) {
  const [state, setState] = useState<SalesControlState>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<SalesControlIntent | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [checks, setChecks] = useState(emptyChecks)
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const inFlight = useRef(false)
  const readSequence = useRef(0)
  const key = `native-inventory:sales-control:v1:${access.storeId}:${access.userId}`
  const refresh = useCallback(async () => {
    const sequence = ++readSequence.current
    setLoading(true)
    try {
      const next = await request<SalesControlState>('sales-control')
      if (mounted.current && sequence === readSequence.current) setState(next)
      return next
    } catch { if (mounted.current && sequence === readSequence.current) { setState(undefined); setNotice('暂时无法确认服务端状态，请重新查询。') } }
    finally { if (mounted.current && sequence === readSequence.current) setLoading(false) }
  }, [])
  useEffect(() => {
    mounted.current = true
    setPending(null)
    setConfirming(false)
    setChecks(emptyChecks)
    void refresh()
    try {
      const saved = localStorage.getItem(key)
      if (saved) { setPending(JSON.parse(saved)); setNotice('有结果未确认的原请求，请先查询，不要重复操作。') }
    } catch { setNotice('无法读取上次请求记录，请重新查询状态。') }
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { mounted.current = false; ++readSequence.current; window.removeEventListener('focus', focus) }
  }, [key, refresh])

  async function submit(intent: SalesControlIntent, resolve: boolean) {
    if (inFlight.current) return
    try { localStorage.setItem(key, JSON.stringify(intent)) }
    catch { setNotice('无法安全保存原请求，尚未提交。请检查浏览器存储权限。'); return }
    inFlight.current = true
    ++readSequence.current
    setBusy(true)
    setNotice('')
    try {
      setPending(intent)
      const result = await request<SalesControlResult>('sales-control', { ...intent, resolve })
      localStorage.removeItem(key)
      if (!mounted.current) return
      setPending(null)
      setConfirming(false)
      setChecks(emptyChecks)
      setNotice(result.outcome === 'APPLIED' ? '原请求已确认完成，下方显示重新查询的当前状态。' : reasons[result.error ?? ''] ?? '原请求未执行，请核对当前状态。')
      await refresh()
    } catch {
      if (!mounted.current) return
      setNotice('结果尚未确认。请查询原请求，勿重复开启或关闭。')
      await refresh()
    } finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }

  function change() {
    if (!state || pending || loading || busy || !state.canControl) return
    if (!state.enabled && !confirming) { setConfirming(true); return }
    if (!state.enabled && !Object.values(checks).every(Boolean)) return
    void submit({ id: crypto.randomUUID(), enabled: !state.enabled,
      expectedVersion: state.version, expectedEpoch: state.epoch, confirmations: checks }, false)
  }
  if (state && !state.available) return null
  return <section className="banner" aria-label="销售自动扣减" style={{ margin: '8px 16px', border: '1px solid var(--line, #ddd)', borderRadius: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <strong>销售自动扣减</strong>
      <span role="status">{loading ? '正在核对…' : state ? state.enabled ? '已开启' : '已关闭' : '状态未知'}</span>
    </div>
    <p style={{ fontSize: 13 }}>开启后 POS/H5 新销售自动扣库存。关闭仅停止新销售扣减；已扣库存的 POS 退款及相关撤销仍按原流水处理。H5 退款不自动回补。</p>
    <p style={{ fontSize: 13 }}>离线迟到订单不自动扣减，需按现有规则核对；重新开启不追溯关闭期间销售。</p>
    {state && !state.ready && <p>试点启用条件尚未满足，暂不能开启。</p>}
    {confirming && <fieldset disabled={busy || !!pending}>
      <legend>请在门店现场确认</legend>
      {([
        ['terminalsRefreshed', '所有收银终端已刷新至新版'],
        ['offlineQueueEmpty', '每台终端本地离线待同步均为 0'],
        ['noCheckout', '当前无人正在结账或等待提交订单'],
      ] as const).map(([field, text]) => <label key={field} style={{ display: 'block', padding: '8px 0' }}>
        <input type="checkbox" checked={checks[field]} onChange={e => setChecks({ ...checks, [field]: e.target.checked })} /> {text}
      </label>)}
      <p>系统只检查已上传记录，不能代替对每台终端本地队列的现场确认。</p>
    </fieldset>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {state?.canControl && !pending && <button className="btn" type="button" onClick={change}
        disabled={loading || busy || (!state.enabled && (!state.ready || (confirming && !Object.values(checks).every(Boolean))))}>
        {busy ? '处理中…' : state.enabled ? '关闭新销售扣减' : confirming ? '确认开启' : '开启自动扣减'}
      </button>}
      {!state?.canControl && state && <span>仅老板可更改，员工仅查看状态。</span>}
      {pending ? <button className="btn" type="button" disabled={busy} onClick={() => void submit(pending, true)}>查询原请求结果</button>
        : <button className="btn" type="button" disabled={busy || loading} onClick={() => void refresh()}>刷新真实状态</button>}
      {confirming && !pending && <button className="btn" type="button" disabled={busy} onClick={() => { setConfirming(false); setChecks(emptyChecks) }}>取消</button>}
    </div>
    {notice && <p role="status">{notice}</p>}
  </section>
}

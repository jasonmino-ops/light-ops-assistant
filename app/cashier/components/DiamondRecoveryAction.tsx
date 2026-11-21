'use client'
import { useEffect, useRef, useState } from 'react'
import { canonicalCart, DIAMOND_RECOVERY } from '@/lib/diamond-recovery/case'
import { posDeviceHeaders } from '@/lib/desktop-pos-client'

type Status = { state: string; orderNo?: string; receiverName?: string; accepted?: boolean }
type Hold = { id: string; storeCode: string; cart: unknown[]; createdAt: string }
const ENDPOINT = '/api/cashier/recovery/diamond-13543'
const ATTEMPT_KEY = 'cashier:diamondRecovery:attempt:v1'
const BACKUP_KEY = 'cashier:diamondRecovery:originalBackup:v1'
const buttonStyle = { minHeight: 44, padding: '8px 12px', border: '1px solid var(--blue)', borderRadius: 8, background: 'var(--blue)', color: '#fff', fontSize: 14, lineHeight: 1.4, cursor: 'pointer' } as const
const copy = {
  zh: { checking: '正在核验原单和备份', idle: '请先完成或挂起当前购物车，并在本机桌面收银台操作', unsupported: '浏览器或本地存储未就绪，请联系技术人员', failure: '未完整出纸或异常，停止', receiver: '我作为指定接收人确认：', action: '恢复入账并打印', paper: '确认已完整出纸一份', check: '查询恢复结果', ready: '11月20日现金已收，无需再收款', blocked: '等待技术准入，原挂单已保留', unknown: '结果待核实，请停止操作并联系技术人员', processing: '正在核验恢复结果，请勿重复操作', waiting: '已入账，等待前台出纸，请勿再次提交', confirm: '请核对前台完整小票后确认', done: '已确认实体出纸，原挂单已锁定', alias: '原单证据已保留，请选择原135.43美元挂单', changed: '原单校验未通过，请联系技术人员' },
  en: { checking: 'Verifying original hold and backup', idle: 'Finish or hold the current basket and use this Desktop POS.', unsupported: 'Browser or local storage unavailable. Contact support.', failure: 'Paper missing or incorrect: stop', receiver: 'As the designated receiver, I confirm:', action: 'Recover entry and print', paper: 'Confirm one complete paper receipt', check: 'Check recovery result', ready: 'Cash received Nov 20. Do not collect again.', blocked: 'Awaiting technical admission. Original hold preserved.', unknown: 'Result uncertain. Stop and contact support.', processing: 'Checking recovery. Do not submit again.', waiting: 'Recorded. Waiting for front receipt. Do not resubmit.', confirm: 'Check the complete front receipt before confirming.', done: 'Paper confirmed. Original hold locked.', alias: 'Evidence preserved. Select the original $135.43 hold.', changed: 'Original hold verification failed. Contact support.' },
  km: { checking: 'កំពុងផ្ទៀងផ្ទាត់ការផ្អាកដើម', idle: 'បញ្ចប់ឬផ្អាកកន្ត្រកបច្ចុប្បន្ន ហើយប្រើម៉ាស៊ីន POS នេះ។', unsupported: 'កម្មវិធីរុករកឬទិន្នន័យមូលដ្ឋានមិនរួចរាល់។ ទាក់ទងបច្ចេកទេស។', failure: 'ក្រដាសមិនពេញលេញឬខុស៖ ឈប់', receiver: 'ខ្ញុំជាអ្នកទទួលដែលបានកំណត់ សូមបញ្ជាក់៖', action: 'ស្ដារការកត់ត្រា និងបោះពុម្ព', paper: 'បញ្ជាក់ថាបានចេញវិក្កយបត្រពេញលេញមួយ', check: 'ពិនិត្យលទ្ធផលស្ដារ', ready: 'បានទទួលសាច់ប្រាក់ថ្ងៃទី២០ វិច្ឆិកា។ កុំប្រមូលម្ដងទៀត។', blocked: 'រង់ចាំការអនុញ្ញាតបច្ចេកទេស។ រក្សាទុកការផ្អាកដើម។', unknown: 'លទ្ធផលមិនច្បាស់។ សូមឈប់ និងទាក់ទងបច្ចេកទេស។', processing: 'កំពុងពិនិត្យ។ កុំដាក់ស្នើម្ដងទៀត។', waiting: 'បានកត់ត្រា។ រង់ចាំវិក្កយបត្រខាងមុខ។ កុំដាក់ស្នើម្ដងទៀត។', confirm: 'សូមពិនិត្យវិក្កយបត្រពេញលេញ មុនបញ្ជាក់។', done: 'បានបញ្ជាក់ក្រដាស។ បានចាក់សោការផ្អាកដើម។', alias: 'បានរក្សាភស្តុតាង។ ជ្រើសការផ្អាកដើម 135.43 ដុល្លារ។', changed: 'ការផ្ទៀងផ្ទាត់មិនបានជោគជ័យ។ ទាក់ទងបច្ចេកទេស។' },
}
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('')
}
export default function DiamondRecoveryAction({ order, lang, idle }: { order: Hold; lang: string; idle: boolean }) {
  const d = copy[lang === 'km' ? 'km' : lang === 'en' ? 'en' : 'zh']
  const [selected, setSelected] = useState(false)
  const [valid, setValid] = useState<boolean | null>(null)
  const [capable, setCapable] = useState(true)
  const pollDeadline = useRef(0)
  const [status, setStatus] = useState<Status>({ state: 'BLOCKED' })
  const busy = useRef(false)
  const attempted = useRef(false)
  const original = order.id === DIAMOND_RECOVERY.holdId || order.id === DIAMOND_RECOVERY.currentHoldId
  function timeout(ms: number) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), ms); return { signal: controller.signal, clear: () => clearTimeout(timer) } }
  async function readStatus() {
    const readTimeout = timeout(10000)
    try {
      const result = await fetch(ENDPOINT, { cache: 'no-store', headers: posDeviceHeaders(DIAMOND_RECOVERY.storeCode), signal: readTimeout.signal })
      if (!result.ok) throw Error('unproved')
      const next: Status = await result.json()
      // A local send with absent server acceptance remains uncertain: never offer retry.
      setStatus(attempted.current && next.state === 'READY' ? { state: 'UNKNOWN' } : next)
    } catch { setStatus({ state: 'UNKNOWN' }) }
    finally { readTimeout.clear() }
  }
  useEffect(() => {
    if (!selected || !original) return
    let active = true
    void (async () => {
      try {
        if (!globalThis.crypto?.subtle || typeof AbortController !== 'function') throw Error('capability')
        const ok = await digest(canonicalCart(order.cart)) === DIAMOND_RECOVERY.cartSha256
        if (!active) return
        setValid(ok)
        if (!ok) return
        attempted.current = localStorage.getItem(ATTEMPT_KEY) !== null
        const snapshot = JSON.stringify(order)
        const previous = localStorage.getItem(BACKUP_KEY)
        if (!previous) localStorage.setItem(BACKUP_KEY, JSON.stringify({ snapshot, sha256: await digest(snapshot) }))
        const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || '{}')
        if (await digest(backup.snapshot) !== backup.sha256 || await digest(canonicalCart(JSON.parse(backup.snapshot).cart)) !== DIAMOND_RECOVERY.cartSha256) throw Error('backup')
        if (active) await readStatus()
      } catch { if (active) { setCapable(false); setValid(false); setStatus({ state: 'UNKNOWN' }) } }
    })()
    return () => { active = false }
    // Selected hold is immutable; no cart/state mutation or ordinary restore handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, order.id])
  useEffect(() => {
    if (!selected || !['PROCESSING', 'COMMITTED_WAITING_PRINT'].includes(status.state)) return
    if (!pollDeadline.current) pollDeadline.current = Date.now() + 120000
    if (Date.now() >= pollDeadline.current) { setStatus(previous => ({ ...previous, state: 'UNKNOWN' })); return }
    const timer = setTimeout(() => { void readStatus() }, 2000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, status])
  async function submit(action: 'recover' | 'confirmPaper' | 'reportPaperFailure') {
    if (busy.current || !valid || (action !== 'reportPaperFailure' && !idle) || (action === 'reportPaperFailure' && !['COMMITTED_WAITING_PRINT', 'PAPER_CONFIRMABLE'].includes(status.state)) || (action === 'recover' && (status.state !== 'READY' || attempted.current)) || (action === 'confirmPaper' && status.state !== 'PAPER_CONFIRMABLE')) return
    // Construct the abort capability before persisting any attempt marker.
    const operationTimeout = timeout(85000)
    busy.current = true
    try {
      if (action === 'recover') {
        // Persist before sending. Reload/network loss can never re-enable the POST.
        localStorage.setItem(ATTEMPT_KEY, JSON.stringify({ at: new Date().toISOString(), cartSha256: DIAMOND_RECOVERY.cartSha256 }))
        attempted.current = true
      }
      pollDeadline.current = Date.now() + 120000
      setStatus({ state: 'PROCESSING' })
      const result = await fetch(ENDPOINT, { method: 'POST', headers: { ...posDeviceHeaders(DIAMOND_RECOVERY.storeCode), 'Content-Type': 'application/json' }, body: JSON.stringify({ action, holdId: order.id, cartSha256: DIAMOND_RECOVERY.cartSha256, ...(action === 'confirmPaper' ? { paperComplete: true, receiverAcknowledged: true, receiverName: status.receiverName } : {}) }), signal: operationTimeout.signal })
      const next: Status = await result.json()
      if (action === 'recover' && next.state === 'BLOCKED_NOT_ACCEPTED' && next.accepted === false) {
        // Only this proved pre-acceptance refusal permits re-arming the local
        // guard. It never deletes a server fence, UNKNOWN marker or original hold.
        localStorage.removeItem(ATTEMPT_KEY); attempted.current = false; setStatus({ state: 'BLOCKED' }); return
      }
      if (!result.ok) throw Error('unproved')
      setStatus(next)
    } catch { setStatus({ state: 'UNKNOWN' }) }
    finally { operationTimeout.clear(); busy.current = false }
  }
  const state = status.state
  const message = !capable ? d.unsupported : valid === null && selected ? d.checking : valid === false && selected ? d.changed : state === 'READY' && !idle ? d.idle : state === 'READY' ? d.ready : state === 'UNKNOWN' ? d.unknown : state === 'PROCESSING' ? d.processing : state === 'COMMITTED_WAITING_PRINT' ? d.waiting : state === 'PAPER_CONFIRMABLE' ? d.confirm : state === 'PAPER_CONFIRMED' ? d.done : d.blocked
  if (!original) return <span style={{ fontSize: 12 }}>{d.alias}</span>
  return <div style={{ display: 'grid', gap: 8, maxWidth: 240 }}>
    {!selected ? <button style={buttonStyle} type="button" onClick={() => setSelected(true)}>{lang === 'en' ? 'Select original hold' : lang === 'km' ? 'ជ្រើសការផ្អាកដើម' : '选择原挂单'}</button> : <>
      <span role="status" style={{ fontSize: 12 }}>{status.orderNo ? `${status.orderNo} · ` : ''}{message}</span>
      <button style={buttonStyle} type="button" disabled={!valid || !idle || state !== 'READY' || attempted.current} onClick={() => void submit('recover')}>{d.action}</button>
      {state === 'PAPER_CONFIRMABLE' && <span style={{ fontSize: 12 }}>{d.receiver} {status.receiverName}</span>}
      {state === 'PAPER_CONFIRMABLE' && <button style={buttonStyle} type="button" disabled={!idle} onClick={() => void submit('confirmPaper')}>{d.paper}</button>}
      {['COMMITTED_WAITING_PRINT', 'PAPER_CONFIRMABLE'].includes(state) && <button style={buttonStyle} type="button" onClick={() => void submit('reportPaperFailure')}>{d.failure}</button>}
      {['UNKNOWN', 'BLOCKED'].includes(state) && <button style={buttonStyle} type="button" disabled={!capable} onClick={() => void readStatus()}>{d.check}</button>}
    </>}
  </div>
}

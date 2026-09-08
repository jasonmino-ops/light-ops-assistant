'use client'

import { useEffect, useRef, useState } from 'react'
import { useWorkMode } from './WorkModeProvider'
import { useLocale } from './LangProvider'
import { electronicMenuPath } from '@/lib/electronic-menu'
import { publicUrl } from '@/lib/public-url'

const COPY = {
  zh: { title: '电子菜单屏', hint: '在普通浏览器大屏展示商品与价格', url: '本门店菜单屏 URL', help: '复制链接到门店电脑、平板或大屏浏览器打开。商品资料约每 30 秒自动更新。', copy: '复制链接', copied: '已复制', failed: '复制失败，请选择上方链接手动复制。', preview: '预览菜单屏', close: '关闭', waiting: '正在获取当前门店…' },
  en: { title: 'Electronic menu', hint: 'Show products and prices on any browser screen', url: 'This store’s menu screen URL', help: 'Open this link on a store computer, tablet or large-screen browser. Products refresh about every 30 seconds.', copy: 'Copy link', copied: 'Copied', failed: 'Copy failed. Select the link above and copy it manually.', preview: 'Preview menu', close: 'Close', waiting: 'Loading the current store…' },
  km: { title: 'អេក្រង់ម៉ឺនុយ', hint: 'បង្ហាញទំនិញ និងតម្លៃលើកម្មវិធីរុករក', url: 'តំណអេក្រង់ម៉ឺនុយរបស់ហាងនេះ', help: 'បើកតំណនេះលើកុំព្យូទ័រ ថេប្លេត ឬអេក្រង់ធំរបស់ហាង។ ទំនិញធ្វើបច្ចុប្បន្នភាពរៀងរាល់ប្រហែល ៣០ វិនាទី។', copy: 'ចម្លងតំណ', copied: 'បានចម្លង', failed: 'ចម្លងមិនបាន។ សូមជ្រើសតំណខាងលើ ហើយចម្លងដោយដៃ។', preview: 'មើលម៉ឺនុយ', close: 'បិទ', waiting: 'កំពុងទាញយកហាងបច្ចុប្បន្ន…' },
}

export default function ElectronicMenuEntry() {
  const { realRole, storeCode, storeName } = useWorkMode()
  const { lang } = useLocale()
  const text = COPY[lang]
  const [open, setOpen] = useState(false)
  const [origin, setOrigin] = useState<string>()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const copyAttempt = useRef(0)
  const path = electronicMenuPath(storeCode ?? '', lang)
  const url = path && origin ? publicUrl(path, origin) : ''

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    copyAttempt.current += 1
    setCopyState('idle')
  }, [url, open])
  useEffect(() => {
    const modal = dialog.current
    if (!modal) return
    if (open && realRole === 'OWNER') {
      if (!modal.open) modal.showModal()
    } else if (modal.open) modal.close()
  }, [open, realRole])

  async function copy() {
    if (!url) return
    const attempt = ++copyAttempt.current
    try {
      await navigator.clipboard.writeText(url)
      if (attempt === copyAttempt.current) setCopyState('copied')
    } catch {
      if (attempt !== copyAttempt.current) return
      setCopyState('failed')
      input.current?.focus()
      input.current?.select()
    }
  }

  if (realRole !== 'OWNER') return null

  return (
    <>
      <button type="button" data-testid="electronic-menu-entry" onClick={() => setOpen(true)} style={styles.entry}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4M6 7h12M6 11h5" /></svg>
        <span style={{ flex: 1, textAlign: 'left' }}><strong style={{ display: 'block', fontSize: 15 }}>{text.title}</strong><span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 4 }}>{text.hint}</span></span>
        <span aria-hidden="true">›</span>
      </button>
      <dialog ref={dialog} aria-labelledby="electronic-menu-title" onClose={() => setOpen(false)} onCancel={() => setOpen(false)} style={styles.dialog}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <h2 id="electronic-menu-title" style={{ margin: 0, fontSize: 22 }}>{text.title}</h2>
          <button type="button" aria-label={text.close} onClick={() => setOpen(false)} autoFocus style={styles.close}>×</button>
        </div>
        {storeName && <p style={{ margin: '12px 0', fontWeight: 600 }}>{storeName}</p>}
        <p style={{ fontSize: 14, lineHeight: 1.7, color: '#64748b' }}>{text.help}</p>
        <label htmlFor="electronic-menu-url" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{text.url}</label>
        <input id="electronic-menu-url" ref={input} readOnly value={url} placeholder={text.waiting} onFocus={(event) => event.currentTarget.select()} style={styles.input} />
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button type="button" disabled={!url} onClick={copy} style={{ ...styles.action, background: '#1e293b', color: '#fff', opacity: url ? 1 : 0.5 }}>{copyState === 'copied' ? text.copied : text.copy}</button>
          {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...styles.action, background: '#f1f5f9', color: '#1e293b' }}>{text.preview}</a>}
        </div>
        <p role="status" style={{ minHeight: 20, margin: '12px 0 0', fontSize: 13, color: '#64748b' }}>{copyState === 'failed' ? text.failed : copyState === 'copied' ? text.copied : ''}</p>
      </dialog>
      <style jsx>{`dialog::backdrop { background: rgba(15, 23, 42, .48); }`}</style>
    </>
  )
}

const styles: Record<string, React.CSSProperties> = {
  entry: { width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px', border: '1px solid #e2e8f0', borderRadius: 18, background: '#fff', color: '#334155', cursor: 'pointer', fontFamily: 'inherit' },
  dialog: { border: 0, borderRadius: 22, padding: 24, width: 'min(520px, calc(100vw - 32px))', margin: 'auto', color: '#1e293b', boxShadow: '0 24px 80px #0f172a33', fontFamily: 'inherit' },
  close: { border: 0, borderRadius: '50%', width: 34, height: 34, fontSize: 24, background: '#f1f5f9', color: '#475569', cursor: 'pointer' },
  input: { width: '100%', minWidth: 0, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 10, padding: 12, fontSize: 13, background: '#f8fafc', color: '#334155' },
  action: { display: 'inline-flex', justifyContent: 'center', alignItems: 'center', border: 0, borderRadius: 10, padding: '12px 18px', fontSize: 14, fontWeight: 600, textDecoration: 'none', fontFamily: 'inherit', cursor: 'pointer' },
}

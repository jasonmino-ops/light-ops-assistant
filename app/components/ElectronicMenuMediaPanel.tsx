'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { STORE_MEDIA_TYPES, storeMediaFileError } from '@/lib/store-media-policy'
import { useLocale } from './LangProvider'

const DEV_OWNER_CTX = process.env.NODE_ENV !== 'production' ? OWNER_CTX : undefined
const COPY = {
  zh: {
    title: '菜单屏专属图片 / GIF', hint: 'JPG、PNG、WebP 或 GIF，最大 2 MiB。仅用于电子菜单屏。',
    dedicated: '当前专属图片 / GIF', banner: '当前使用首页门头图', brand: '默认展示：商品图片或门店品牌',
    upload: '上传图片 / GIF', replace: '替换图片 / GIF', restore: '恢复首页门头图', retry: '重新加载',
    loading: '正在加载媒体…', uploading: '正在上传…', restoring: '正在恢复…', uploaded: '已更新菜单屏图片。', restored: '已恢复默认展示。',
    loadError: '媒体加载失败，请重试。', uploadError: '上传失败，请重试。', restoreError: '恢复或刷新失败，请重新加载确认。',
    invalidType: '请选择 JPG、PNG、WebP 或 GIF 文件。', tooLarge: '文件不能超过 2 MiB。',
  },
  en: {
    title: 'Menu screen image / GIF', hint: 'JPG, PNG, WebP or GIF, up to 2 MiB. Used only on the electronic menu screen.',
    dedicated: 'Current dedicated image / GIF', banner: 'Using the homepage banner', brand: 'Using product images or store branding',
    upload: 'Upload image / GIF', replace: 'Replace image / GIF', restore: 'Restore homepage banner', retry: 'Reload',
    loading: 'Loading media…', uploading: 'Uploading…', restoring: 'Restoring…', uploaded: 'Menu screen image updated.', restored: 'Default display restored.',
    loadError: 'Could not load media. Please retry.', uploadError: 'Upload failed. Please retry.', restoreError: 'Restore or refresh failed. Reload to check the current image.',
    invalidType: 'Choose a JPG, PNG, WebP or GIF file.', tooLarge: 'The file must be 2 MiB or smaller.',
  },
  km: {
    title: 'រូបភាព / GIF សម្រាប់អេក្រង់ម៉ឺនុយ', hint: 'JPG, PNG, WebP ឬ GIF ទំហំអតិបរមា 2 MiB។ ប្រើសម្រាប់តែអេក្រង់ម៉ឺនុយប៉ុណ្ណោះ។',
    dedicated: 'រូបភាព / GIF ផ្ទាល់ខ្លួនបច្ចុប្បន្ន', banner: 'កំពុងប្រើរូបភាពមុខហាងនៅទំព័រដើម', brand: 'កំពុងប្រើរូបភាពទំនិញ ឬម៉ាកហាង',
    upload: 'បង្ហោះរូបភាព / GIF', replace: 'ប្តូររូបភាព / GIF', restore: 'ស្តាររូបភាពមុខហាងនៅទំព័រដើម', retry: 'ផ្ទុកឡើងវិញ',
    loading: 'កំពុងផ្ទុករូបភាព…', uploading: 'កំពុងបង្ហោះ…', restoring: 'កំពុងស្តារ…', uploaded: 'បានធ្វើបច្ចុប្បន្នភាពរូបភាពអេក្រង់ម៉ឺនុយ។', restored: 'បានស្តារការបង្ហាញលំនាំដើម។',
    loadError: 'មិនអាចផ្ទុករូបភាពបាន។ សូមព្យាយាមម្តងទៀត។', uploadError: 'បង្ហោះមិនបាន។ សូមព្យាយាមម្តងទៀត។', restoreError: 'ស្តារ ឬធ្វើបច្ចុប្បន្នភាពមិនបាន។ សូមផ្ទុកឡើងវិញដើម្បីពិនិត្យរូបភាពបច្ចុប្បន្ន។',
    invalidType: 'សូមជ្រើសឯកសារ JPG, PNG, WebP ឬ GIF។', tooLarge: 'ទំហំឯកសារមិនអាចលើស 2 MiB ទេ។',
  },
}

type Media = { electronicMenuMediaUrl: string | null; bannerUrl: string | null }
type Busy = 'loading' | 'uploading' | 'restoring' | null
type ErrorKey = 'loadError' | 'uploadError' | 'restoreError' | 'invalidType' | 'tooLarge'

async function readMedia(storeId: string, signal: AbortSignal): Promise<Media> {
  const response = await apiFetch(`/api/stores/${encodeURIComponent(storeId)}/electronic-menu-media`, { cache: 'no-store', signal }, DEV_OWNER_CTX)
  if (!response.ok) throw new Error('MEDIA_READ_FAILED')
  const data = await response.json()
  if (!data || !['electronicMenuMediaUrl', 'bannerUrl'].every(key => data[key] === null || typeof data[key] === 'string')) {
    throw new Error('INVALID_MEDIA_RESPONSE')
  }
  return { electronicMenuMediaUrl: data.electronicMenuMediaUrl, bannerUrl: data.bannerUrl }
}

export default function ElectronicMenuMediaPanel({ storeCode, storeName }: { storeCode: string; storeName: string | null }) {
  const { lang } = useLocale()
  const text = COPY[lang]
  const [storeId, setStoreId] = useState<string | null>(null)
  const [media, setMedia] = useState<Media | null>(null)
  const [busy, setBusy] = useState<Busy>('loading')
  const [error, setError] = useState<ErrorKey | null>(null)
  const [notice, setNotice] = useState<'uploaded' | 'restored' | null>(null)
  const [reload, setReload] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const lifetime = useRef<AbortController | null>(null)
  // State disables the controls; the ref also closes the gap before React renders.
  const locked = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    locked.current = true
    setBusy('loading')
    setError(null)
    setNotice(null)
    void (async () => {
      try {
        const response = await apiFetch('/api/stores', { cache: 'no-store', signal: controller.signal }, DEV_OWNER_CTX)
        if (!response.ok) throw new Error('STORES_READ_FAILED')
        const stores: unknown = await response.json()
        if (controller.signal.aborted) return
        if (!Array.isArray(stores)) throw new Error('INVALID_STORES_RESPONSE')
        const matches = stores.filter(store => store && store.code === storeCode && typeof store.id === 'string' && store.id.length > 0)
        if (matches.length !== 1) throw new Error('CURRENT_STORE_NOT_FOUND')
        const id: string = matches[0].id
        const current = await readMedia(id, controller.signal)
        if (controller.signal.aborted) return
        setStoreId(id)
        setMedia(current)
      } catch {
        if (!controller.signal.aborted) setError('loadError')
      } finally {
        if (!controller.signal.aborted) {
          locked.current = false
          setBusy(null)
        }
      }
    })()
    return () => {
      controller.abort()
      lifetime.current = null
    }
  }, [storeCode, reload])

  async function update(file?: File) {
    const controller = lifetime.current
    if (locked.current || !storeId || !media || !controller || controller.signal.aborted) return
    setError(null)
    setNotice(null)
    const fileError = file && storeMediaFileError(file)
    if (fileError) { setError(fileError); return }
    locked.current = true
    setBusy(file ? 'uploading' : 'restoring')
    const endpoint = `/api/stores/${encodeURIComponent(storeId)}/electronic-menu-media`
    try {
      let next: Media
      if (file) {
        const form = new FormData()
        form.append('file', file)
        // Let the browser provide the multipart boundary; preserve the original GIF bytes.
        const response = await fetch(endpoint, { method: 'POST', headers: DEV_OWNER_CTX, body: form, signal: controller.signal })
        const body = await response.json()
        if (!response.ok || typeof body?.electronicMenuMediaUrl !== 'string' || !body.electronicMenuMediaUrl) throw new Error('MEDIA_UPLOAD_FAILED')
        next = { ...media, electronicMenuMediaUrl: body.electronicMenuMediaUrl }
      } else {
        const response = await apiFetch(endpoint, { method: 'DELETE', signal: controller.signal }, DEV_OWNER_CTX)
        const body = await response.json()
        if (!response.ok || body?.ok !== true) throw new Error('MEDIA_RESTORE_FAILED')
        if (controller.signal.aborted) return
        next = await readMedia(storeId, controller.signal)
      }
      if (controller.signal.aborted) return
      setMedia(next)
      setNotice(file ? 'uploaded' : 'restored')
    } catch {
      if (!controller.signal.aborted) setError(file ? 'uploadError' : 'restoreError')
    } finally {
      if (!controller.signal.aborted) {
        locked.current = false
        setBusy(null)
      }
    }
  }

  const source = media?.electronicMenuMediaUrl || media?.bannerUrl
  const previewLabel = media?.electronicMenuMediaUrl ? text.dedicated : media?.bannerUrl ? text.banner : text.brand
  const disabled = !!busy || !storeId || !media
  return (
    <section data-testid="electronic-menu-media-panel" aria-labelledby="electronic-menu-media-title" aria-busy={!!busy} style={styles.panel}>
      <h3 id="electronic-menu-media-title" style={{ margin: 0, fontSize: 16 }}>{text.title}</h3>
      <p style={styles.hint}>{text.hint}</p>
      {media && <>
        <div style={styles.preview}>
          {source ? <img data-testid="electronic-menu-media-preview" src={source} alt={previewLabel} style={styles.image} /> : <div data-testid="electronic-menu-media-brand" style={styles.brand}>
            <span aria-hidden="true" style={{ fontSize: 44 }}>{Array.from((storeName || storeCode).trim())[0]}</span>
            <strong>{storeName || storeCode}</strong>
          </div>}
        </div>
        <p style={styles.hint}>{previewLabel}</p>
      </>}
      <input ref={fileInput} data-testid="electronic-menu-media-file" type="file" accept={STORE_MEDIA_TYPES.join(',')} disabled={disabled} style={{ display: 'none' }} onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) void update(file)
      }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        <button type="button" disabled={disabled} onClick={() => { if (!locked.current) fileInput.current?.click() }} style={{ ...styles.button, opacity: disabled ? .5 : 1 }}>{media?.electronicMenuMediaUrl ? text.replace : text.upload}</button>
        {media?.electronicMenuMediaUrl && <button type="button" disabled={disabled} onClick={() => void update()} style={{ ...styles.button, background: '#f1f5f9', color: '#334155', opacity: disabled ? .5 : 1 }}>{text.restore}</button>}
        {error && <button type="button" disabled={!!busy} style={{ ...styles.button, background: '#f1f5f9', color: '#334155' }} onClick={() => {
          if (locked.current) return
          locked.current = true
          setBusy('loading')
          setReload(value => value + 1)
        }}>{text.retry}</button>}
      </div>
      <p role={error ? 'alert' : 'status'} style={{ ...styles.hint, minHeight: 20, marginBottom: 0, color: error ? '#b91c1c' : '#64748b' }}>{error ? text[error] : busy ? text[busy] : notice ? text[notice] : ''}</p>
    </section>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: { borderTop: '1px solid #e2e8f0', marginTop: 8, paddingTop: 20 },
  hint: { margin: '10px 0', fontSize: 12, lineHeight: 1.6, color: '#64748b' },
  preview: { height: 168, border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#f8fafc' },
  image: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
  brand: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 8, padding: 12, boxSizing: 'border-box', color: '#334155', textAlign: 'center', overflowWrap: 'anywhere' },
  button: { border: 0, borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', background: '#1e293b', color: '#fff' },
}

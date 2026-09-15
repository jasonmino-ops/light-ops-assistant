'use client'

import { type RefObject, useEffect, useMemo, useState } from 'react'
import { apiFetch, OWNER_CTX } from '@/lib/api'
import { formatMoney } from '@/lib/currency'

type Category = { id: string; name: string; parentId: string | null }
type Issue = { code: string; field?: string; message: string; blocking: boolean }
type Preview = {
  barcode: string
  name: string
  nameZh: string | null
  nameEn: string | null
  sellPrice: number
  category1: string | null
  category2: string | null
  categoryId: string | null
  imageCount: number
}
type ImportRow = {
  id: string
  sourceOrdinal: number
  sourceSheetName: string | null
  sourceRowNumber: number | null
  sourcePageNumber: number | null
  previewPayload: Preview
  validationIssues: Issue[]
  aiMetadata: {
    categorySuggestion?: { categoryId: string | null; confidence: number; reason: string } | null
  } | null
  assignedBarcode: string
  barcodeOrigin: 'SOURCE' | 'GENERATED'
  action: 'CREATE' | 'UPDATE'
  status: string
  version: number
  lastErrorCode: string | null
  lastErrorMessage: string | null
}
type JobListItem = {
  id: string
  sourceFileName: string
  sourceFormat: string
  status: string
  totalRowCount: number
  analyzedRowCount: number
  confirmedRowCount: number
  invalidRowCount: number
  failedRowCount: number
}
type ResultSummary = {
  total?: number
  confirmed?: number
  invalid?: number
  failed?: number
  compensationRequired?: number
}
export type JobView = {
  job: {
    id: string
    fileName: string
    sourceFileSize: number
    sourceMimeType: string
    format: string
    status: string
    totalRowCount: number
    analyzedRowCount: number
    readyRowCount: number
    invalidRowCount: number
    confirmedRowCount: number
    failedRowCount: number
    lastErrorCode: string | null
    lastErrorMessage: string | null
    resultSummary: unknown
    analysisWarnings: Issue[]
  }
  rows: ImportRow[]
  nextCursor: number | null
  hasMoreAnalysis: boolean
  batch?: { claimed: number; succeeded: number; failed: number }
}

export const PRODUCT_IMPORT_ANALYZE_NETWORK_RETRY_LIMIT = 3
export const PRODUCT_IMPORT_ANALYZE_RETRY_BACKOFF_MS = [1_000, 2_000, 4_000] as const
export const PRODUCT_IMPORT_ANALYZE_RECONCILE_DELAYS_MS = [
  0, 1_000, 2_000, 4_000,
  5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000,
] as const

const ANALYSIS_COMPLETE_STATUSES = new Set(['PREVIEW_READY', 'COMPLETED'])
const ANALYSIS_TERMINAL_STATUSES = new Set(['FAILED', 'CANCELLED', 'EXPIRED', 'COMPENSATION_REQUIRED'])

export class ProductImportAnalyzeRecoveryError extends Error {
  latestView: JobView | null

  constructor(message: string, latestView: JobView | null) {
    super(message)
    this.name = 'ProductImportAnalyzeRecoveryError'
    this.latestView = latestView
  }
}

export function isProductImportAnalyzeNetworkError(reason: unknown) {
  return reason instanceof TypeError
}

type ProductImportAnalyzeRunnerOptions = {
  initialView?: JobView | null
  analyze: () => Promise<JobView>
  load: () => Promise<JobView>
  onProgress?: (message: string) => void
  wait?: (milliseconds: number) => Promise<void>
  maxNetworkRetries?: number
  retryBackoffMs?: readonly number[]
  reconcileDelaysMs?: readonly number[]
  allowInitialFailedResume?: boolean
}

function analysisTerminalError(view: JobView) {
  return new ProductImportAnalyzeRecoveryError(
    view.job.lastErrorMessage || view.job.lastErrorCode || `导入任务已停止（${view.job.status}）`,
    view,
  )
}

export async function runProductImportAnalysis({
  initialView = null,
  analyze,
  load,
  onProgress = () => undefined,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxNetworkRetries = PRODUCT_IMPORT_ANALYZE_NETWORK_RETRY_LIMIT,
  retryBackoffMs = PRODUCT_IMPORT_ANALYZE_RETRY_BACKOFF_MS,
  reconcileDelaysMs = PRODUCT_IMPORT_ANALYZE_RECONCILE_DELAYS_MS,
  allowInitialFailedResume = false,
}: ProductImportAnalyzeRunnerOptions): Promise<JobView> {
  let current = initialView
  let networkRetries = 0
  let canResumeInitialFailed = allowInitialFailedResume && current?.job.status === 'FAILED'

  async function reconcile(): Promise<JobView> {
    let latest = current
    for (const delay of reconcileDelaysMs) {
      if (delay > 0) await wait(delay)
      try {
        latest = await load()
      } catch (reason) {
        if (!isProductImportAnalyzeNetworkError(reason)) throw reason
        continue
      }
      if (latest.job.status !== 'ANALYZING') return latest
    }
    throw new ProductImportAnalyzeRecoveryError(
      '网络连接中断，自动恢复未完成。任务进度已保留，请点击“继续 / 重试分析”。',
      latest,
    )
  }

  while (true) {
    if (current && ANALYSIS_COMPLETE_STATUSES.has(current.job.status)) return current
    if (current && ANALYSIS_TERMINAL_STATUSES.has(current.job.status)) {
      if (current.job.status === 'FAILED' && canResumeInitialFailed) {
        canResumeInitialFailed = false
      } else {
        throw analysisTerminalError(current)
      }
    }
    if (current?.job.status === 'ANALYZING') {
      onProgress('网络连接中断，正在恢复导入任务…')
      current = await reconcile()
      continue
    }
    if (current && !current.hasMoreAnalysis && current.job.status !== 'AWAITING_UPLOAD') return current

    try {
      current = await analyze()
      onProgress(`已分析 ${current.job.analyzedRowCount}/${current.job.totalRowCount || '…'} 行…`)
    } catch (reason) {
      if (!isProductImportAnalyzeNetworkError(reason)) throw reason
      onProgress('网络连接中断，正在恢复导入任务…')
      current = await reconcile()
      if (ANALYSIS_COMPLETE_STATUSES.has(current.job.status)) return current
      if (ANALYSIS_TERMINAL_STATUSES.has(current.job.status)) throw analysisTerminalError(current)
      if (!['ANALYSIS_PENDING', 'AWAITING_UPLOAD'].includes(current.job.status)) {
        throw new ProductImportAnalyzeRecoveryError(
          `导入任务当前为 ${current.job.status}，请稍后点击“继续 / 重试分析”。`,
          current,
        )
      }
      if (networkRetries >= maxNetworkRetries) {
        throw new ProductImportAnalyzeRecoveryError(
          '网络连接中断，自动恢复重试次数已用完。任务进度已保留，请点击“继续 / 重试分析”。',
          current,
        )
      }
      const backoff = retryBackoffMs[Math.min(networkRetries, retryBackoffMs.length - 1)] ?? 0
      networkRetries += 1
      if (backoff > 0) await wait(backoff)
      // Re-read after backoff so a delayed original request cannot move from
      // PENDING to ANALYZING between reconciliation and the retry POST.
      current = await reconcile()
    }
  }
}

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new Error(String(body.message ?? body.error ?? `HTTP_${response.status}`))
  return body
}

async function appRequest(path: string, init?: RequestInit) {
  const response = await apiFetch(path, init, OWNER_CTX)
  return jsonResponse(response)
}

async function loadJobPage(jobId: string, cursor = 0): Promise<JobView> {
  return appRequest(`/api/products/import/jobs/${jobId}?cursor=${cursor}&limit=200`) as unknown as Promise<JobView>
}

function categoryLabel(categories: Category[], id: string) {
  const category = categories.find((item) => item.id === id)
  if (!category) return id
  const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : null
  return parent ? `${parent.name} › ${category.name}` : category.name
}

function CandidateImage({ path, label }: { path: string; label: string }) {
  const [source, setSource] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    return () => { if (source) URL.revokeObjectURL(source) }
  }, [source])
  async function load() {
    setLoading(true)
    setFailed(false)
    try {
      const response = await apiFetch(path, {}, OWNER_CTX)
      if (!response.ok) throw new Error('IMAGE_PREVIEW_FAILED')
      setSource(URL.createObjectURL(await response.blob()))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }
  if (failed) return <span style={styles.hint}>预览失败</span>
  if (!source) return <button type="button" style={styles.imageButton} disabled={loading} onClick={load}>{loading ? '加载…' : '查看图'}</button>
  return <img src={source} alt={label} loading="lazy" style={styles.thumbnail} />
}

export default function ProductBulkImportPanel({
  currencyCode,
  fileInputRef,
}: {
  currencyCode: string
  fileInputRef: RefObject<HTMLInputElement | null>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [view, setView] = useState<JobView | null>(null)
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [pageCursor, setPageCursor] = useState(0)
  const [categories, setCategories] = useState<Category[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    appRequest('/api/categories').then((value) => setCategories(value as unknown as Category[])).catch(() => undefined)
    appRequest('/api/products/import/jobs').then(async (value) => {
      const loadedJobs = (value as { jobs?: JobListItem[] }).jobs ?? []
      setJobs(loadedJobs)
      const selected = loadedJobs.find((job) => job.status !== 'COMPLETED') ?? loadedJobs[0]
      if (selected) {
        setPageCursor(0)
        setView(await loadJobPage(selected.id))
      }
    }).catch(() => undefined)
  }, [])

  const counts = useMemo(() => ({
    ready: view?.job.readyRowCount ?? 0,
    invalid: view?.job.invalidRowCount ?? 0,
    confirmed: view?.job.confirmedRowCount ?? 0,
    failed: view?.job.failedRowCount ?? 0,
    images: view?.rows.reduce((sum, row) => sum + (row.previewPayload.imageCount || 0), 0) ?? 0,
  }), [view])
  const resultSummary = view?.job.resultSummary && typeof view.job.resultSummary === 'object'
    ? view.job.resultSummary as ResultSummary
    : null

  async function downloadTemplate() {
    try {
      const response = await apiFetch('/api/products/import', {}, OWNER_CTX)
      if (!response.ok) throw new Error('模板下载失败')
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'products_template.xlsx'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '模板下载失败')
    }
  }

  async function begin() {
    if (!file) return
    setBusy(true)
    setError(null)
    setView(null)
    let activeJobId: string | null = null
    try {
      setProgress('创建导入任务…')
      const created = await appRequest('/api/products/import/jobs', {
        method: 'POST',
        body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size }),
      }) as { jobId: string; uploadUrl: string; uploadMimeType: string }
      activeJobId = created.jobId
      setProgress('原始文件直传 Storage…')
      let uploadUrl = created.uploadUrl
      let uploaded = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': created.uploadMimeType, 'x-upsert': 'true' },
        body: file,
      })
      if (!uploaded.ok) {
        const resigned = await appRequest(`/api/products/import/jobs/${created.jobId}/upload`, { method: 'POST' }) as { uploadUrl: string }
        uploadUrl = resigned.uploadUrl
        uploaded = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': created.uploadMimeType, 'x-upsert': 'true' },
          body: file,
        })
      }
      if (!uploaded.ok) throw new Error(`文件直传失败（${uploaded.status}）`)
      setProgress('分析商品字段与图片…')
      await runProductImportAnalysis({
        analyze: () => appRequest(`/api/products/import/jobs/${created.jobId}/analyze`, { method: 'POST' }) as unknown as Promise<JobView>,
        load: () => loadJobPage(created.jobId),
        onProgress: setProgress,
      })
      setPageCursor(0)
      setView(await loadJobPage(created.jobId))
      const listed = await appRequest('/api/products/import/jobs') as { jobs?: JobListItem[] }
      setJobs(listed.jobs ?? [])
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setProgress('')
    } catch (reason) {
      if (activeJobId) {
        const latest = reason instanceof ProductImportAnalyzeRecoveryError && reason.latestView
          ? reason.latestView
          : await loadJobPage(activeJobId).catch(() => null)
        if (latest) {
          setPageCursor(0)
          setView(latest)
        }
        const listed = await appRequest('/api/products/import/jobs').catch(() => null) as { jobs?: JobListItem[] } | null
        if (listed) setJobs(listed.jobs ?? [])
      }
      setError(reason instanceof Error ? reason.message : '导入分析失败')
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  async function continueAnalysis() {
    if (!view) return
    setBusy(true)
    setError(null)
    try {
      setProgress(`继续分析 ${view.job.analyzedRowCount}/${view.job.totalRowCount || '…'}…`)
      await runProductImportAnalysis({
        initialView: view,
        analyze: () => appRequest(`/api/products/import/jobs/${view.job.id}/analyze`, { method: 'POST' }) as unknown as Promise<JobView>,
        load: () => loadJobPage(view.job.id),
        onProgress: setProgress,
        allowInitialFailedResume: true,
      })
      setView(await loadJobPage(view.job.id, pageCursor))
      setProgress('')
    } catch (reason) {
      const latest = reason instanceof ProductImportAnalyzeRecoveryError && reason.latestView
        ? reason.latestView
        : await loadJobPage(view.job.id, pageCursor).catch(() => null)
      if (latest) setView(latest)
      setError(reason instanceof Error ? reason.message : '继续分析失败')
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  async function resumeExistingUpload() {
    if (!view || !file) return
    if (file.name !== view.job.fileName || file.size !== view.job.sourceFileSize) {
      setError('请选择与该任务登记的文件名和大小完全一致的原始文件')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setProgress('重新签名并直传同一原始文件…')
      const signed = await appRequest(`/api/products/import/jobs/${view.job.id}/upload`, { method: 'POST' }) as {
        uploadUrl: string
        uploadMimeType: string
      }
      const uploaded = await fetch(signed.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': signed.uploadMimeType || view.job.sourceMimeType, 'x-upsert': 'true' },
        body: file,
      })
      if (!uploaded.ok) throw new Error(`文件直传失败（${uploaded.status}）`)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setView(await loadJobPage(view.job.id, pageCursor))
      setProgress('文件已恢复，可继续 Analyze')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复上传失败')
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  function changeRow(rowId: string, patch: Partial<Preview>) {
    setView((current) => current ? {
      ...current,
      rows: current.rows.map((row) => row.id === rowId ? { ...row, previewPayload: { ...row.previewPayload, ...patch } } : row),
    } : current)
  }

  async function saveRow(row: ImportRow, patch: Record<string, unknown>) {
    if (!view) return
    setError(null)
    try {
      await appRequest(`/api/products/import/jobs/${view.job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ rowId: row.id, patch: { ...patch, version: row.version } }),
      })
      setView(await loadJobPage(view.job.id, pageCursor))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存 Preview 修改失败')
      setView(await loadJobPage(view.job.id, pageCursor).catch(() => view))
    }
  }

  async function confirmAll() {
    if (!view) return
    setBusy(true)
    setError(null)
    try {
      let next = view
      do {
        setProgress(`批量提交中，已完成 ${next.job.confirmedRowCount}/${next.job.totalRowCount}…`)
        next = await appRequest(`/api/products/import/jobs/${view.job.id}/confirm`, { method: 'POST' }) as unknown as JobView
        if ((next.batch?.claimed ?? 0) === 0) break
      } while (next.job.readyRowCount > 0 || next.job.status === 'CONFIRMING')
      setView(await loadJobPage(view.job.id, pageCursor))
      setProgress('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '确认导入失败')
      setView(await loadJobPage(view.job.id, pageCursor).catch(() => view))
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  async function retry() {
    if (!view) return
    setBusy(true)
    setError(null)
    try {
      await appRequest(`/api/products/import/jobs/${view.job.id}/retry`, { method: 'POST' })
      setView(await loadJobPage(view.job.id, pageCursor))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重试失败')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!view) return
    setBusy(true)
    try {
      await appRequest(`/api/products/import/jobs/${view.job.id}`, { method: 'DELETE' })
      setJobs((current) => current.filter((job) => job.id !== view.job.id))
      setView(null)
      setPageCursor(0)
      setProgress('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消失败')
    } finally {
      setBusy(false)
    }
  }

  async function showPage(cursor: number) {
    if (!view) return
    setBusy(true)
    setError(null)
    try {
      setView(await loadJobPage(view.job.id, cursor))
      setPageCursor(cursor)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载 Preview 分页失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {jobs.length > 0 && (
        <label style={{ display: 'grid', gap: 4, maxWidth: 520 }}>
          <span style={styles.hint}>当前 / 历史导入任务</span>
          <select
            value={view?.job.id ?? ''}
            style={styles.input}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value
              if (!id) {
                setView(null)
                setPageCursor(0)
                return
              }
              setBusy(true)
              setPageCursor(0)
              loadJobPage(id).then(setView).catch((reason) => setError(reason instanceof Error ? reason.message : '加载任务失败')).finally(() => setBusy(false))
            }}
          >
            <option value="">新建导入</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>{job.sourceFileName} · {job.status} · {job.confirmedRowCount}/{job.totalRowCount}</option>
            ))}
          </select>
        </label>
      )}
      {!view && (
        <>
          <button type="button" style={styles.secondary} onClick={downloadTemplate}>下载 XLSX 模板</button>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,.pdf"
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null) }}
            />
            <button type="button" style={styles.primary} disabled={!file || busy} onClick={begin}>
              {busy ? '处理中…' : '上传并分析'}
            </button>
          </div>
          <div style={styles.hint}>文件只上传一次并直传 private staging；支持标准 XLSX 内嵌图、CSV 与需人工确认的 PDF。</div>
        </>
      )}

      {progress && <div style={styles.progress}>{progress}</div>}
      {error && <div style={styles.error}>{error}</div>}

      {view && (
        <>
          <div style={styles.summary}>
            <span>任务 {view.job.status}</span>
            <span>总计 <strong>{view.job.totalRowCount}</strong></span>
            <span>待确认 <strong style={{ color: '#1677ff' }}>{counts.ready}</strong></span>
            <span>异常 <strong style={{ color: '#dc2626' }}>{counts.invalid}</strong></span>
            <span>已完成 <strong style={{ color: '#16a34a' }}>{counts.confirmed}</strong></span>
            <span>失败 <strong style={{ color: '#dc2626' }}>{counts.failed}</strong></span>
            <span>本页图片候选 <strong>{counts.images}</strong></span>
          </div>
          {resultSummary && (
            <div style={styles.report}>
              <strong>导入结果报告</strong>
              <span>源行 {resultSummary.total ?? view.job.totalRowCount}</span>
              <span>已创建 / 更新 {resultSummary.confirmed ?? view.job.confirmedRowCount}</span>
              <span>隔离异常 {resultSummary.invalid ?? view.job.invalidRowCount}</span>
              <span>失败 {resultSummary.failed ?? view.job.failedRowCount}</span>
              <span>待补偿 {resultSummary.compensationRequired ?? 0}</span>
            </div>
          )}
          {(view.job.analysisWarnings ?? []).map((warning, index) => (
            <div key={`${warning.code}-${index}`} style={warning.blocking ? styles.error : styles.progress}>{warning.message}</div>
          ))}
          {(view.job.status === 'AWAITING_UPLOAD' || (view.job.status === 'FAILED' && view.job.lastErrorCode === 'STAGING_SIGN_FAILED')) && (
            <div style={{ display: 'grid', gap: 8, border: '1px solid #bfdbfe', borderRadius: 8, padding: 10 }}>
              <div style={styles.hint}>任务等待原始文件；刷新后可重选同名、同大小文件并继续使用该 Job。</div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv,.pdf"
                onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(null) }}
              />
              <button type="button" style={styles.secondary} disabled={!file || busy} onClick={resumeExistingUpload}>恢复直传</button>
            </div>
          )}
          <div style={{ overflowX: 'auto', maxHeight: 560 }}>
            <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 12 }}>
              <thead><tr>
                <th style={styles.th}>来源</th><th style={styles.th}>条码</th><th style={styles.th}>商品名</th>
                <th style={styles.th}>售价</th><th style={styles.th}>分类</th><th style={styles.th}>图片</th><th style={styles.th}>状态 / 异常</th>
              </tr></thead>
              <tbody>{view.rows.map((row) => (
                <tr key={row.id} style={row.status === 'INVALID' ? { background: '#fff7f7' } : undefined}>
                  <td style={styles.td}>{row.sourceSheetName ? `${row.sourceSheetName} #${row.sourceRowNumber}` : `PDF p.${row.sourcePageNumber}`}</td>
                  <td style={styles.td}>
                    <code>{row.assignedBarcode}</code>
                    {row.barcodeOrigin === 'GENERATED' && <div style={styles.generated}>系统 EAN-13（只读）</div>}
                  </td>
                  <td style={styles.td}>
                    <input
                      value={row.previewPayload.name}
                      disabled={!['READY', 'INVALID'].includes(row.status)}
                      style={styles.input}
                      onChange={(event) => changeRow(row.id, { name: event.target.value, nameZh: event.target.value })}
                      onBlur={() => saveRow(row, { name: row.previewPayload.name, nameZh: row.previewPayload.nameZh })}
                    />
                    {row.previewPayload.nameEn && <div style={styles.hint}>{row.previewPayload.nameEn}</div>}
                  </td>
                  <td style={styles.td}>
                    <input
                      type="number" min="0" step="0.01" value={row.previewPayload.sellPrice}
                      disabled={!['READY', 'INVALID'].includes(row.status)} style={{ ...styles.input, width: 100 }}
                      onChange={(event) => changeRow(row.id, { sellPrice: Number(event.target.value) })}
                      onBlur={() => saveRow(row, { sellPrice: row.previewPayload.sellPrice })}
                    />
                    <div>{formatMoney(row.previewPayload.sellPrice || 0, currencyCode)}</div>
                  </td>
                  <td style={styles.td}>
                    <select
                      value={row.previewPayload.categoryId ?? ''} disabled={!['READY', 'INVALID'].includes(row.status)} style={styles.input}
                      onChange={(event) => {
                        const categoryId = event.target.value || null
                        changeRow(row.id, { categoryId })
                        void saveRow(row, { categoryId })
                      }}
                    >
                      <option value="">未分类 / 待选择</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{categoryLabel(categories, category.id)}</option>)}
                    </select>
                    {row.aiMetadata?.categorySuggestion?.categoryId && (
                      <button
                        type="button"
                        style={styles.link}
                        disabled={!['READY', 'INVALID'].includes(row.status)}
                        title={row.aiMetadata.categorySuggestion.reason}
                        onClick={() => {
                          const categoryId = row.aiMetadata?.categorySuggestion?.categoryId ?? null
                          changeRow(row.id, { categoryId })
                          void saveRow(row, { categoryId })
                        }}
                      >AI 候选：{categoryLabel(categories, row.aiMetadata.categorySuggestion.categoryId)}</button>
                    )}
                  </td>
                  <td style={styles.td}>
                    {row.previewPayload.imageCount || 0} 张
                    {row.previewPayload.imageCount > 0 && view.job.format !== 'PDF' && ['READY', 'INVALID'].includes(row.status) && (
                      <div style={styles.thumbnails}>
                        {Array.from({ length: Math.min(3, row.previewPayload.imageCount) }, (_, slot) => (
                          <CandidateImage
                            key={slot}
                            path={`/api/products/import/jobs/${view.job.id}/rows/${row.id}/images/${slot}`}
                            label={`${row.previewPayload.name} 图片候选 ${slot + 1}`}
                          />
                        ))}
                      </div>
                    )}
                    {row.previewPayload.imageCount > 0 && view.job.format === 'PDF' && <div style={styles.hint}>PDF 相邻图片候选需人工处理</div>}
                    {row.previewPayload.imageCount > 0 && ['READY', 'INVALID'].includes(row.status) && (
                      <button type="button" style={styles.link} onClick={() => saveRow(row, { discardImages: true })}>移除图片候选</button>
                    )}
                  </td>
                  <td style={styles.td}>
                    <strong>{row.status}</strong> · {row.action === 'UPDATE' ? '更新' : '新增'}
                    {row.validationIssues.map((issue, index) => <div key={`${issue.code}-${index}`} style={styles.issue}>{issue.message}</div>)}
                    {row.lastErrorMessage && <div style={styles.issue}>{row.lastErrorMessage}</div>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
            <span style={styles.hint}>
              当前 {view.rows.length > 0 ? `${pageCursor + 1}–${pageCursor + view.rows.length}` : '0'} / {view.job.analyzedRowCount}
            </span>
            <button
              type="button"
              style={styles.secondary}
              disabled={busy || pageCursor === 0}
              onClick={() => void showPage(Math.max(0, pageCursor - 200))}
            >上一页</button>
            <button
              type="button"
              style={styles.secondary}
              disabled={busy || view.nextCursor == null}
              onClick={() => void showPage(view.nextCursor ?? pageCursor)}
            >下一页</button>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={styles.secondary} disabled={busy} onClick={cancel}>取消任务</button>
            {(view.hasMoreAnalysis || view.job.status === 'AWAITING_UPLOAD') && (
              <button type="button" style={styles.secondary} disabled={busy} onClick={continueAnalysis}>继续 / 重试分析</button>
            )}
            {(counts.failed > 0 || ['CONFIRMING', 'CONFIRMING_ACTIVE', 'RETRYING_ACTIVE', 'COMPENSATION_REQUIRED'].includes(view.job.status)) && (
              <button type="button" style={styles.secondary} disabled={busy} onClick={retry}>清理 / 接管失败批次</button>
            )}
            <button
              type="button"
              style={styles.primary}
              disabled={busy || counts.ready === 0 || !['PREVIEW_READY', 'CONFIRMING', 'CONFIRMING_ACTIVE'].includes(view.job.status)}
              onClick={confirmAll}
            >
              {busy ? '执行中…' : `确认 ${counts.ready} 条可导入商品`}
            </button>
            {view.job.status === 'PREVIEW_READY' && counts.ready === 0 && counts.invalid > 0 && (
              <button type="button" style={styles.primary} disabled={busy} onClick={confirmAll}>
                完成并保留 {counts.invalid} 条隔离异常
              </button>
            )}
            {view.job.status === 'COMPLETED' && <button type="button" style={styles.primary} onClick={() => { setView(null); setPageCursor(0) }}>继续导入</button>}
          </div>
          {counts.invalid > 0 && <div style={styles.hint}>异常行不会写入 Product；可直接修正名称、售价、分类，系统生成条码不会因 Preview 修改而变化。</div>}
        </>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  primary: { border: 0, borderRadius: 8, background: '#1677ff', color: '#fff', padding: '9px 14px', cursor: 'pointer' },
  secondary: { border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', color: '#374151', padding: '8px 12px', cursor: 'pointer', width: 'fit-content' },
  link: { display: 'block', border: 0, background: 'transparent', padding: '3px 0', color: '#1677ff', cursor: 'pointer', fontSize: 11 },
  input: { width: '100%', minWidth: 120, border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 7px', fontSize: 12 },
  summary: { display: 'flex', gap: '6px 16px', flexWrap: 'wrap', borderRadius: 8, background: '#f8fafc', padding: 10, fontSize: 13 },
  report: { display: 'flex', gap: '6px 16px', flexWrap: 'wrap', border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', padding: 10, fontSize: 12 },
  progress: { color: '#1677ff', background: '#eff6ff', borderRadius: 8, padding: 9 },
  error: { color: '#b91c1c', background: '#fef2f2', borderRadius: 8, padding: 9 },
  hint: { color: '#6b7280', fontSize: 11, lineHeight: 1.5 },
  generated: { color: '#7c3aed', fontSize: 10, marginTop: 3 },
  issue: { color: '#dc2626', fontSize: 11, marginTop: 3, maxWidth: 260 },
  thumbnails: { display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 },
  thumbnail: { width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff' },
  imageButton: { border: '1px solid #bfdbfe', borderRadius: 6, background: '#eff6ff', color: '#1d4ed8', padding: '4px 6px', cursor: 'pointer', fontSize: 10 },
  th: { textAlign: 'left', padding: 8, borderBottom: '1px solid #d1d5db', position: 'sticky', top: 0, background: '#f8fafc', zIndex: 1 },
  td: { padding: 8, borderBottom: '1px solid #e5e7eb', verticalAlign: 'top' },
}

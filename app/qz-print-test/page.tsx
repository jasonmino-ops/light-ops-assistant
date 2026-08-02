import { notFound } from 'next/navigation'
import QzPrintTestClient from './QzPrintTestClient'

export const metadata = {
  title: 'QZ-PRINT-02C｜正式票据 RAW 位图验证',
  robots: { index: false, follow: false },
}

export default function QzPrintTestPage() {
  const previewCommit = process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_COMMIT ?? ''
  const previewLabel = process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_LABEL
  const isControlledPreview =
    process.env.VERCEL_ENV === 'preview' &&
    (previewLabel === 'QZ-PRINT-02C' || previewLabel === 'QZ-PRINT-02D') &&
    /^[0-9a-f]{40}$/.test(previewCommit)

  if (!isControlledPreview) notFound()

  return <QzPrintTestClient previewCommit={previewCommit} />
}

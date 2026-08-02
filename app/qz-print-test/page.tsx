import { notFound } from 'next/navigation'
import QzPrintTestClient from './QzPrintTestClient'

export const metadata = {
  title: 'QZ-PRINT-02B｜ESC/POS RAW 自动切纸验证',
  robots: { index: false, follow: false },
}

export default function QzPrintTestPage() {
  const previewCommit = process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_COMMIT ?? ''
  const isControlledPreview =
    process.env.VERCEL_ENV === 'preview' &&
    process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_LABEL === 'QZ-PRINT-02B' &&
    /^[0-9a-f]{40}$/.test(previewCommit)

  if (!isControlledPreview) notFound()

  return <QzPrintTestClient previewCommit={previewCommit} />
}

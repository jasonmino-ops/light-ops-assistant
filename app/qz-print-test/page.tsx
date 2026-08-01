import { notFound } from 'next/navigation'
import QzPrintTestClient from './QzPrintTestClient'

export const metadata = {
  title: 'QZ-PRINT-01C｜双打印机测试',
  robots: { index: false, follow: false },
}

export default function QzPrintTestPage() {
  const isControlledPreview =
    process.env.VERCEL_ENV === 'preview' &&
    process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_LABEL === 'QZ-PRINT-01C' &&
    process.env.NEXT_PUBLIC_QZ_PRINT_PREVIEW_COMMIT === 'ba9e599'

  if (!isControlledPreview) notFound()

  return <QzPrintTestClient />
}

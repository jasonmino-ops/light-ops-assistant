import type { ReactNode } from 'react'
import { DisplayDocumentBoundary } from './DisplayBoundary'

/** The App Router root delegates only this route's standalone document here. */
export default function ElectronicMenuDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;600;700&display=swap" />
      </head>
      <body data-electronic-menu-document="true" style={{ paddingBottom: 0, background: '#191c1a' }}>
        <DisplayDocumentBoundary>{children}</DisplayDocumentBoundary>
      </body>
    </html>
  )
}

import './globals.css'
import BottomNav from './components/nav'

export const metadata = { title: '轻经营助手' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <BottomNav />
      </body>
    </html>
  )
}

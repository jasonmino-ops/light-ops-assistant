import './globals.css'
import BottomNav from './components/nav'

export const metadata = { title: '轻店助手' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const role = process.env.DEV_ROLE ?? 'STAFF'
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <BottomNav role={role} />
      </body>
    </html>
  )
}

import { cookies } from 'next/headers'
import './globals.css'
import BottomNav from './components/nav'
import TelegramInit from './components/TelegramInit'
import LangProvider from './components/LangProvider'
import WorkModeProvider from './components/WorkModeProvider'
import { verifySession } from '@/lib/session'

export const metadata = { title: 'E-shop 店小二助手' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve role: signed cookie (Telegram auth) → DEV_ROLE env (local dev) → STAFF
  const cookieStore = await cookies()
  const sessionToken = cookieStore.get('auth-session')?.value
  const sessionRole = sessionToken ? verifySession(sessionToken)?.role : undefined
  const role = sessionRole ?? process.env.DEV_ROLE ?? 'STAFF'

  return (
    <html lang="zh-CN">
      <head>
        {/* Prevent iOS Safari from zooming on input focus; viewport-fit=cover for notch/home-indicator */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        {/* Noto Sans Khmer — for Khmer language UI */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        {/* Telegram WebApp SDK — no-op when opened outside Telegram */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body>
        <TelegramInit />
        <LangProvider>
          <WorkModeProvider role={role}>
            {children}
            <BottomNav />
          </WorkModeProvider>
        </LangProvider>
      </body>
    </html>
  )
}

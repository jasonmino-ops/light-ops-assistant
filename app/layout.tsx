import { cookies, headers } from 'next/headers'
import Script from 'next/script'
import './globals.css'
import BottomNav from './components/nav'
import TelegramInit from './components/TelegramInit'
import LangProvider from './components/LangProvider'
import WorkModeProvider from './components/WorkModeProvider'
import DelegateBanner from './components/DelegateBanner'
import { verifySession } from '@/lib/session'

export const metadata = {
  title: '店小二助手',
  description: '门店轻经营助手 — 扫码销售 · 库存管理 · 经营概览',
}

const TIKTOK_PIXEL_ID = process.env.NODE_ENV === 'production'
  ? (process.env.NEXT_PUBLIC_TIKTOK_PIXEL_ID ?? 'D8K1V73C77U48KTDSRVG').trim()
  : ''

const PUBLIC_EXACT_PATHS = ['/']
const PUBLIC_PATH_PREFIXES = ['/start', '/open', '/bind', '/relogin', '/menu', '/m', '/e-life', '/me', '/v', '/p', '/creator/p', '/cashier', '/privacy', '/terms', '/contact', '/ops']

function isProtectedMerchantPath(path: string) {
  if (!path || PUBLIC_EXACT_PATHS.includes(path)) return false
  return !PUBLIC_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve role: signed cookie (Telegram auth) → DEV_ROLE env (local dev) → STAFF
  const cookieStore = await cookies()
  const headerStore = await headers()
  const sessionToken = cookieStore.get('auth-session')?.value
  const sessionRole = sessionToken ? verifySession(sessionToken)?.role : undefined
  const role = sessionRole ?? process.env.DEV_ROLE ?? 'STAFF'
  const pathname = headerStore.get('x-current-path') ?? ''
  const initialProtected = isProtectedMerchantPath(pathname)

  return (
    <html lang="zh-CN">
      <head>
        {/* Prevent iOS Safari from zooming on input focus; viewport-fit=cover for notch/home-indicator */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />

        {/* ── PWA ───────────────────────────────────────────────────────────── */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#1677ff" />
        {/* iOS "Add to Home Screen" — SVG icon works on Chrome/Android;
            icon-192.png needed for iOS apple-touch-icon (generate with any
            icon tool at 192×192 and 512×512, place in /public/) */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="店小二助手" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        {/* ─────────────────────────────────────────────────────────────────── */}

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
        {TIKTOK_PIXEL_ID && (
          <Script
            id="tiktok-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                !function (w, d, t) {
                  w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
                  ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
                  ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
                  for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
                  ttq.instance=function(t){var e=ttq._i[t]||[];for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(e,ttq.methods[i]);return e};
                  ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;
                    ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
                    n=d.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;
                    e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)
                  };
                  ttq.load('${TIKTOK_PIXEL_ID}');
                  ttq.page();
                }(window, document, 'ttq');
              `,
            }}
          />
        )}
        <TelegramInit initialProtected={initialProtected}>
          <DelegateBanner />
          <LangProvider>
            <WorkModeProvider role={role}>
              {children}
              <BottomNav />
            </WorkModeProvider>
          </LangProvider>
        </TelegramInit>
      </body>
    </html>
  )
}

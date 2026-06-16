export const metadata = {
  title: '店小二收银台',
  description: '店小二电脑端收银台',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: '店小二收银台',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport = {
  themeColor: '#111827',
}

export default function CashierLayout({ children }: { children: React.ReactNode }) {
  return children
}

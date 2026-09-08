import ElectronicMenuScreen from './ElectronicMenuScreen'
import { DisplayPageBoundary } from './DisplayBoundary'
import { isValidMenuCode, type MenuLang } from '@/lib/electronic-menu'

export const metadata = {
  title: '电子菜单 · Menu',
  robots: { index: false, follow: false },
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function ElectronicMenuPage({ searchParams }: PageProps) {
  const query = await searchParams
  const lang: MenuLang = query.lang === 'en' || query.lang === 'km' ? query.lang : 'zh'
  const valid = Object.keys(query).every((key) => key === 'code' || key === 'lang')
    && typeof query.code === 'string'
    && isValidMenuCode(query.code)
    && (query.lang === undefined || query.lang === 'zh' || query.lang === 'en' || query.lang === 'km')
  const code = valid ? query.code as string : null

  // A different selector remounts the screen, so an earlier store cannot flash
  // while the new public catalog is loading. No raw invalid input is serialized.
  return <DisplayPageBoundary><ElectronicMenuScreen key={`${code ?? 'invalid'}:${lang}`} code={code} initialLang={lang} /></DisplayPageBoundary>
}

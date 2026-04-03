'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import zh from '@/lib/i18n/zh'
import km from '@/lib/i18n/km'

export type Lang = 'zh' | 'km'

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const LangContext = createContext<Ctx>({
  lang: 'zh',
  setLang: () => {},
  t: (k) => k,
})

export function useLocale() {
  return useContext(LangContext)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lookup(dict: any, key: string): string {
  const parts = key.split('.')
  let val = dict
  for (const p of parts) val = val?.[p]
  return typeof val === 'string' ? val : key
}

export default function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('zh')

  useEffect(() => {
    const stored = localStorage.getItem('lang')
    if (stored === 'km' || stored === 'zh') setLangState(stored)
  }, [])

  function setLang(l: Lang) {
    setLangState(l)
    localStorage.setItem('lang', l)
  }

  const dict = lang === 'km' ? km : zh

  function t(key: string): string {
    return lookup(dict, key)
  }

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

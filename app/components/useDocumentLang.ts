'use client'

import { useEffect } from 'react'

export type DocumentLang = 'zh' | 'en' | 'km'

export function useDocumentLang(lang: DocumentLang) {
  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dataset.lang = lang
    document.body.dataset.lang = lang
  }, [lang])
}

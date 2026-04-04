'use client'

import { useLocale } from './LangProvider'

/**
 * Minimal language toggle button — switches between zh ↔ km.
 * Styled for placement inside a blue header bar.
 * Pass `style` to override/extend appearance.
 */
export default function LangToggleBtn({ style }: { style?: React.CSSProperties }) {
  const { lang, setLang, t } = useLocale()
  return (
    <button
      type="button"
      style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.85)',
        background: 'rgba(255,255,255,0.15)',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: 12,
        padding: '4px 10px',
        cursor: 'pointer',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...style,
      }}
      onClick={() => setLang(lang === 'zh' ? 'km' : 'zh')}
    >
      {t('home.langBtn')}
    </button>
  )
}

'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useLocale } from '@/app/components/LangProvider'
import { isInventoryDesktop, request, RequestError, telegramInitData, type Access } from '@/app/native-inventory/client'

const LegacyInventoryPilot = createContext(false)

export function LegacyInventoryProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <LegacyInventoryPilot.Provider value={enabled}>{children}</LegacyInventoryPilot.Provider>
}

type Destination = 'native' | 'disabled' | 'telegram' | 'denied' | 'retry'

const notices = {
  zh: { disabled: '当前门店尚未开通原生进销存', telegram: '请从 Telegram 重新打开店小二', denied: '当前账号没有本门店的进销存权限' },
  en: { disabled: 'Native inventory is not enabled for this store', telegram: 'Reopen E-Shop from Telegram', denied: 'Your account cannot access inventory for this store' },
  km: { disabled: 'ហាងនេះមិនទាន់បានបើកប្រើការគ្រប់គ្រងស្តុកទេ', telegram: 'សូមបើក E-Shop ឡើងវិញពី Telegram', denied: 'គណនីរបស់អ្នកមិនមានសិទ្ធិចូលប្រើស្តុកហាងនេះទេ' },
}

export function MerchantInventoryEntry({ children, label, style }: { children: ReactNode; label: string; style: CSSProperties }) {
  const { lang, t } = useLocale()
  const legacyPilot = useContext(LegacyInventoryPilot)
  const [destination, setDestination] = useState<Destination>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (legacyPilot) return
    if (isInventoryDesktop() || !telegramInitData()) {
      setDestination('telegram')
      return
    }
    const controller = new AbortController()
    void request<Access>('access', undefined, controller.signal).then(
      (access) => {
        if (!controller.signal.aborted) setDestination(access.role === 'OWNER' ? 'native' : 'denied')
      },
      (error) => {
        if (controller.signal.aborted) return
        const code = error instanceof RequestError ? error.code : ''
        switch (code) {
          case 'NATIVE_INVENTORY_DISABLED':
            setDestination('disabled')
            break
          case 'PERSON_REQUIRED':
          case 'PERSON_PROOF_REQUIRED':
          case 'PERSON_PROOF_INVALID':
            setDestination('telegram')
            break
          case 'STORE_ACCESS_DENIED':
          case 'RECEIVING_ACCESS_DENIED':
            setDestination('denied')
            break
          default:
            setDestination('retry')
        }
      },
    )
    return () => controller.abort()
  }, [attempt, legacyPilot])

  if (legacyPilot) return children
  if (destination === 'native') return <Link href="/native-inventory" prefetch={false} data-testid="inventory-entry" style={style}>{label}</Link>
  if (destination === 'retry') {
    return (
      <button type="button" style={style} onClick={() => {
        setDestination(undefined)
        setAttempt((value) => value + 1)
      }}>
        {label} · {t('common.retry')}
      </button>
    )
  }
  if (destination) {
    return (
      <button type="button" disabled aria-label={label + ' · ' + notices[lang][destination]}
        style={{ ...style, flexDirection: 'column', gap: 2 }}>
        {label}<small>{notices[lang][destination]}</small>
      </button>
    )
  }
  return <button type="button" disabled aria-busy="true" style={style}>{label}</button>
}

'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from './LangProvider'
import { apiFetch, STAFF_CTX } from '@/lib/api'

const BANNER_H = 40
const STORAGE_KEY = 'work-mode'

type Ctx = {
  realRole: string
  effectiveRole: string
  isOwnerInStaffMode: boolean
  tier: string
  enterStaffMode: () => void
  exitStaffMode: () => void
}

const WorkModeContext = createContext<Ctx>({
  realRole: 'STAFF',
  effectiveRole: 'STAFF',
  isOwnerInStaffMode: false,
  tier: 'LITE',
  enterStaffMode() {},
  exitStaffMode() {},
})

export function useWorkMode() {
  return useContext(WorkModeContext)
}

export default function WorkModeProvider({ role, children }: { role: string; children: ReactNode }) {
  const { t } = useLocale()
  const router = useRouter()
  const [workMode, setWorkMode] = useState<'owner' | 'staff'>('owner')
  const [tier, setTier] = useState('LITE')

  useEffect(() => {
    if (role === 'OWNER' && localStorage.getItem(STORAGE_KEY) === 'staff') {
      setWorkMode('staff')
    }
  }, [role])

  useEffect(() => {
    apiFetch('/api/me', undefined, STAFF_CTX)
      .then((r) => (r.ok ? r.json() : { tier: 'LITE' }))
      .then((d) => setTier(d.tier ?? 'LITE'))
      .catch(() => {})
  }, [])

  const isOwnerInStaffMode = role === 'OWNER' && workMode === 'staff'
  const effectiveRole = isOwnerInStaffMode ? 'STAFF' : role

  function enterStaffMode() {
    setWorkMode('staff')
    localStorage.setItem(STORAGE_KEY, 'staff')
    router.push('/home')
  }

  function exitStaffMode() {
    setWorkMode('owner')
    localStorage.removeItem(STORAGE_KEY)
    router.push('/sale')
  }

  return (
    <WorkModeContext.Provider value={{ realRole: role, effectiveRole, isOwnerInStaffMode, tier, enterStaffMode, exitStaffMode }}>
      {isOwnerInStaffMode && (
        <>
          <div style={bannerStyle}>
            <span>{t('home.staffModeBanner')}</span>
            <button style={exitBtnStyle} onClick={exitStaffMode}>
              {t('home.exitStaffMode')}
            </button>
          </div>
          <div style={{ height: BANNER_H }} />
        </>
      )}
      {children}
    </WorkModeContext.Provider>
  )
}

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  height: BANNER_H,
  zIndex: 999,
  background: '#fa8c16',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 16px',
  fontSize: 13,
  fontWeight: 600,
}

const exitBtnStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.25)',
  border: 'none',
  color: '#fff',
  padding: '4px 12px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 600,
}

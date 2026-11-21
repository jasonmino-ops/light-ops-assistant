// Test-only browser harness. Not an application route or Production entry.
import { createRoot } from 'react-dom/client'
import DiamondRecoveryAction from '../../app/cashier/components/DiamondRecoveryAction'
const fixture = window as unknown as { recoveryHold: { id: string; storeCode: string; createdAt: string; cart: unknown[] }; recoveryIdle: boolean }
createRoot(document.getElementById('root')!).render(<DiamondRecoveryAction order={fixture.recoveryHold} lang="zh" idle={fixture.recoveryIdle} />)

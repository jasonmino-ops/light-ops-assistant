export type UnifiedTerminalIdentityKind = 'DESKTOP_DEVICE' | 'LEGACY_COMPUTER_BINDING'
export type UnifiedTerminalStatus = 'ACTIVE' | 'DISABLED' | 'REVOKED' | 'EXPIRED'
export type UnifiedPosSessionState = 'ACTIVE' | 'NOT_ESTABLISHED' | 'EXPIRED'

export type UnifiedTerminal = {
  terminalId: string
  identityKind: UnifiedTerminalIdentityKind
  displayName: string
  storeId: string
  status: UnifiedTerminalStatus
  activationState: UnifiedTerminalStatus
  activatedAt: string
  lastSeenAt: string | null
  credentialExpiresAt: string | null
  legacyComputerId: string | null
  agentVersion: string | null
  posSession: {
    state: UnifiedPosSessionState
    expiresAt: string | null
    lastSeenAt: string | null
  } | null
  legalActions: {
    disable: boolean
    revoke: boolean
  }
}

type PosSessionRow = {
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED'
  activeSlot: string | null
  tokenExpiresAt: Date
  lastSeenAt: Date | null
}

function sessionState(row: PosSessionRow | undefined, now: Date): UnifiedTerminal['posSession'] {
  if (!row) return { state: 'NOT_ESTABLISHED', expiresAt: null, lastSeenAt: null }
  if (row.status === 'ACTIVE' && row.activeSlot === 'ACTIVE' && row.tokenExpiresAt > now) {
    return {
      state: 'ACTIVE',
      expiresAt: row.tokenExpiresAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    }
  }
  return {
    state: 'EXPIRED',
    expiresAt: row.tokenExpiresAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  }
}

export function buildUnifiedTerminalView(input: {
  now: Date
  desktopDevices: Array<{
    id: string
    storeId: string
    status: 'ACTIVE' | 'REVOKED'
    activeSlot: string | null
    tokenExpiresAt: Date
    lastSeenAt: Date | null
    activatedAt: Date
  }>
  legacyBindings: Array<{
    id: string
    storeId: string
    computerName: string
    agentVersion: string | null
    credentialStatus: 'PENDING' | 'ACTIVE' | 'VOID'
    credentialExpiresAt: Date | null
    boundAt: Date | null
    lastSeenAt: Date | null
    disabledAt: Date | null
  }>
  posSessions: Map<string, PosSessionRow>
}): UnifiedTerminal[] {
  const { now } = input
  const desktop = input.desktopDevices.map((device): UnifiedTerminal => {
    const active = device.status === 'ACTIVE'
      && device.activeSlot === 'ACTIVE'
      && device.tokenExpiresAt > now
    const status: UnifiedTerminalStatus = device.status === 'REVOKED'
      ? 'REVOKED'
      : active ? 'ACTIVE' : 'EXPIRED'
    return {
      terminalId: `desktop:${device.id}`,
      identityKind: 'DESKTOP_DEVICE',
      displayName: 'E-Shop Desktop',
      storeId: device.storeId,
      status,
      activationState: status,
      activatedAt: device.activatedAt.toISOString(),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      credentialExpiresAt: device.tokenExpiresAt.toISOString(),
      legacyComputerId: null,
      agentVersion: null,
      posSession: sessionState(input.posSessions.get(`desktop-${device.id}`), now),
      legalActions: { disable: false, revoke: status !== 'REVOKED' },
    }
  })

  const legacy = input.legacyBindings.map((binding): UnifiedTerminal => {
    const active = binding.disabledAt === null
      && binding.credentialStatus === 'ACTIVE'
      && (binding.credentialExpiresAt === null || binding.credentialExpiresAt > now)
    const status: UnifiedTerminalStatus = binding.disabledAt
      ? 'DISABLED'
      : active ? 'ACTIVE' : 'EXPIRED'
    return {
      terminalId: `legacy:${binding.id}`,
      identityKind: 'LEGACY_COMPUTER_BINDING',
      displayName: binding.computerName,
      storeId: binding.storeId,
      status,
      activationState: status,
      activatedAt: binding.boundAt?.toISOString() ?? binding.disabledAt?.toISOString() ?? now.toISOString(),
      lastSeenAt: binding.lastSeenAt?.toISOString() ?? null,
      credentialExpiresAt: binding.credentialExpiresAt?.toISOString() ?? null,
      legacyComputerId: binding.id,
      agentVersion: binding.agentVersion,
      posSession: null,
      legalActions: { disable: status === 'ACTIVE', revoke: false },
    }
  })

  return [...desktop, ...legacy].sort((a, b) => b.activatedAt.localeCompare(a.activatedAt))
}

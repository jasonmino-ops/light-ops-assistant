import { NextRequest, NextResponse } from 'next/server'
import { inventoryTelegramPerson } from '@/lib/native-inventory/access'
import {
  approveDesktopOperatorPairing, beginDesktopOperatorPairing, desktopOperatorClaim, endDesktopOperatorPairing, inventoryDesktopDevice, inventoryEnabledForDevice,
} from '@/lib/native-inventory/desktop-operator'
import { InventoryError } from '@/lib/native-inventory/input'
import { nativeInventoryAvailable } from '@/lib/native-inventory/rollout'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  if (!nativeInventoryAvailable()) return NextResponse.json({ enabled: false }, { headers })
  try {
    const enabled = await inventoryEnabledForDevice(await inventoryDesktopDevice(req))
    return NextResponse.json({ enabled }, { headers })
  } catch (error) {
    const status = error instanceof InventoryError ? error.status : 500
    return NextResponse.json({ enabled: false }, { status, headers })
  }
}

export async function POST(req: NextRequest) {
  if (!nativeInventoryAvailable()) return NextResponse.json({ error: 'NATIVE_INVENTORY_DISABLED' }, { status: 403, headers })
  try {
    const body = await req.json().catch(() => null)
    if (body?.action === 'approve') {
      const person = await inventoryTelegramPerson(req)
      await approveDesktopOperatorPairing(body.code, person)
      return NextResponse.json({ state: 'APPROVED' }, { headers })
    }
    if (body?.action === 'begin') {
      const device = await inventoryDesktopDevice(req)
      return NextResponse.json(await beginDesktopOperatorPairing(device), { headers })
    }
    if (body?.action === 'end') {
      const device = await inventoryDesktopDevice(req)
      await endDesktopOperatorPairing(req, device)
      return NextResponse.json({ state: 'ENDED' }, { headers })
    }
    if (body?.action === 'status') {
      const device = await inventoryDesktopDevice(req)
      const operator = await desktopOperatorClaim(req, device)
      return NextResponse.json({ state: operator ? 'APPROVED' : 'PENDING' }, { headers })
    }
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.code }, { status: error.status, headers })
    }
    console.error('[inventory desktop operator] request failed')
    return NextResponse.json({ error: 'INVENTORY_UNAVAILABLE' }, { status: 500, headers })
  }
}

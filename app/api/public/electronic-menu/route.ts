import { NextRequest, NextResponse } from 'next/server'
import { isValidMenuCode, projectElectronicMenuData } from '@/lib/electronic-menu'
import { loadPublicMenuCatalog } from '@/lib/public-menu-data'

const headers = { 'Cache-Control': 'no-store' }

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const codes = params.getAll('code')
  if (codes.length !== 1 || !isValidMenuCode(codes[0]) || Array.from(params.keys()).some((key) => key !== 'code')) {
    return NextResponse.json({ error: 'INVALID_REQUEST' }, { status: 400, headers })
  }

  try {
    const data = await loadPublicMenuCatalog(codes[0])
    if (!data) return NextResponse.json({ error: 'STORE_NOT_FOUND' }, { status: 404, headers })
    return NextResponse.json(projectElectronicMenuData(data), { headers })
  } catch {
    return NextResponse.json({ error: 'MENU_UNAVAILABLE' }, { status: 503, headers })
  }
}

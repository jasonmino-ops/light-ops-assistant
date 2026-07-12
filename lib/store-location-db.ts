import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  StoreLocationFields,
  StoreLocationPatch,
  StoreLocationRow,
  emptyStoreLocation,
  isMissingStoreLocationColumnError,
  toStoreLocationFields,
} from '@/lib/store-location'

export const STORE_LOCATION_SCHEMA_UPGRADE_MESSAGE = '门店位置尚未完成数据库升级，请联系管理员。'

export class StoreLocationSchemaUpgradeRequiredError extends Error {
  constructor() {
    super(STORE_LOCATION_SCHEMA_UPGRADE_MESSAGE)
    this.name = 'StoreLocationSchemaUpgradeRequiredError'
  }
}

export function isStoreLocationSchemaUpgradeRequiredError(error: unknown): error is StoreLocationSchemaUpgradeRequiredError {
  return error instanceof StoreLocationSchemaUpgradeRequiredError
}

export async function getStoreLocationsByIds(ids: string[]): Promise<Map<string, StoreLocationFields>> {
  if (ids.length === 0) return new Map()
  try {
    const rows = await prisma.$queryRaw<StoreLocationRow[]>(Prisma.sql`
      SELECT "id", "storeAddress", "storeLat", "storeLng"
      FROM "Store"
      WHERE "id" IN (${Prisma.join(ids)})
    `)
    return new Map(rows.map((row) => [row.id, toStoreLocationFields(row)]))
  } catch (error) {
    if (isMissingStoreLocationColumnError(error)) return new Map()
    throw error
  }
}

export async function getStoreLocationById(id: string): Promise<StoreLocationFields> {
  return (await getStoreLocationsByIds([id])).get(id) ?? emptyStoreLocation()
}

export async function updateStoreLocationById(id: string, location: StoreLocationPatch): Promise<StoreLocationFields> {
  const assignments = []
  if (location.storeAddress !== undefined) {
    assignments.push(Prisma.sql`"storeAddress" = ${location.storeAddress}`)
  }
  if (location.storeLat !== undefined) {
    assignments.push(Prisma.sql`"storeLat" = ${location.storeLat}`)
  }
  if (location.storeLng !== undefined) {
    assignments.push(Prisma.sql`"storeLng" = ${location.storeLng}`)
  }
  if (assignments.length === 0) return getStoreLocationById(id)

  try {
    const rows = await prisma.$queryRaw<StoreLocationRow[]>(Prisma.sql`
      UPDATE "Store"
      SET ${Prisma.join(assignments)}
      WHERE "id" = ${id}
      RETURNING "id", "storeAddress", "storeLat", "storeLng"
    `)
    const row = rows[0]
    return row ? toStoreLocationFields(row) : emptyStoreLocation()
  } catch (error) {
    if (isMissingStoreLocationColumnError(error)) throw new StoreLocationSchemaUpgradeRequiredError()
    throw error
  }
}

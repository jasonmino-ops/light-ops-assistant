import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  StoreContactFields,
  StoreContactRow,
  emptyStoreContact,
  isMissingStoreContactColumnError,
} from '@/lib/store-contact'

export const STORE_CONTACT_SCHEMA_UPGRADE_MESSAGE = '门店联系方式尚未完成数据库升级，请联系管理员。'

export class StoreContactSchemaUpgradeRequiredError extends Error {
  constructor() {
    super(STORE_CONTACT_SCHEMA_UPGRADE_MESSAGE)
    this.name = 'StoreContactSchemaUpgradeRequiredError'
  }
}

export function isStoreContactSchemaUpgradeRequiredError(error: unknown): error is StoreContactSchemaUpgradeRequiredError {
  return error instanceof StoreContactSchemaUpgradeRequiredError
}

export async function getStoreContactsByIds(ids: string[]): Promise<Map<string, StoreContactFields>> {
  if (ids.length === 0) return new Map()
  try {
    const rows = await prisma.$queryRaw<StoreContactRow[]>(Prisma.sql`
      SELECT "id", "contactPhone", "contactTelegram", "contactWhatsApp"
      FROM "Store"
      WHERE "id" IN (${Prisma.join(ids)})
    `)
    return new Map(rows.map((row) => [row.id, {
      contactPhone: row.contactPhone ?? null,
      contactTelegram: row.contactTelegram ?? null,
      contactWhatsApp: row.contactWhatsApp ?? null,
    }]))
  } catch (error) {
    if (isMissingStoreContactColumnError(error)) return new Map()
    throw error
  }
}

export async function getStoreContactById(id: string): Promise<StoreContactFields> {
  return (await getStoreContactsByIds([id])).get(id) ?? emptyStoreContact()
}

export async function updateStoreContactById(id: string, contact: Partial<StoreContactFields>): Promise<StoreContactFields> {
  const assignments = []
  if (contact.contactPhone !== undefined) {
    assignments.push(Prisma.sql`"contactPhone" = ${contact.contactPhone}`)
  }
  if (contact.contactTelegram !== undefined) {
    assignments.push(Prisma.sql`"contactTelegram" = ${contact.contactTelegram}`)
  }
  if (contact.contactWhatsApp !== undefined) {
    assignments.push(Prisma.sql`"contactWhatsApp" = ${contact.contactWhatsApp}`)
  }
  if (assignments.length === 0) return getStoreContactById(id)

  try {
    const rows = await prisma.$queryRaw<StoreContactRow[]>(Prisma.sql`
      UPDATE "Store"
      SET ${Prisma.join(assignments)}
      WHERE "id" = ${id}
      RETURNING "id", "contactPhone", "contactTelegram", "contactWhatsApp"
    `)
    const row = rows[0]
    return row ? {
      contactPhone: row.contactPhone ?? null,
      contactTelegram: row.contactTelegram ?? null,
      contactWhatsApp: row.contactWhatsApp ?? null,
    } : emptyStoreContact()
  } catch (error) {
    if (isMissingStoreContactColumnError(error)) throw new StoreContactSchemaUpgradeRequiredError()
    throw error
  }
}

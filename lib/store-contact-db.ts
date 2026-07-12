import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  StoreContactFields,
  StoreContactRow,
  emptyStoreContact,
  isMissingStoreContactColumnError,
} from '@/lib/store-contact'

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

export async function updateStoreContactById(id: string, contact: StoreContactFields): Promise<StoreContactFields> {
  try {
    const rows = await prisma.$queryRaw<StoreContactRow[]>(Prisma.sql`
      UPDATE "Store"
      SET
        "contactPhone" = ${contact.contactPhone},
        "contactTelegram" = ${contact.contactTelegram},
        "contactWhatsApp" = ${contact.contactWhatsApp}
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
    if (isMissingStoreContactColumnError(error)) return emptyStoreContact()
    throw error
  }
}

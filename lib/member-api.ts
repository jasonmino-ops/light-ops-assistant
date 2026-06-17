import { Prisma } from "@prisma/client";

export const MEMBER_SELECT = {
  id: true,
  tenantId: true,
  storeId: true,
  memberCode: true,
  name: true,
  phone: true,
  normalizedPhone: true,
  telegramId: true,
  telegramUsername: true,
  balance: true,
  status: true,
  note: true,
  importBatchId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MemberSelect;

export const MEMBER_LEDGER_SELECT = {
  id: true,
  type: true,
  sourceType: true,
  sourceId: true,
  amount: true,
  balanceBefore: true,
  balanceAfter: true,
  operatorUserId: true,
  note: true,
  createdAt: true,
} satisfies Prisma.MemberBalanceLedgerSelect;

export function serializeMember(member: Prisma.MemberGetPayload<{ select: typeof MEMBER_SELECT }>) {
  return {
    ...member,
    balance: member.balance.toString(),
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  };
}

export function serializeLedger(
  ledger: Prisma.MemberBalanceLedgerGetPayload<{ select: typeof MEMBER_LEDGER_SELECT }>,
) {
  return {
    ...ledger,
    amount: ledger.amount.toString(),
    balanceBefore: ledger.balanceBefore.toString(),
    balanceAfter: ledger.balanceAfter.toString(),
    createdAt: ledger.createdAt.toISOString(),
  };
}

export function parseDecimalAmount(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value.trim() : String(value);
  if (!raw) return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) return null;

  try {
    return new Prisma.Decimal(raw);
  } catch {
    return null;
  }
}

export async function generateMemberCode(
  tx: Prisma.TransactionClient,
  tenantId: string,
  storeId: string,
): Promise<string> {
  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");

  for (let i = 0; i < 10; i++) {
    const randomPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `M${datePart}${randomPart}`;
    const existing = await tx.member.findFirst({
      where: { tenantId, storeId, memberCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }

  return `M${datePart}${Date.now().toString(36).toUpperCase()}`;
}

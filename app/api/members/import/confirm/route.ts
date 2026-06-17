import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import { generateMemberCode, MEMBER_LEDGER_SELECT, MEMBER_SELECT, serializeLedger, serializeMember } from "@/lib/member-api";
import {
  buildImportNote,
  createImportBatchId,
  ExistingMemberConflict,
  MemberImportPreviewRow,
  normalizeImportRows,
  summarizeImportRows,
} from "@/lib/member-import";

const MAX_IMPORT_ROWS = 2000;

type ConfirmBody = {
  rows?: MemberImportPreviewRow[];
};

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let body: ConfirmBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const submittedRows = Array.isArray(body.rows) ? body.rows : [];
  if (submittedRows.length === 0) return NextResponse.json({ error: "EMPTY_ROWS" }, { status: 400 });
  if (submittedRows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: "TOO_MANY_ROWS", maxRows: MAX_IMPORT_ROWS }, { status: 400 });
  }

  const rawRows = submittedRows.map((row) => ({
    rowNum: Number.isInteger(row.rowNum) ? row.rowNum : 0,
    name: row.name,
    phone: row.phone,
    balance: row.balance,
    note: row.note,
    joinedAt: row.joinedAtRaw,
  }));

  const initialRows = normalizeImportRows(rawRows, new Map());
  const normalizedPhones = Array.from(
    new Set(initialRows.map((row) => row.normalizedPhone).filter(Boolean) as string[]),
  );

  const existingMembers = normalizedPhones.length
    ? await prisma.member.findMany({
        where: {
          tenantId: ctx.tenantId,
          storeId: ctx.storeId,
          normalizedPhone: { in: normalizedPhones },
        },
        select: { id: true, memberCode: true, normalizedPhone: true },
      })
    : [];

  const existingByPhone = new Map<string, ExistingMemberConflict>();
  for (const member of existingMembers) {
    if (member.normalizedPhone) {
      existingByPhone.set(member.normalizedPhone, {
        normalizedPhone: member.normalizedPhone,
        memberId: member.id,
        memberCode: member.memberCode,
      });
    }
  }

  const validatedRows = normalizeImportRows(rawRows, existingByPhone);
  const importableRows = validatedRows.filter((row) => row.canImport);
  if (importableRows.length === 0) {
    return NextResponse.json({
      error: "NO_IMPORTABLE_ROWS",
      summary: summarizeImportRows(validatedRows),
      rows: validatedRows,
    }, { status: 400 });
  }

  const importBatchId = createImportBatchId();
  const imported: Array<{
    rowNum: number;
    member: ReturnType<typeof serializeMember>;
    ledger: ReturnType<typeof serializeLedger>;
  }> = [];
  const failed: Array<{ rowNum: number; error: string }> = [];

  for (const row of importableRows) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        if (row.normalizedPhone) {
          const existing = await tx.member.findFirst({
            where: { tenantId: ctx.tenantId, storeId: ctx.storeId, normalizedPhone: row.normalizedPhone },
            select: { id: true },
          });
          if (existing) throw new Error("MEMBER_PHONE_EXISTS");
        }

        const balance = new Prisma.Decimal(row.balance);
        const memberCode = await generateMemberCode(tx, ctx.tenantId, ctx.storeId);
        const member = await tx.member.create({
          data: {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            memberCode,
            name: row.name || "未命名会员",
            phone: row.phone || null,
            normalizedPhone: row.normalizedPhone || null,
            balance,
            status: "ACTIVE",
            note: buildImportNote(row.note, row.joinedAtRaw),
            importBatchId,
          },
          select: MEMBER_SELECT,
        });

        const ledger = await tx.memberBalanceLedger.create({
          data: {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            memberId: member.id,
            type: "IMPORT",
            sourceType: "IMPORT",
            sourceId: importBatchId,
            amount: balance,
            balanceBefore: new Prisma.Decimal(0),
            balanceAfter: balance,
            operatorUserId: ctx.userId || null,
            note: `旧 POS 会员导入 · ${importBatchId}`,
          },
          select: MEMBER_LEDGER_SELECT,
        });

        return { member, ledger };
      });

      imported.push({
        rowNum: row.rowNum,
        member: serializeMember(result.member),
        ledger: serializeLedger(result.ledger),
      });
    } catch (err) {
      failed.push({
        rowNum: row.rowNum,
        error: err instanceof Error ? err.message : "IMPORT_FAILED",
      });
    }
  }

  return NextResponse.json({
    importBatchId,
    importedCount: imported.length,
    failedCount: failed.length,
    skippedCount: validatedRows.length - importableRows.length,
    imported,
    failed,
    summary: summarizeImportRows(validatedRows),
    rows: validatedRows,
  });
}

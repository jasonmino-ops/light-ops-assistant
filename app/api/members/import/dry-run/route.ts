import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import {
  ExistingMemberConflict,
  mapExcelRow,
  normalizeImportRows,
  summarizeImportRows,
} from "@/lib/member-import";

const MAX_ROWS = 2000;

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let file: File | null = null;
  try {
    const formData = await req.formData();
    const value = formData.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "INVALID_FORM_DATA" }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "MISSING_FILE" }, { status: 400 });

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls")) {
    return NextResponse.json({ error: "UNSUPPORTED_FILE_TYPE" }, { status: 400 });
  }

  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return NextResponse.json({ error: "EMPTY_FILE" }, { status: 400 });
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  } catch {
    return NextResponse.json({ error: "PARSE_FAILED" }, { status: 400 });
  }

  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: "TOO_MANY_ROWS", maxRows: MAX_ROWS }, { status: 400 });
  }

  const rawRows = rows.map((row, index) => mapExcelRow(row, index + 2));
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

  const previewRows = normalizeImportRows(rawRows, existingByPhone);
  return NextResponse.json({
    summary: summarizeImportRows(previewRows),
    rows: previewRows,
  });
}

import { Prisma } from "@prisma/client";
import { normalizeMemberPhone } from "@/lib/member-phone";

export type MemberImportRawRow = {
  rowNum: number;
  name?: unknown;
  phone?: unknown;
  balance?: unknown;
  note?: unknown;
  joinedAt?: unknown;
};

export type MemberImportPreviewRow = {
  rowNum: number;
  name: string;
  phone: string | null;
  normalizedPhone: string | null;
  balance: string;
  note: string | null;
  joinedAtRaw: string | null;
  errors: string[];
  warnings: string[];
  canImport: boolean;
};

export type MemberImportSummary = {
  totalRows: number;
  importableCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
  totalImportBalance: string;
};

export type ExistingMemberConflict = {
  normalizedPhone: string;
  memberId: string;
  memberCode: string;
};

const HEADER_ALIASES = {
  name: ["姓名", "会员姓名", "name", "Name"],
  phone: ["手机号", "手机", "电话", "phone", "Phone", "mobile", "Mobile"],
  balance: ["储值余额", "余额", "balance", "Balance"],
  note: ["备注", "note", "Note"],
  joinedAt: ["加入时间", "加入日期", "createdAt", "joinedAt", "JoinedAt"],
} as const;

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function findCell(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }

  const lowerMap = new Map(Object.keys(row).map((key) => [key.trim().toLowerCase(), key]));
  for (const alias of aliases) {
    const key = lowerMap.get(alias.trim().toLowerCase());
    if (key) return row[key];
  }
  return undefined;
}

export function mapExcelRow(row: Record<string, unknown>, rowNum: number): MemberImportRawRow {
  return {
    rowNum,
    name: findCell(row, HEADER_ALIASES.name),
    phone: findCell(row, HEADER_ALIASES.phone),
    balance: findCell(row, HEADER_ALIASES.balance),
    note: findCell(row, HEADER_ALIASES.note),
    joinedAt: findCell(row, HEADER_ALIASES.joinedAt),
  };
}

export function parseImportBalance(value: unknown): Prisma.Decimal | null {
  const raw = stringifyCell(value);
  if (!raw) return new Prisma.Decimal(0);
  const cleaned = raw.replace(/\$/g, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  try {
    return new Prisma.Decimal(cleaned);
  } catch {
    return null;
  }
}

export function normalizeImportRows(
  rawRows: MemberImportRawRow[],
  existingByPhone: Map<string, ExistingMemberConflict>,
): MemberImportPreviewRow[] {
  const normalizedCounts = new Map<string, number>();

  const baseRows = rawRows.map((row) => {
    const name = stringifyCell(row.name) || "未命名会员";
    const phone = stringifyCell(row.phone) || null;
    const normalizedPhone = normalizeMemberPhone(phone) || null;
    const note = stringifyCell(row.note) || null;
    const joinedAtRaw = stringifyCell(row.joinedAt) || null;
    const balance = parseImportBalance(row.balance);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!balance) errors.push("储值余额格式不正确");
    if (!normalizedPhone) warnings.push("无手机号，后续收银台无法通过手机号识别");
    if (normalizedPhone) normalizedCounts.set(normalizedPhone, (normalizedCounts.get(normalizedPhone) ?? 0) + 1);

    return {
      rowNum: row.rowNum,
      name,
      phone,
      normalizedPhone,
      balance: balance ? balance.toFixed(2) : "0.00",
      note,
      joinedAtRaw,
      errors,
      warnings,
      canImport: false,
    };
  });

  return baseRows.map((row) => {
    const errors = [...row.errors];
    if (row.normalizedPhone && (normalizedCounts.get(row.normalizedPhone) ?? 0) > 1) {
      errors.push("同一批次手机号重复");
    }
    if (row.normalizedPhone && existingByPhone.has(row.normalizedPhone)) {
      const existing = existingByPhone.get(row.normalizedPhone);
      errors.push(`该手机号会员已存在${existing?.memberCode ? `（${existing.memberCode}）` : ""}`);
    }
    return {
      ...row,
      errors,
      canImport: errors.length === 0,
    };
  });
}

export function summarizeImportRows(rows: MemberImportPreviewRow[]): MemberImportSummary {
  const totalImportBalance = rows.reduce((sum, row) => {
    if (!row.canImport) return sum;
    return sum.plus(new Prisma.Decimal(row.balance || "0"));
  }, new Prisma.Decimal(0));

  return {
    totalRows: rows.length,
    importableCount: rows.filter((row) => row.canImport).length,
    skippedCount: rows.filter((row) => !row.canImport).length,
    errorCount: rows.filter((row) => row.errors.length > 0).length,
    warningCount: rows.filter((row) => row.warnings.length > 0).length,
    totalImportBalance: totalImportBalance.toFixed(2),
  };
}

export function createImportBatchId(): string {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `IMPORT-${date}-${random}`;
}

export function buildImportNote(note: string | null, joinedAtRaw: string | null): string | null {
  const parts = [note?.trim(), joinedAtRaw ? `旧 POS 加入时间：${joinedAtRaw}` : ""].filter(Boolean);
  return parts.length ? parts.join("\n") : null;
}

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import { normalizeMemberPhone } from "@/lib/member-phone";
import { generateMemberCode, MEMBER_SELECT, serializeMember } from "@/lib/member-api";

function parsePage(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const statusParam = req.nextUrl.searchParams.get("status")?.trim().toUpperCase() ?? "ACTIVE";
  const page = parsePage(req.nextUrl.searchParams.get("page"), 1);
  const pageSize = Math.min(parsePage(req.nextUrl.searchParams.get("pageSize"), 20), 100);

  if (!["ACTIVE", "INACTIVE", "ALL"].includes(statusParam)) {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
  }

  const normalizedQuery = normalizeMemberPhone(q);
  const where: Prisma.MemberWhereInput = {
    tenantId: ctx.tenantId,
    storeId: ctx.storeId,
    ...(statusParam === "ALL" ? {} : { status: statusParam as "ACTIVE" | "INACTIVE" }),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { memberCode: { contains: q, mode: "insensitive" } },
            ...(normalizedQuery ? [{ normalizedPhone: { contains: normalizedQuery } }] : []),
          ],
        }
      : {}),
  };

  const [total, members] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({
      where,
      select: MEMBER_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return NextResponse.json({
    items: members.map(serializeMember),
    pagination: { page, pageSize, total },
  });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  let body: {
    name?: string;
    phone?: string | null;
    telegramId?: string | null;
    telegramUsername?: string | null;
    note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "MISSING_NAME" }, { status: 400 });

  const phone = body.phone?.trim() || null;
  const normalizedPhone = normalizeMemberPhone(phone);

  if (normalizedPhone) {
    const existing = await prisma.member.findFirst({
      where: { tenantId: ctx.tenantId, storeId: ctx.storeId, normalizedPhone },
      select: { id: true, memberCode: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "MEMBER_PHONE_EXISTS", memberId: existing.id, memberCode: existing.memberCode },
        { status: 409 },
      );
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const memberCode = await generateMemberCode(tx, ctx.tenantId, ctx.storeId);
    return tx.member.create({
      data: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        memberCode,
        name,
        phone,
        normalizedPhone: normalizedPhone || null,
        telegramId: body.telegramId?.trim() || null,
        telegramUsername: body.telegramUsername?.trim() || null,
        note: body.note?.trim() || null,
        balance: "0",
        status: "ACTIVE",
      },
      select: MEMBER_SELECT,
    });
  });

  return NextResponse.json({ member: serializeMember(created) }, { status: 201 });
}

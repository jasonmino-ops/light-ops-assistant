import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import { publicUrl } from "@/lib/public-url";
import {
  generateMemberTelegramBindRawToken,
  getMemberTelegramBindExpiresAt,
  hashMemberTelegramBindToken,
} from "@/lib/member-telegram-bind";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  const member = await prisma.member.findFirst({
    where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
    select: { id: true },
  });
  if (!member) return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });

  const rawToken = generateMemberTelegramBindRawToken();
  const tokenHash = hashMemberTelegramBindToken(rawToken);
  const expiresAt = getMemberTelegramBindExpiresAt();
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.memberTelegramBindToken.updateMany({
      where: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        memberId: member.id,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });

    await tx.memberTelegramBindToken.create({
      data: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        memberId: member.id,
        tokenHash,
        expiresAt,
        createdByUserId: ctx.userId,
      },
    });
  });

  const bindPath = `/telegram/member-bind?token=${encodeURIComponent(rawToken)}`;

  return NextResponse.json({
    rawToken,
    expiresAt: expiresAt.toISOString(),
    bindUrl: publicUrl(bindPath, req.nextUrl.origin),
  });
}

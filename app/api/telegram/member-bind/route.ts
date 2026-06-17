import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractTgUserIdFromParams, verifyTgInitData } from "@/lib/verify-tg-init-data";
import {
  extractTelegramUsernameFromParams,
  hashMemberTelegramBindToken,
  isTelegramAuthDateFresh,
  isValidMemberTelegramBindToken,
  maskMemberName,
  maskMemberPhone,
} from "@/lib/member-telegram-bind";

function tokenError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function findValidToken(rawToken: string) {
  const tokenHash = hashMemberTelegramBindToken(rawToken);
  return prisma.memberTelegramBindToken.findUnique({
    where: { tokenHash },
    include: {
      member: {
        select: {
          id: true,
          tenantId: true,
          storeId: true,
          memberCode: true,
          name: true,
          phone: true,
          telegramId: true,
          telegramUsername: true,
        },
      },
      store: { select: { id: true, name: true } },
    },
  });
}

export async function GET(req: NextRequest) {
  const rawToken = req.nextUrl.searchParams.get("token");
  if (!isValidMemberTelegramBindToken(rawToken)) return tokenError("INVALID_TOKEN");

  const token = await findValidToken(rawToken);
  if (!token) return tokenError("TOKEN_NOT_FOUND", 404);
  if (token.usedAt) return tokenError("TOKEN_USED");
  if (token.expiresAt <= new Date()) return tokenError("TOKEN_EXPIRED");
  if (!token.member || token.member.tenantId !== token.tenantId || token.member.storeId !== token.storeId) {
    return tokenError("MEMBER_NOT_FOUND", 404);
  }

  return NextResponse.json({
    storeName: token.store.name,
    memberNameMasked: maskMemberName(token.member.name),
    phoneMasked: maskMemberPhone(token.member.phone),
    memberCode: token.member.memberCode,
    alreadyBound: Boolean(token.member.telegramId),
    expiresAt: token.expiresAt.toISOString(),
  });
}

export async function POST(req: NextRequest) {
  let body: { token?: unknown; initData?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const rawToken = typeof body.token === "string" ? body.token : null;
  const initData = typeof body.initData === "string" ? body.initData : null;
  if (!isValidMemberTelegramBindToken(rawToken)) return tokenError("INVALID_TOKEN");
  if (!initData) return NextResponse.json({ error: "INVALID_TELEGRAM_INIT_DATA" }, { status: 400 });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN_NOT_CONFIGURED" }, { status: 500 });
  }

  const token = await findValidToken(rawToken);
  if (!token) return tokenError("TOKEN_NOT_FOUND", 404);
  if (token.usedAt) return tokenError("TOKEN_USED");
  if (token.expiresAt <= new Date()) return tokenError("TOKEN_EXPIRED");
  if (!token.member || token.member.tenantId !== token.tenantId || token.member.storeId !== token.storeId) {
    return tokenError("MEMBER_NOT_FOUND", 404);
  }

  const verifiedParams = verifyTgInitData(initData, botToken);
  if (!verifiedParams || !isTelegramAuthDateFresh(verifiedParams)) {
    return NextResponse.json({ error: "INVALID_TELEGRAM_INIT_DATA" }, { status: 401 });
  }

  const telegramId = extractTgUserIdFromParams(verifiedParams);
  if (!telegramId) return NextResponse.json({ error: "MISSING_TELEGRAM_USER" }, { status: 400 });
  const telegramUsername = extractTelegramUsernameFromParams(verifiedParams);

  if (token.member.telegramId) {
    if (token.member.telegramId === telegramId) {
      if (!token.usedAt) {
        await prisma.memberTelegramBindToken.update({
          where: { id: token.id },
          data: { usedAt: new Date() },
        });
      }
      return NextResponse.json({
        ok: true,
        status: "ALREADY_BOUND",
        memberCode: token.member.memberCode,
      });
    }
    return NextResponse.json({ error: "MEMBER_ALREADY_BOUND" }, { status: 409 });
  }

  const existingTelegramMember = await prisma.member.findFirst({
    where: {
      tenantId: token.tenantId,
      storeId: token.storeId,
      telegramId,
      id: { not: token.memberId },
    },
    select: { id: true },
  });
  if (existingTelegramMember) {
    return NextResponse.json({ error: "TELEGRAM_ALREADY_BOUND_OTHER_MEMBER" }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const freshToken = await tx.memberTelegramBindToken.findUnique({
        where: { id: token.id },
        select: { id: true, usedAt: true, expiresAt: true, memberId: true, tenantId: true, storeId: true },
      });
      if (!freshToken) throw new Error("TOKEN_NOT_FOUND");
      if (freshToken.usedAt) throw new Error("TOKEN_USED");
      if (freshToken.expiresAt <= new Date()) throw new Error("TOKEN_EXPIRED");

      const freshMember = await tx.member.findFirst({
        where: {
          id: freshToken.memberId,
          tenantId: freshToken.tenantId,
          storeId: freshToken.storeId,
        },
        select: { id: true, memberCode: true, telegramId: true },
      });
      if (!freshMember) throw new Error("MEMBER_NOT_FOUND");
      if (freshMember.telegramId && freshMember.telegramId !== telegramId) {
        throw new Error("MEMBER_ALREADY_BOUND");
      }

      await tx.member.update({
        where: { id: freshMember.id },
        data: { telegramId, telegramUsername },
      });
      await tx.memberTelegramBindToken.update({
        where: { id: freshToken.id },
        data: { usedAt: new Date() },
      });

      return { memberCode: freshMember.memberCode };
    });

    return NextResponse.json({
      ok: true,
      status: "BOUND",
      memberCode: result.memberCode,
    });
  } catch (err) {
    if (err instanceof Error) {
      const known = new Set([
        "TOKEN_NOT_FOUND",
        "TOKEN_USED",
        "TOKEN_EXPIRED",
        "MEMBER_NOT_FOUND",
        "MEMBER_ALREADY_BOUND",
      ]);
      if (known.has(err.message)) {
        const status = err.message === "TOKEN_NOT_FOUND" || err.message === "MEMBER_NOT_FOUND" ? 404 : 400;
        return NextResponse.json({ error: err.message }, { status });
      }
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "TELEGRAM_ALREADY_BOUND_OTHER_MEMBER" }, { status: 409 });
    }
    console.error("[POST /api/telegram/member-bind]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

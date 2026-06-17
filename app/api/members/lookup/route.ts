import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import { normalizeMemberPhone } from "@/lib/member-phone";
import { MEMBER_SELECT, serializeMember } from "@/lib/member-api";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });

  const phone = req.nextUrl.searchParams.get("phone")?.trim() ?? "";
  const normalizedPhone = normalizeMemberPhone(phone);
  if (!normalizedPhone) {
    return NextResponse.json({ error: "INVALID_PHONE" }, { status: 400 });
  }

  const member = await prisma.member.findFirst({
    where: {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      normalizedPhone,
      status: "ACTIVE",
    },
    select: MEMBER_SELECT,
  });

  if (!member) return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });

  return NextResponse.json({ member: serializeMember(member) });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import { MEMBER_LEDGER_SELECT, MEMBER_SELECT, serializeLedger, serializeMember } from "@/lib/member-api";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });

  const { id } = await params;
  const member = await prisma.member.findFirst({
    where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
    select: MEMBER_SELECT,
  });

  if (!member) return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });

  const ledgers = await prisma.memberBalanceLedger.findMany({
    where: { tenantId: ctx.tenantId, storeId: ctx.storeId, memberId: id },
    select: MEMBER_LEDGER_SELECT,
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    member: serializeMember(member),
    recentLedgers: ledgers.map(serializeLedger),
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getContext } from "@/lib/context";
import { MEMBER_LEDGER_SELECT, MEMBER_SELECT, parseDecimalAmount, serializeLedger, serializeMember } from "@/lib/member-api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (!ctx) return NextResponse.json({ error: "MISSING_CONTEXT" }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  let body: { amount?: unknown; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const amount = parseDecimalAmount(body.amount);
  if (!amount || amount.isZero()) {
    return NextResponse.json({ error: "INVALID_AMOUNT", message: "amount must not be 0" }, { status: 400 });
  }

  const note = body.note?.trim();
  if (!note) return NextResponse.json({ error: "MISSING_NOTE" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.member.findFirst({
        where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
        select: MEMBER_SELECT,
      });
      if (!member) return { error: "MEMBER_NOT_FOUND" as const };

      const balanceBefore = member.balance;
      const balanceAfter = balanceBefore.plus(amount);
      if (balanceAfter.lt(0)) return { error: "INSUFFICIENT_BALANCE" as const };

      const [updatedMember, ledger] = await Promise.all([
        tx.member.update({
          where: { id: member.id },
          data: { balance: balanceAfter },
          select: MEMBER_SELECT,
        }),
        tx.memberBalanceLedger.create({
          data: {
            tenantId: ctx.tenantId,
            storeId: ctx.storeId,
            memberId: member.id,
            type: "ADJUST",
            sourceType: "MANUAL_ADJUST",
            amount,
            balanceBefore,
            balanceAfter,
            operatorUserId: ctx.userId,
            note,
          },
          select: MEMBER_LEDGER_SELECT,
        }),
      ]);

      return { member: updatedMember, ledger };
    });

    if ("error" in result) {
      const status = result.error === "MEMBER_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({
      member: serializeMember(result.member),
      ledger: serializeLedger(result.ledger),
    });
  } catch (err) {
    console.error("[POST /api/members/[id]/adjust]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

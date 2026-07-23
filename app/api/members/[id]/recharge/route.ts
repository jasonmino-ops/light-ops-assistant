import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeTransaction, transactionAuthorizationErrorResponse } from "@/lib/transaction-authorization";
import { MEMBER_LEDGER_SELECT, MEMBER_SELECT, parseDecimalAmount, serializeLedger, serializeMember } from "@/lib/member-api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authorization = await authorizeTransaction(req, { operation: 'MEMBER_BALANCE_RECHARGE' });
  if (!authorization.ok) return transactionAuthorizationErrorResponse(authorization);
  const ctx = authorization.authorization;
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  const { id } = await params;
  let body: { amount?: unknown; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }

  const amount = parseDecimalAmount(body.amount);
  if (!amount || amount.lte(0)) {
    return NextResponse.json({ error: "INVALID_AMOUNT", message: "amount must be greater than 0" }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.member.findFirst({
        where: { id, tenantId: ctx.tenantId, storeId: ctx.storeId },
        select: MEMBER_SELECT,
      });
      if (!member) return null;

      const balanceBefore = member.balance;
      const balanceAfter = balanceBefore.plus(amount);

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
            type: "RECHARGE",
            sourceType: "MANUAL_RECHARGE",
            amount,
            balanceBefore,
            balanceAfter,
            operatorUserId: ctx.userId,
            note: body.note?.trim() || null,
          },
          select: MEMBER_LEDGER_SELECT,
        }),
      ]);

      return { member: updatedMember, ledger };
    });

    if (!result) return NextResponse.json({ error: "MEMBER_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({
      member: serializeMember(result.member),
      ledger: serializeLedger(result.ledger),
    });
  } catch (err) {
    console.error("[POST /api/members/[id]/recharge]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

-- CreateTable
CREATE TABLE "MemberTelegramBindToken" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberTelegramBindToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberTelegramBindToken_tokenHash_key" ON "MemberTelegramBindToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberTelegramBindToken_tenantId_storeId_memberId_idx" ON "MemberTelegramBindToken"("tenantId", "storeId", "memberId");

-- CreateIndex
CREATE INDEX "MemberTelegramBindToken_tenantId_storeId_idx" ON "MemberTelegramBindToken"("tenantId", "storeId");

-- CreateIndex
CREATE INDEX "MemberTelegramBindToken_expiresAt_idx" ON "MemberTelegramBindToken"("expiresAt");

-- CreateIndex
CREATE INDEX "MemberTelegramBindToken_usedAt_idx" ON "MemberTelegramBindToken"("usedAt");

-- CreateIndex
CREATE INDEX "MemberTelegramBindToken_createdByUserId_idx" ON "MemberTelegramBindToken"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Member_tenantId_storeId_telegramId_key" ON "Member"("tenantId", "storeId", "telegramId");

-- AddForeignKey
ALTER TABLE "MemberTelegramBindToken" ADD CONSTRAINT "MemberTelegramBindToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTelegramBindToken" ADD CONSTRAINT "MemberTelegramBindToken_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTelegramBindToken" ADD CONSTRAINT "MemberTelegramBindToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberTelegramBindToken" ADD CONSTRAINT "MemberTelegramBindToken_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

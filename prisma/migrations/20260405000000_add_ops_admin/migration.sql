-- CreateTable
CREATE TABLE "OpsAdmin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT,
    "telegramId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OPS_ADMIN',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpsAdmin_username_key" ON "OpsAdmin"("username");

-- CreateIndex
CREATE UNIQUE INDEX "OpsAdmin_telegramId_key" ON "OpsAdmin"("telegramId");

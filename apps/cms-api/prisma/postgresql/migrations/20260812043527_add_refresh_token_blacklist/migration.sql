-- CreateTable
CREATE TABLE "refresh_token_blacklist" (
    "jti" TEXT NOT NULL,
    "user_id" TEXT,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_blacklist_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "refresh_token_blacklist_expires_at_idx" ON "refresh_token_blacklist"("expires_at");

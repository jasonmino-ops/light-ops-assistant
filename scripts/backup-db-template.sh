#!/usr/bin/env bash
set -euo pipefail

# Beta V1.1 backup command template.
#
# This script is a template only:
# - It does not contain real secrets.
# - It does not write into the repository by default.
# - It does not run destructive SQL.
# - It expects DIRECT_URL to be supplied by the operator from a secure source.
#
# Suggested use:
#   export DIRECT_URL='postgresql://USER:PASSWORD@HOST:5432/DB?sslmode=require'
#   BACKUP_DIR="$HOME/E-Life-Backups/beta-v1.1/$(date +%F)" bash scripts/backup-db-template.sh

if [[ -z "${DIRECT_URL:-}" ]]; then
  echo "ERROR: DIRECT_URL is not set. Load it from a secure local source first."
  exit 2
fi

BACKUP_DIR="${BACKUP_DIR:-$HOME/E-Life-Backups/beta-v1.1/$(date +%F)}"
mkdir -p "$BACKUP_DIR"

echo "Writing backup metadata to: $BACKUP_DIR"
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$BACKUP_DIR/backup-created-at-utc.txt"
git rev-parse HEAD > "$BACKUP_DIR/git-commit.txt"
git tag --points-at HEAD > "$BACKUP_DIR/git-tags-at-head.txt"
git status --short > "$BACKUP_DIR/git-status-short.txt"

echo "Exporting Prisma migration status..."
DATABASE_URL="$DIRECT_URL" npx prisma migrate status > "$BACKUP_DIR/prisma-migrate-status.txt"

echo "Exporting database schema..."
pg_dump "$DIRECT_URL" \
  --no-owner \
  --schema=public \
  --schema-only \
  > "$BACKUP_DIR/schema.sql"

echo "Exporting key table data..."
pg_dump "$DIRECT_URL" \
  --no-owner \
  --data-only \
  --column-inserts \
  --table='"Tenant"' \
  --table='"Store"' \
  --table='"User"' \
  --table='"UserStoreRole"' \
  --table='"Product"' \
  --table='"ProductCategory"' \
  --table='"SaleRecord"' \
  --table='"PaymentIntent"' \
  --table='"MerchantPaymentConfig"' \
  --table='"CustomerOrder"' \
  --table='"StoreCustomerContact"' \
  --table='"CouponTemplate"' \
  --table='"CustomerCoupon"' \
  --table='"CouponRedemption"' \
  --table='"CouponIssueBatch"' \
  --table='"MarketingProductPage"' \
  --table='"CampaignLink"' \
  --table='"BindToken"' \
  --table='"OpsAdmin"' \
  --table='"OperationLog"' \
  --table='"TelegramMessage"' \
  --table='"SupportSession"' \
  --table='"CustomerTouchLog"' \
  --table='"ConversationLog"' \
  > "$BACKUP_DIR/key-tables.sql"

cat > "$BACKUP_DIR/storage-backup-manual-checklist.md" <<'EOF'
# Storage Backup Manual Checklist

Download these Supabase Storage buckets from Dashboard or Supabase CLI:

- product-images
- order-delivery-photos

Keep object keys unchanged. Store archives encrypted outside Git.
EOF

cat > "$BACKUP_DIR/vercel-deployment-manual-checklist.md" <<'EOF'
# Vercel Deployment Manual Checklist

Record manually from Vercel Dashboard:

- Production deployment URL
- Deployment commit SHA
- Deployment created time
- Domain aliases
- Environment variable presence check, without values

Do not write plaintext environment values into this file.
EOF

echo "Backup template completed."
echo "Output directory: $BACKUP_DIR"
echo "Review file sizes and move the directory to encrypted storage."

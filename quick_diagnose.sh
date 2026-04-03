#!/usr/bin/env bash
set -euo pipefail

echo "================ BASIC INFO ================"
pwd
date
echo

echo "================ GIT STATUS ================"
git status --short || true
echo
git log --oneline -8 || true
echo

echo "================ BUILD CHECK ================"
npm run build || true
echo

echo "================ KEY SEARCH ================"
echo "[sale page allProducts / dropdown]"
grep -n "allProducts.length\|dropOpen\|filteredDrop\|products/page\|BarcodeScanner" app/sale/page.tsx || true
echo

echo "[network error text]"
grep -Rni "网络错误\|加载失败\|请重试" app lib || true
echo

echo "================ FILE SNAPSHOTS ================"
echo "--- app/api/products/route.ts ---"
sed -n '1,260p' app/api/products/route.ts || true
echo
echo "--- middleware.ts ---"
sed -n '1,260p' middleware.ts || true
echo
echo "--- lib/context.ts ---"
sed -n '1,260p' lib/context.ts || true
echo
echo "--- app/api/auth/telegram/route.ts ---"
sed -n '1,260p' app/api/auth/telegram/route.ts || true
echo
echo "--- app/sale/page.tsx (first 260 lines) ---"
sed -n '1,260p' app/sale/page.tsx || true
echo
echo "--- app/sale/page.tsx (261-520 lines) ---"
sed -n '261,520p' app/sale/page.tsx || true
echo

echo "================ ENV CHECK ================"
if [ -f .env ]; then
  echo ".env exists"
  echo "DATABASE_URL set? -> $(grep -q '^DATABASE_URL=' .env && echo YES || echo NO)"
  echo "AUTH_SECRET set?  -> $(grep -q '^AUTH_SECRET=' .env && echo YES || echo NO)"
  echo "TELEGRAM_BOT_TOKEN set? -> $(grep -q '^TELEGRAM_BOT_TOKEN=' .env && echo YES || echo NO)"
  echo "TENANT_ID set? -> $(grep -q '^TENANT_ID=' .env && echo YES || echo NO)"
  echo "DEV_ROLE set? -> $(grep -q '^DEV_ROLE=' .env && echo YES || echo NO)"
else
  echo ".env NOT FOUND"
fi
echo

echo "================ LOCAL API CHECK ================"
if lsof -i :3000 >/dev/null 2>&1; then
  echo "Detected local server on :3000, testing APIs..."
  echo "--- /api/health ---"
  curl -sS http://localhost:3000/api/health || true
  echo
  echo "--- /api/products ---"
  curl -i -sS http://localhost:3000/api/products || true
  echo
else
  echo "No local server on :3000. Skip curl tests."
fi
echo

echo "================ PRISMA CHECK ================"
echo "--- prisma/schema.prisma ---"
sed -n '1,120p' prisma/schema.prisma || true
echo
echo "--- prisma.config.ts ---"
sed -n '1,200p' prisma.config.ts || true
echo

echo "================ SUMMARY HINTS ================"
echo "1. If /api/products is empty -> likely context/env/data issue."
echo "2. If sale page has allProducts.length conditional -> dropdown disappears when products API returns empty."
echo "3. If '网络错误' appears in grep -> that file is the direct UI source of the message."
echo "4. If middleware touches /api or protected routes too broadly -> mobile/Telegram may fail."
echo

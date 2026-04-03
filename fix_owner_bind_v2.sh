#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:-seed-tenant-001}"
OWNER_USER_ID="${OWNER_USER_ID:-seed-user-boss}"
STORE_ID="${STORE_ID:-seed-store-a}"

echo "================ 0. 健康检查 ================"
curl -sS "$BASE_URL/api/health" && echo
echo

echo "================ 1. 拉取成员列表 ================"
USERS_JSON="$(curl -sS "$BASE_URL/api/admin/users" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-user-id: $OWNER_USER_ID" \
  -H "x-store-id: $STORE_ID" \
  -H "x-role: OWNER")"

echo "$USERS_JSON"
echo

echo "================ 2. 从成员列表里找已绑定成员 ================"
echo "请从上面返回里找到你要解绑的成员 id（不是 telegramId），复制出来。"
read -r -p "请输入要解绑的成员 userId: " TARGET_USER_ID

if [ -z "${TARGET_USER_ID:-}" ]; then
  echo "❌ 未输入 userId"
  exit 1
fi

echo
echo "================ 3. 执行解绑 ================"
curl -i -X POST "$BASE_URL/api/admin/users/$TARGET_USER_ID/unbind" \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-user-id: $OWNER_USER_ID" \
  -H "x-store-id: $STORE_ID" \
  -H "x-role: OWNER"
echo
echo

echo "================ 4. 生成新的 OWNER 绑定链接 ================"
OWNER_JSON="$(curl -sS -X POST "$BASE_URL/api/admin/bind-tokens" \
  -H 'Content-Type: application/json' \
  -H "x-tenant-id: $TENANT_ID" \
  -H "x-user-id: $OWNER_USER_ID" \
  -H "x-store-id: $STORE_ID" \
  -H "x-role: OWNER" \
  --data "{\"storeId\":\"$STORE_ID\",\"role\":\"OWNER\",\"label\":\"老板重绑\",\"expiresInHours\":48}")"

echo "$OWNER_JSON"
echo

echo "================ 5. 提示 ================"
echo "请从上面的 JSON 中复制 tgLink，用老板当前的 Telegram 账号打开。"
echo "打开后应重新绑定为 OWNER。"
echo "绑定成功后再验证："
echo "1) /dashboard 是否可打开"
echo "2) /invite 是否不再跳回 /home"

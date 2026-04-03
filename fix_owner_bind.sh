#!/usr/bin/env bash
set -euo pipefail

echo "================ 0. 基本检查 ================"
if [ ! -f .env ]; then
  echo "❌ 当前目录没有 .env，先确认你在 ~/light-ops-assistant"
  exit 1
fi

if ! grep -q '^DATABASE_URL=' .env; then
  echo "❌ .env 里没有 DATABASE_URL"
  exit 1
fi

echo "✅ .env 存在，DATABASE_URL 已配置"
echo

echo "================ 1. 列出当前已绑定账号 ================"
node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  try {
    const rows = await prisma.user.findMany({
      where: { telegramId: { not: null } },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        telegramId: true,
        tenantId: true,
      },
      orderBy: { username: 'asc' },
    });
    if (!rows.length) {
      console.log('当前没有已绑定 telegramId 的用户。');
    } else {
      console.log(JSON.stringify(rows, null, 2));
    }
  } catch (e) {
    console.error('❌ 查询失败:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
NODE
echo

read -r -p "请输入要解绑的 Telegram 数字 ID（例如 123456789）: " TGID
if [ -z "${TGID:-}" ]; then
  echo "❌ 未输入 Telegram ID"
  exit 1
fi

echo
echo "================ 2. 执行解绑 ================"
TGID="$TGID" node <<'NODE'
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const tgId = process.env.TGID;
(async () => {
  try {
    const hit = await prisma.user.findFirst({
      where: { telegramId: tgId },
      select: { id: true, username: true, displayName: true, role: true, telegramId: true }
    });

    if (!hit) {
      console.log(`⚠️ 没找到 telegramId=${tgId} 的绑定记录`);
      return;
    }

    await prisma.user.update({
      where: { id: hit.id },
      data: { telegramId: null }
    });

    console.log('✅ 已解绑:');
    console.log(JSON.stringify(hit, null, 2));
  } catch (e) {
    console.error('❌ 解绑失败:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
NODE
echo

echo "================ 3. 生成新的 OWNER 绑定链接 ================"
BOT_USERNAME="$(grep '^TELEGRAM_BOT_USERNAME=' .env | tail -1 | cut -d= -f2- || true)"
if [ -z "${BOT_USERNAME:-}" ]; then
  echo "❌ .env 里没有 TELEGRAM_BOT_USERNAME"
  exit 1
fi

OWNER_JSON="$(curl -sS -X POST http://localhost:3000/api/admin/bind-tokens \
  -H 'Content-Type: application/json' \
  -H 'x-tenant-id: seed-tenant-001' \
  -H 'x-user-id: seed-user-boss' \
  -H 'x-store-id: seed-store-a' \
  -H 'x-role: OWNER' \
  --data '{"storeId":"seed-store-a","role":"OWNER","label":"老板重绑","expiresInHours":48}')"

echo "$OWNER_JSON"
echo

TGLINK="$(printf '%s' "$OWNER_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.tgLink||'')}catch(e){process.stdout.write('')}})")"

if [ -z "${TGLINK:-}" ]; then
  echo "❌ 没拿到 tgLink。请先确认本地 dev 服务正在运行，且 /api/admin/bind-tokens 正常。"
  exit 1
fi

echo "================ 4. 下一步 ================"
echo "请用老板本人当前的 Telegram 账号打开下面这个链接："
echo
echo "$TGLINK"
echo
echo "打开后应重新绑定为 boss / OWNER。"
echo "绑定成功后再去验证："
echo "1) /dashboard 是否可打开"
echo "2) /invite 是否不再跳回 /home"

#!/usr/bin/env bash
#
# EP-CC-01 电脑客户端绑定闭环 —— 一键集成测试
#
# 安全保证：
#   - 全程只连本脚本自己拉起的临时 PostgreSQL，绝不读取 .env 里的生产库；
#   - 使用测试专用密钥，不接触生产密钥；
#   - 结束后自动销毁临时库与测试服务。
#
# 用法：bash scripts/test/run-computer-client-tests.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

PGBIN="${PGBIN:-/opt/homebrew/Cellar/postgresql@18/18.3/bin}"
PGPORT="${PGPORT:-54329}"
PGDATA_DIR="${PGDATA_DIR:-/tmp/eshop-cc-test/pgdata}"
PGSOCK="${PGSOCK:-/tmp/eshop-cc-test/sock}"
APP_PORT="${APP_PORT:-3199}"
APP_PORT_NOSECRET="${APP_PORT_NOSECRET:-3198}"

export PATH="$PGBIN:$PATH" LC_ALL=C LANG=C
TEST_DB="postgresql://postgres@127.0.0.1:${PGPORT}/eshop_cc_test"

export AUTH_SECRET="test-auth-secret-not-production"
export COMPUTER_CLIENT_TOKEN_SECRET="test-computer-client-secret-not-production"
# 关键：强制关闭 x-* 开发身份头，测试必须走真实签名 Session
export ESHOP_DISABLE_DEV_HEADERS=1

cleanup() {
  echo "── 清理测试环境 ──"
  [[ -n "${APP_PID:-}" ]] && kill "$APP_PID" 2>/dev/null || true
  [[ -n "${APP_PID2:-}" ]] && kill "$APP_PID2" 2>/dev/null || true
  pg_ctl -D "$PGDATA_DIR" stop -m immediate > /dev/null 2>&1 || true
  rm -rf /tmp/eshop-cc-test
}
trap cleanup EXIT

echo "── 1/5 启动临时 PostgreSQL ──"
rm -rf /tmp/eshop-cc-test
mkdir -p "$PGDATA_DIR" "$PGSOCK"
initdb -D "$PGDATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C > /dev/null
pg_ctl -D "$PGDATA_DIR" -o "-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1" -l /tmp/eshop-cc-test/pg.log start > /dev/null
sleep 2
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -q -c "CREATE DATABASE eshop_cc_test;"

echo "── 2/5 应用 migration 到临时库 ──"
DATABASE_URL="$TEST_DB" DIRECT_URL="$TEST_DB" npx prisma migrate deploy > /dev/null
echo "   migration 已应用"

echo "── 3/5 启动被测服务（含密钥，端口 $APP_PORT）──"
DATABASE_URL="$TEST_DB" DIRECT_URL="$TEST_DB" \
  npx next dev -p "$APP_PORT" > /tmp/eshop-cc-test/app.log 2>&1 &
APP_PID=$!

echo "── 4/5 启动对照服务（缺密钥，端口 $APP_PORT_NOSECRET）──"
env -u COMPUTER_CLIENT_TOKEN_SECRET \
  DATABASE_URL="$TEST_DB" DIRECT_URL="$TEST_DB" \
  npx next dev -p "$APP_PORT_NOSECRET" > /tmp/eshop-cc-test/app-nosecret.log 2>&1 &
APP_PID2=$!

for port in "$APP_PORT" "$APP_PORT_NOSECRET"; do
  for i in $(seq 1 60); do
    if curl -s -o /dev/null "http://127.0.0.1:${port}/api/computer-client/requests"; then break; fi
    sleep 1
  done
done
echo "   服务就绪"

echo "── 5/5 执行测试 ──"
TEST_BASE_URL="http://127.0.0.1:${APP_PORT}" \
TEST_BASE_URL_NOSECRET="http://127.0.0.1:${APP_PORT_NOSECRET}" \
DATABASE_URL="$TEST_DB" \
  node --test scripts/test/computer-client-binding.test.mjs

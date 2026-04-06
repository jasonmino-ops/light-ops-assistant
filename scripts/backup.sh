#!/bin/bash
# ============================================================
# 店小二助手 — 系统备份脚本
# 适配 macOS，需要：pg_dump、git、rclone（或 Google Drive 本地目录）
#
# 用法：
#   bash ~/light-ops-assistant/scripts/backup.sh
#
# 首次使用前：
#   1. 复制 scripts/backup-secrets.template → ~/.backup-secrets 并填入 DIRECT_URL
#   2. 按需修改下方「配置区」的路径
# ============================================================

# 去掉 -e：任何单步失败不中断脚本
# 保留 -u（未定义变量报错）和 -o pipefail（管道错误传递）
set -uo pipefail

# ─── 配置区（按实际情况修改）────────────────────────────────────────────────
PROJECT_DIR="$HOME/light-ops-assistant"
BACKUP_ROOT="$HOME/backups/shop-assistant"
SECRETS_FILE="$HOME/.backup-secrets"

# Google Drive 同步方式，二选一：
# A. rclone remote 名称（推荐）— 执行 `rclone config` 配置好后填写
RCLONE_REMOTE="gdrive:backups/shop-assistant"
# B. Google Drive for Desktop 本地挂载目录（若已安装）
GDRIVE_LOCAL="/Users/jason/Library/CloudStorage/GoogleDrive-sunxiaojian0910@gmail.com/我的云端硬盘/店小二备份"

# 保留策略
KEEP_DAILY=7      # 日备份保留 7 天
KEEP_WEEKLY=4     # 周备份保留 4 周
KEEP_MONTHLY=3    # 月备份保留 3 个月

# 数据库 pg_dump 超时时间（秒）——防止 DNS 解析挂起
PG_DUMP_TIMEOUT=30
# ─────────────────────────────────────────────────────────────────────────────

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M)
LOG_PREFIX="[$DATE $TIME]"

log()  { echo "$LOG_PREFIX $*"; }
ok()   { echo "$LOG_PREFIX ✓ $*"; }
warn() { echo "$LOG_PREFIX ⚠️  $*"; }
fail() { echo "$LOG_PREFIX ✕ $*"; }

# ─── 步骤结果追踪 ─────────────────────────────────────────────────────────────
STATUS_DB="跳过"        # 跳过 | 成功 | 失败
STATUS_CODE="未执行"
STATUS_MIGRATIONS="未执行"
STATUS_DOCS="未执行"
STATUS_GDRIVE="未执行"
DETAIL_DB=""            # 失败时存错误摘要

# ─── 加载数据库连接配置 ───────────────────────────────────────────────────────
DIRECT_URL=""
if [ -f "$SECRETS_FILE" ]; then
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
else
  warn "未找到 $SECRETS_FILE，数据库备份将跳过"
fi

# ─── 建立本次备份目录 ─────────────────────────────────────────────────────────
BACKUP_DIR="$BACKUP_ROOT/daily/$DATE"
mkdir -p "$BACKUP_DIR"

log "开始备份 → $BACKUP_DIR"

# ─── 1. 数据库备份（非阻断，带超时） ─────────────────────────────────────────
if [ -n "${DIRECT_URL:-}" ]; then
  if ! command -v pg_dump &>/dev/null; then
    STATUS_DB="跳过"
    DETAIL_DB="pg_dump 未安装（brew install libpq）"
    warn "pg_dump 未找到，跳过数据库备份"
  else
    log "数据库备份中（超时 ${PG_DUMP_TIMEOUT}s）..."
    DB_ERR_FILE="$BACKUP_DIR/db-error.log"
    # timeout 防止 DNS 解析挂起把脚本卡死
    if timeout "$PG_DUMP_TIMEOUT" pg_dump "$DIRECT_URL" \
         --format=custom \
         --no-acl \
         --no-owner \
         --file="$BACKUP_DIR/db.dump" 2>"$DB_ERR_FILE"; then
      DB_SIZE=$(du -sh "$BACKUP_DIR/db.dump" | cut -f1)
      ok "数据库备份完成（$DB_SIZE）"
      rm -f "$DB_ERR_FILE"
      STATUS_DB="成功（$DB_SIZE）"
    else
      EXIT_CODE=$?
      if [ "$EXIT_CODE" = "124" ]; then
        DETAIL_DB="超时（${PG_DUMP_TIMEOUT}s），DNS 可能无法解析 Supabase 域名"
      else
        DETAIL_DB=$(head -3 "$DB_ERR_FILE" 2>/dev/null | tr '\n' ' ')
      fi
      STATUS_DB="失败"
      fail "数据库备份失败：$DETAIL_DB"
      fail "（错误详情见 $DB_ERR_FILE，其他备份继续执行）"
      # 清除可能产生的空/残缺 dump 文件
      rm -f "$BACKUP_DIR/db.dump"
    fi
  fi
else
  warn "DIRECT_URL 未配置，跳过数据库备份"
  DETAIL_DB="DIRECT_URL 未在 ~/.backup-secrets 中配置"
fi

# ─── 2. 代码快照（git archive，不含 node_modules/.next） ─────────────────────
if [ -d "$PROJECT_DIR/.git" ]; then
  log "代码快照中..."
  cd "$PROJECT_DIR"
  GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  if git archive --format=tar.gz \
       --output="$BACKUP_DIR/code-$GIT_COMMIT.tar.gz" HEAD 2>/dev/null; then
    CODE_SIZE=$(du -sh "$BACKUP_DIR/code-$GIT_COMMIT.tar.gz" | cut -f1)
    ok "代码快照完成 commit=$GIT_COMMIT（$CODE_SIZE）"
    STATUS_CODE="成功 commit=$GIT_COMMIT（$CODE_SIZE）"
  else
    fail "代码快照失败"
    STATUS_CODE="失败"
  fi
else
  warn "未检测到 git 仓库，跳过代码快照"
  STATUS_CODE="跳过（无 git 仓库）"
fi

# ─── 3. Prisma migrations 单独备份 ───────────────────────────────────────────
if [ -d "$PROJECT_DIR/prisma/migrations" ]; then
  if cp -r "$PROJECT_DIR/prisma/migrations" "$BACKUP_DIR/migrations" 2>/dev/null; then
    MIG_COUNT=$(ls "$BACKUP_DIR/migrations" | wc -l | tr -d ' ')
    ok "migrations 备份完成（$MIG_COUNT 个）"
    STATUS_MIGRATIONS="成功（$MIG_COUNT 个）"
  else
    fail "migrations 备份失败"
    STATUS_MIGRATIONS="失败"
  fi
else
  STATUS_MIGRATIONS="跳过（目录不存在）"
fi

# ─── 4. 关键文档 ──────────────────────────────────────────────────────────────
DOCS_OK=true
for doc in MIGRATIONS.md CLAUDE.md README.md prisma/schema.prisma; do
  src="$PROJECT_DIR/$doc"
  if [ -f "$src" ]; then
    dest_dir="$BACKUP_DIR/docs/$(dirname "$doc")"
    mkdir -p "$dest_dir"
    cp "$src" "$dest_dir/" 2>/dev/null || DOCS_OK=false
  fi
done
if [ "$DOCS_OK" = true ]; then
  ok "关键文档备份完成"
  STATUS_DOCS="成功"
else
  warn "部分文档备份失败"
  STATUS_DOCS="部分失败"
fi

# ─── 5. 元数据（含各步结果摘要） ─────────────────────────────────────────────
cd "$PROJECT_DIR"
cat > "$BACKUP_DIR/metadata.txt" <<EOF
===== 店小二备份摘要 =====
备份时间：$DATE $TIME
项目目录：$PROJECT_DIR
git commit：$(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')
git branch：$(git branch --show-current 2>/dev/null || echo 'N/A')
git log（最近 3 条）：
$(git log --oneline -3 2>/dev/null || echo 'N/A')
数据库 host：$(echo "${DIRECT_URL:-未配置}" | sed 's|postgresql://[^@]*@||' | cut -d'/' -f1)

===== 各步骤结果 =====
数据库备份：${STATUS_DB}${DETAIL_DB:+  ← $DETAIL_DB}
代码快照：  ${STATUS_CODE}
migrations：${STATUS_MIGRATIONS}
关键文档：  ${STATUS_DOCS}
EOF
# Google Drive 状态在同步完成后追加
ok "元数据写入完成"

# ─── 6. 周备份 / 月备份归档 ──────────────────────────────────────────────────
DOW=$(date +%u)
DOM=$(date +%d)

if [ "$DOW" = "7" ]; then
  WEEK_KEY=$(date +%Y-W%V)
  mkdir -p "$BACKUP_ROOT/weekly"
  if [ ! -d "$BACKUP_ROOT/weekly/$WEEK_KEY" ]; then
    cp -r "$BACKUP_DIR" "$BACKUP_ROOT/weekly/$WEEK_KEY" 2>/dev/null \
      && ok "周备份归档：$WEEK_KEY"
  fi
fi

if [ "$DOM" = "01" ]; then
  MONTH_KEY=$(date +%Y-%m)
  mkdir -p "$BACKUP_ROOT/monthly"
  if [ ! -d "$BACKUP_ROOT/monthly/$MONTH_KEY" ]; then
    cp -r "$BACKUP_DIR" "$BACKUP_ROOT/monthly/$MONTH_KEY" 2>/dev/null \
      && ok "月备份归档：$MONTH_KEY"
  fi
fi

# ─── 7. 清理过期备份 ──────────────────────────────────────────────────────────
cleanup_old() {
  local dir="$1" keep="$2"
  if [ -d "$dir" ]; then
    local count
    count=$(ls -1 "$dir" | wc -l | tr -d ' ')
    if [ "$count" -gt "$keep" ]; then
      ls -1 "$dir" | sort | head -n "-$keep" | while read -r entry; do
        rm -rf "${dir:?}/$entry"
        log "  已删除过期备份：$entry"
      done
    fi
  fi
}
cleanup_old "$BACKUP_ROOT/daily"   "$KEEP_DAILY"
cleanup_old "$BACKUP_ROOT/weekly"  "$KEEP_WEEKLY"
cleanup_old "$BACKUP_ROOT/monthly" "$KEEP_MONTHLY"
ok "过期备份清理完成"

# ─── 8. 同步到 Google Drive ───────────────────────────────────────────────────
log "同步到 Google Drive..."
STATUS_GDRIVE="未同步"

# 方式 A：rclone
if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q "$(echo "$RCLONE_REMOTE" | cut -d: -f1):"; then
  if rclone sync "$BACKUP_ROOT" "$RCLONE_REMOTE" \
       --exclude ".DS_Store" \
       --log-level INFO 2>&1; then
    ok "rclone 同步完成 → $RCLONE_REMOTE"
    STATUS_GDRIVE="成功（rclone）"
  else
    fail "rclone 同步失败"
    STATUS_GDRIVE="失败（rclone 错误）"
  fi
fi

# 方式 B：Google Drive for Desktop 本地目录
if [ "$STATUS_GDRIVE" = "未同步" ]; then
  GDRIVE_PARENT=$(dirname "$GDRIVE_LOCAL")
  if [ -d "$GDRIVE_PARENT" ]; then
    mkdir -p "$GDRIVE_LOCAL"
    if rsync -a --delete \
         --exclude ".DS_Store" \
         "$BACKUP_ROOT/" "$GDRIVE_LOCAL/" 2>/dev/null; then
      ok "Google Drive 本地同步完成 → $GDRIVE_LOCAL"
      STATUS_GDRIVE="成功（Google Drive Desktop）"
    else
      fail "rsync 到 Google Drive 失败"
      STATUS_GDRIVE="失败（rsync 错误）"
    fi
  else
    warn "Google Drive 本地目录不存在，跳过同步"
    STATUS_GDRIVE="跳过（目录不存在）"
  fi
fi

# ─── Google Drive 状态追加到 metadata ────────────────────────────────────────
echo "Google Drive：  ${STATUS_GDRIVE}" >> "$BACKUP_DIR/metadata.txt"

# ─── 最终摘要（终端打印） ────────────────────────────────────────────────────
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "════════════════════════════════════"
echo "  备份完成摘要  $DATE $TIME"
echo "════════════════════════════════════"
printf "  数据库备份：%s\n"    "$STATUS_DB"
[ -n "$DETAIL_DB" ] && printf "              ↳ %s\n" "$DETAIL_DB"
printf "  代码快照：  %s\n"    "$STATUS_CODE"
printf "  migrations：%s\n"    "$STATUS_MIGRATIONS"
printf "  关键文档：  %s\n"    "$STATUS_DOCS"
printf "  Google Drive：%s\n"  "$STATUS_GDRIVE"
echo "────────────────────────────────────"
echo "  本地路径：$BACKUP_DIR（$TOTAL_SIZE）"
echo "════════════════════════════════════"
echo ""

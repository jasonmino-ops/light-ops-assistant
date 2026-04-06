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
#   2. 安装 rclone 并配置 Google Drive remote（见 scripts/setup-backup.sh）
#   3. 按需修改下方「配置区」的路径
# ============================================================

set -euo pipefail

# ─── 配置区（按实际情况修改）────────────────────────────────────────────────
PROJECT_DIR="$HOME/light-ops-assistant"
BACKUP_ROOT="$HOME/backups/shop-assistant"
SECRETS_FILE="$HOME/.backup-secrets"

# Google Drive 同步方式，二选一：
# A. rclone remote 名称（推荐）— 执行 `rclone config` 配置好后填写
RCLONE_REMOTE="gdrive:backups/shop-assistant"
# B. Google Drive for Desktop 本地挂载目录（若已安装）
GDRIVE_LOCAL="$HOME/Library/CloudStorage/GoogleDrive-my@gmail.com/My Drive/backups/shop-assistant"

# 保留策略
KEEP_DAILY=7      # 日备份保留 7 天
KEEP_WEEKLY=4     # 周备份保留 4 周
KEEP_MONTHLY=3    # 月备份保留 3 个月
# ─────────────────────────────────────────────────────────────────────────────

DATE=$(date +%Y-%m-%d)
TIME=$(date +%H%M)
LOG_PREFIX="[$DATE $TIME]"

log() { echo "$LOG_PREFIX $*"; }
ok()  { echo "$LOG_PREFIX ✓ $*"; }
warn(){ echo "$LOG_PREFIX ⚠️  $*"; }
fail(){ echo "$LOG_PREFIX ✕ $*"; }

# ─── 加载数据库连接配置 ───────────────────────────────────────────────────────
DIRECT_URL=""
if [ -f "$SECRETS_FILE" ]; then
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
else
  warn "未找到 $SECRETS_FILE，数据库备份将跳过"
  warn "请参考 scripts/backup-secrets.template 创建该文件"
fi

# ─── 建立本次备份目录 ─────────────────────────────────────────────────────────
BACKUP_DIR="$BACKUP_ROOT/daily/$DATE"
mkdir -p "$BACKUP_DIR"

log "开始备份 → $BACKUP_DIR"

# ─── 1. 数据库备份 ────────────────────────────────────────────────────────────
if [ -n "${DIRECT_URL:-}" ]; then
  log "数据库备份中..."
  if pg_dump "$DIRECT_URL" \
       --format=custom \
       --no-acl \
       --no-owner \
       --file="$BACKUP_DIR/db.dump" 2>"$BACKUP_DIR/db-error.log"; then
    DB_SIZE=$(du -sh "$BACKUP_DIR/db.dump" | cut -f1)
    ok "数据库备份完成（$DB_SIZE）"
    rm -f "$BACKUP_DIR/db-error.log"
  else
    fail "数据库备份失败，错误见 $BACKUP_DIR/db-error.log"
  fi
else
  warn "DIRECT_URL 未配置，跳过数据库备份"
fi

# ─── 2. 代码快照（git archive，不含 node_modules/.next） ─────────────────────
if [ -d "$PROJECT_DIR/.git" ]; then
  log "代码快照中..."
  cd "$PROJECT_DIR"
  GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
  if git archive --format=tar.gz \
       --output="$BACKUP_DIR/code-$GIT_COMMIT.tar.gz" HEAD; then
    CODE_SIZE=$(du -sh "$BACKUP_DIR/code-$GIT_COMMIT.tar.gz" | cut -f1)
    ok "代码快照完成 commit=$GIT_COMMIT（$CODE_SIZE）"
  else
    fail "代码快照失败"
  fi
else
  warn "未检测到 git 仓库，跳过代码快照"
fi

# ─── 3. Prisma migrations 单独备份 ───────────────────────────────────────────
if [ -d "$PROJECT_DIR/prisma/migrations" ]; then
  cp -r "$PROJECT_DIR/prisma/migrations" "$BACKUP_DIR/migrations"
  ok "migrations 备份完成（$(ls "$BACKUP_DIR/migrations" | wc -l | tr -d ' ') 个）"
fi

# ─── 4. 关键文档 ──────────────────────────────────────────────────────────────
for doc in MIGRATIONS.md CLAUDE.md README.md prisma/schema.prisma; do
  src="$PROJECT_DIR/$doc"
  if [ -f "$src" ]; then
    dest_dir="$BACKUP_DIR/docs/$(dirname "$doc")"
    mkdir -p "$dest_dir"
    cp "$src" "$dest_dir/"
  fi
done
ok "关键文档备份完成"

# ─── 5. 元数据 ───────────────────────────────────────────────────────────────
cd "$PROJECT_DIR"
cat > "$BACKUP_DIR/metadata.txt" <<EOF
备份时间：$DATE $TIME
项目目录：$PROJECT_DIR
git commit：$(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')
git branch：$(git branch --show-current 2>/dev/null || echo 'N/A')
git log（最近 3 条）：
$(git log --oneline -3 2>/dev/null || echo 'N/A')
数据库 host：$(echo "${DIRECT_URL:-未配置}" | sed 's|postgresql://.*@||' | cut -d'/' -f1)
EOF
ok "元数据写入完成"

# ─── 6. 周备份 / 月备份归档 ──────────────────────────────────────────────────
DOW=$(date +%u)   # 1=周一 … 7=周日
DOM=$(date +%d)

if [ "$DOW" = "7" ]; then
  WEEK_KEY=$(date +%Y-W%V)
  mkdir -p "$BACKUP_ROOT/weekly"
  if [ ! -d "$BACKUP_ROOT/weekly/$WEEK_KEY" ]; then
    cp -r "$BACKUP_DIR" "$BACKUP_ROOT/weekly/$WEEK_KEY"
    ok "周备份归档：$WEEK_KEY"
  fi
fi

if [ "$DOM" = "01" ]; then
  MONTH_KEY=$(date +%Y-%m)
  mkdir -p "$BACKUP_ROOT/monthly"
  if [ ! -d "$BACKUP_ROOT/monthly/$MONTH_KEY" ]; then
    cp -r "$BACKUP_DIR" "$BACKUP_ROOT/monthly/$MONTH_KEY"
    ok "月备份归档：$MONTH_KEY"
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

SYNCED=false

# 方式 A：rclone（推荐）
if command -v rclone &>/dev/null && rclone listremotes 2>/dev/null | grep -q "$(echo "$RCLONE_REMOTE" | cut -d: -f1):"; then
  if rclone sync "$BACKUP_ROOT" "$RCLONE_REMOTE" \
       --exclude ".DS_Store" \
       --log-level INFO 2>&1; then
    ok "rclone 同步完成 → $RCLONE_REMOTE"
    SYNCED=true
  else
    fail "rclone 同步失败"
  fi
fi

# 方式 B：Google Drive for Desktop 本地目录（若未用 rclone）
if [ "$SYNCED" = false ]; then
  GDRIVE_PARENT=$(dirname "$GDRIVE_LOCAL")
  if [ -d "$GDRIVE_PARENT" ]; then
    mkdir -p "$GDRIVE_LOCAL"
    rsync -av --delete \
      --exclude ".DS_Store" \
      "$BACKUP_ROOT/" "$GDRIVE_LOCAL/"
    ok "Google Drive 本地同步完成 → $GDRIVE_LOCAL"
    SYNCED=true
  fi
fi

if [ "$SYNCED" = false ]; then
  warn "未找到可用的 Google Drive 同步方式（rclone 或本地目录均不可用）"
  warn "备份已保存在本地：$BACKUP_ROOT"
fi

# ─── 完成 ─────────────────────────────────────────────────────────────────────
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "🟢 备份完成"
echo "   本地路径：$BACKUP_DIR（$TOTAL_SIZE）"
[ "$SYNCED" = true ] && echo "   Google Drive：已同步" || echo "   Google Drive：未同步"
echo ""

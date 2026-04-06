#!/bin/bash
# ============================================================
# 备份环境一次性初始化脚本
# 执行：bash ~/light-ops-assistant/scripts/setup-backup.sh
# ============================================================

set -euo pipefail

PROJECT_DIR="$HOME/light-ops-assistant"
BACKUP_ROOT="$HOME/backups/shop-assistant"
LOG_DIR="$HOME/logs"
LAUNCHD_DIR="$HOME/Library/LaunchAgents"
PLIST_SRC="$PROJECT_DIR/scripts/com.shopassistant.backup.plist"
PLIST_DEST="$LAUNCHD_DIR/com.shopassistant.backup.plist"
SECRETS_FILE="$HOME/.backup-secrets"
SCRIPT_PATH="$PROJECT_DIR/scripts/backup.sh"

echo "===== 店小二备份环境初始化 ====="
echo ""

# ─── 1. 创建目录 ─────────────────────────────────────────────────────────────
echo "1. 创建备份目录..."
mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/weekly" "$BACKUP_ROOT/monthly"
mkdir -p "$LOG_DIR"
echo "   ✓ $BACKUP_ROOT/{daily,weekly,monthly}"
echo "   ✓ $LOG_DIR"

# ─── 2. 给备份脚本加执行权限 ─────────────────────────────────────────────────
chmod +x "$SCRIPT_PATH"
echo "2. ✓ backup.sh 已赋予执行权限"

# ─── 3. 检测 pg_dump ──────────────────────────────────────────────────────────
echo "3. 检测 pg_dump..."
if command -v pg_dump &>/dev/null; then
  echo "   ✓ pg_dump 已安装：$(pg_dump --version)"
else
  echo "   ✕ pg_dump 未找到，请安装 PostgreSQL 客户端："
  echo "     brew install postgresql"
fi

# ─── 4. 检测/安装 rclone ──────────────────────────────────────────────────────
echo "4. 检测 rclone..."
if command -v rclone &>/dev/null; then
  echo "   ✓ rclone 已安装：$(rclone --version | head -1)"
  echo ""
  echo "   ── 当前 rclone remotes ──"
  rclone listremotes 2>/dev/null || echo "   （无已配置 remote）"
  echo ""
  echo "   若尚未配置 Google Drive remote，执行："
  echo "     rclone config"
  echo "   选择 n → 输入名称 gdrive → 选择 Google Drive → 按向导完成授权"
else
  echo "   ✕ rclone 未安装，请执行："
  echo "     brew install rclone"
  echo "   安装后再执行 rclone config 配置 Google Drive"
fi

# ─── 5. 检测 ~/.backup-secrets ───────────────────────────────────────────────
echo "5. 检测数据库配置..."
if [ -f "$SECRETS_FILE" ]; then
  echo "   ✓ $SECRETS_FILE 已存在"
else
  echo "   ✕ 未找到 $SECRETS_FILE"
  echo "   请执行以下命令创建（填入真实 DIRECT_URL）："
  echo ""
  echo "     cp $PROJECT_DIR/scripts/backup-secrets.template ~/.backup-secrets"
  echo "     chmod 600 ~/.backup-secrets"
  echo "     open ~/.backup-secrets   # 用编辑器填入密码"
fi

# ─── 6. 注册 launchd 定时任务 ────────────────────────────────────────────────
echo "6. 注册 launchd 定时任务..."
if [ ! -f "$PLIST_SRC" ]; then
  echo "   ✕ plist 文件未找到：$PLIST_SRC"
  echo "   请先确保 scripts/com.shopassistant.backup.plist 存在"
else
  # 替换 plist 中的 HOME 路径占位符
  sed "s|__HOME__|$HOME|g" "$PLIST_SRC" > "$PLIST_DEST"

  # 如果已加载则先卸载
  launchctl unload "$PLIST_DEST" 2>/dev/null || true
  launchctl load -w "$PLIST_DEST"
  echo "   ✓ launchd 定时任务已注册：$PLIST_DEST"
  echo "   每天凌晨 02:00 自动执行备份"
fi

echo ""
echo "===== 初始化完成 ====="
echo ""
echo "测试备份（立即执行一次）："
echo "  bash $SCRIPT_PATH"
echo ""
echo "查看 launchd 任务状态："
echo "  launchctl list | grep shopassistant"
echo ""
echo "查看备份日志："
echo "  tail -f $LOG_DIR/backup-shop-assistant.log"

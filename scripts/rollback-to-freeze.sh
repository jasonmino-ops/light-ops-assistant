#!/usr/bin/env bash
set -euo pipefail

TAG="${1:-}"

if [[ -z "$TAG" ]]; then
  echo "Usage: npm run rollback:freeze -- <tag>"
  echo "Example: npm run rollback:freeze -- beta-v1.1-real-store-trial"
  exit 2
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ERROR: this script must be run inside a git working tree."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: git working tree is not clean. Commit, stash, or discard local changes first."
  git status --short
  exit 1
fi

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
CURRENT_BRANCH="$(git branch --show-current || true)"

echo "Current branch: ${CURRENT_BRANCH:-detached}"
echo "Current commit: $CURRENT_COMMIT"
echo "Fetching tags..."
git fetch --tags

if ! git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "ERROR: tag not found: $TAG"
  echo "Available beta tags:"
  git tag --list 'beta-*'
  exit 1
fi

TARGET_COMMIT="$(git rev-list -n 1 "$TAG")"
TARGET_SHORT="$(git rev-parse --short "$TARGET_COMMIT")"
SAFE_TAG="$(printf '%s' "$TAG" | tr -c '[:alnum:]_.-' '-')"
ROLLBACK_BRANCH="rollback/${SAFE_TAG}-$(date +%Y%m%d%H%M%S)"

echo "Target tag: $TAG"
echo "Target commit: $TARGET_SHORT"
echo "Creating rollback branch: $ROLLBACK_BRANCH"
git switch -c "$ROLLBACK_BRANCH" "$TAG"

echo "Installing dependencies with npm ci..."
npm ci

echo "Generating Prisma client..."
npx prisma generate

echo "Running production build..."
npm run build

cat <<EOF

Rollback code preparation completed.

Rollback branch: $ROLLBACK_BRANCH
Rollback tag:    $TAG
Rollback commit: $TARGET_SHORT

This script DID NOT modify the production database.
It DID NOT run prisma migrate reset, destructive SQL, or data restore.
Database recovery must be manually approved after checking live trial data.

Next deployment options:
1. Prefer Vercel Dashboard -> Deployments -> promote the known-good frozen deployment.
2. Or push this rollback branch and deploy it after human approval:
   git push origin "$ROLLBACK_BRANCH"

Minimum post-deploy checks:
- /home
- /m/{storeCode} -> /menu?code=...
- /menu order submit
- /sale
- /cashier
- /records
- /dashboard
- /ops/login
- /bind?token=...
EOF

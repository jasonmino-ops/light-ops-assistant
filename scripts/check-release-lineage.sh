#!/usr/bin/env bash

set -u

print_field() {
  printf '%s\n%s\n' "$1" "$2"
}

echo 'E-Shop Release Lineage Gate'

if [ "$#" -ne 1 ] || [ -z "${1:-}" ]; then
  print_field 'Production SHA:' 'MISSING'
  print_field 'origin/main:' 'UNKNOWN'
  print_field 'Production ancestor of origin/main:' 'UNKNOWN'
  print_field 'Working tree:' 'UNKNOWN'
  print_field 'Safe Development Base:' 'NO'
  print_field 'RESULT:' 'BLOCKED'
  print_field 'REASON:' 'MISSING_PRODUCTION_SHA'
  exit 2
fi

production_input=$1

if ! repo_root=$(git rev-parse --show-toplevel 2>/dev/null); then
  print_field 'Production SHA:' "$production_input"
  print_field 'origin/main:' 'UNKNOWN'
  print_field 'Production ancestor of origin/main:' 'UNKNOWN'
  print_field 'Working tree:' 'UNKNOWN'
  print_field 'Safe Development Base:' 'NO'
  print_field 'RESULT:' 'BLOCKED'
  print_field 'REASON:' 'NOT_A_GIT_REPOSITORY'
  exit 1
fi

if ! production_sha=$(git -C "$repo_root" rev-parse --verify "${production_input}^{commit}" 2>/dev/null); then
  origin_main_sha=$(git -C "$repo_root" rev-parse --verify 'origin/main^{commit}' 2>/dev/null || true)
  working_tree='CLEAN'
  if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]; then
    working_tree='DIRTY'
  fi

  print_field 'Production SHA:' "$production_input"
  print_field 'origin/main:' "${origin_main_sha:-UNKNOWN}"
  print_field 'Production ancestor of origin/main:' 'UNKNOWN'
  print_field 'Working tree:' "$working_tree"
  print_field 'Safe Development Base:' 'NO'
  print_field 'RESULT:' 'BLOCKED'
  print_field 'REASON:' 'PRODUCTION_SHA_NOT_FOUND'
  exit 1
fi

if ! origin_main_sha=$(git -C "$repo_root" rev-parse --verify 'origin/main^{commit}' 2>/dev/null); then
  working_tree='CLEAN'
  if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]; then
    working_tree='DIRTY'
  fi

  print_field 'Production SHA:' "$production_sha"
  print_field 'origin/main:' 'UNKNOWN'
  print_field 'Production ancestor of origin/main:' 'UNKNOWN'
  print_field 'Working tree:' "$working_tree"
  print_field 'Safe Development Base:' 'NO'
  print_field 'RESULT:' 'BLOCKED'
  print_field 'REASON:' 'ORIGIN_MAIN_NOT_FOUND'
  exit 1
fi

working_tree='CLEAN'
if [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]; then
  working_tree='DIRTY'
fi

git -C "$repo_root" merge-base --is-ancestor "$production_sha" "$origin_main_sha"
lineage_status=$?

if [ "$lineage_status" -eq 0 ]; then
  production_is_ancestor='YES'
elif [ "$lineage_status" -eq 1 ]; then
  production_is_ancestor='NO'
else
  production_is_ancestor='UNKNOWN'
fi

safe_development_base='NO'
result='BLOCKED'
reason='LINEAGE_CHECK_FAILED'

if [ "$production_is_ancestor" = 'NO' ]; then
  reason='PRODUCTION_MAINLINE_DIVERGENCE'
elif [ "$production_is_ancestor" = 'YES' ] && [ "$working_tree" = 'DIRTY' ]; then
  reason='WORKING_TREE_DIRTY'
elif [ "$production_is_ancestor" = 'YES' ] && [ "$working_tree" = 'CLEAN' ]; then
  safe_development_base='YES'
  result='PASS'
  reason='NONE'
fi

print_field 'Production SHA:' "$production_sha"
print_field 'origin/main:' "$origin_main_sha"
print_field 'Production ancestor of origin/main:' "$production_is_ancestor"
print_field 'Working tree:' "$working_tree"
print_field 'Safe Development Base:' "$safe_development_base"
print_field 'RESULT:' "$result"
print_field 'REASON:' "$reason"

if [ "$result" = 'PASS' ]; then
  exit 0
fi

exit 1

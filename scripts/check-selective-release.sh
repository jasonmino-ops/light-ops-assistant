#!/usr/bin/env bash

set -u

repo_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$repo_root" ]; then
  printf '%s\n' 'AUTHORIZED_SELECTIVE_RELEASE: BLOCKED' 'REASON: NOT_A_GIT_REPOSITORY'
  exit 1
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mode="${1:-}"

if [ "$mode" = "--mode" ]; then
  mode_value="${2:-}"
  shift 2
else
  mode_value="selective"
fi

case "$mode_value" in
  selective)
    exec node "$script_dir/lib/release-provenance.mjs" selective "$@"
    ;;
  normal)
    exec node "$script_dir/lib/release-provenance.mjs" normal "$@"
    ;;
  *)
    printf '%s\n' 'AUTHORIZED_SELECTIVE_RELEASE: BLOCKED' 'REASON: INVALID_MODE'
    exit 2
    ;;
esac

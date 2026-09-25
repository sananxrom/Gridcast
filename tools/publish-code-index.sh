#!/usr/bin/env bash
# Publish the portable graph for other agents that share this source folder.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cbm_bin="${CBM_BIN:-codebase-memory-mcp}"
if ! command -v "$cbm_bin" >/dev/null 2>&1; then
  echo "Install codebase-memory-mcp 0.11.0 or set CBM_BIN to its executable." >&2
  exit 1
fi
# mkdir provides a shared-folder lock across hosts; private caches remain independent.
lock_dir="$repo_root/.codebase-memory/.refresh-lock"
mkdir -p "$repo_root/.codebase-memory"
if ! mkdir "$lock_dir" 2>/dev/null; then
  echo "Shared graph refresh is already locked. Retry after the other agent finishes." >&2
  exit 75
fi
trap 'rm -f "$lock_dir/owner"; rmdir "$lock_dir"' EXIT
printf 'host=%s\npid=%s\nstarted_utc=%s\n' "$(hostname)" "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$lock_dir/owner"
"$cbm_bin" cli index_repository --repo-path "$repo_root" --name gridcast --persistence true

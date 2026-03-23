#!/usr/bin/env bash
# Pull latest for all repos (skips repos with uncommitted changes)
set -euo pipefail
PROJECTS_DIR="${PROJECTS_DIR:-/c/Users/oscar/Projects}"
REPOS=(
  2050-fashion-brand brand-studio by2050-hydrogen fitness-goals
  moltbot org-docs-ai ozewine personal-website thirsti
  vacso-hub vacso-landing-page vacso-telemetry-service wiyd-landing-page
)

for repo in "${REPOS[@]}"; do
  dir="$PROJECTS_DIR/$repo"
  [ -d "$dir/.git" ] || continue
  changes=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$changes" -gt 0 ]; then
    echo "SKIP $repo ($changes uncommitted changes)"
    continue
  fi
  echo "PULL $repo ..."
  git -C "$dir" pull --ff-only 2>&1 | sed "s/^/  /"
done

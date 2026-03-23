#!/usr/bin/env bash
# Show git status across all VACSO repos
set -euo pipefail
PROJECTS_DIR="${PROJECTS_DIR:-/c/Users/oscar/Projects}"
REPOS=(
  2050-fashion-brand brand-studio by2050-hydrogen fitness-goals
  moltbot org-docs-ai ozewine personal-website thirsti
  vacso-hub vacso-landing-page vacso-telemetry-service wiyd-landing-page
)

printf "%-30s %-12s %8s %6s %6s\n" "REPO" "BRANCH" "CHANGES" "AHEAD" "BEHIND"
printf "%-30s %-12s %8s %6s %6s\n" "----" "------" "-------" "-----" "------"

for repo in "${REPOS[@]}"; do
  dir="$PROJECTS_DIR/$repo"
  [ -d "$dir/.git" ] || continue
  branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "detached")
  changes=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  behind=$(git -C "$dir" rev-list --count HEAD..@{upstream} 2>/dev/null || echo "?")
  ahead=$(git -C "$dir" rev-list --count @{upstream}..HEAD 2>/dev/null || echo "?")

  icon=" "
  [ "$changes" -gt 0 ] && icon="*"

  printf "%s %-29s %-12s %8s %6s %6s\n" "$icon" "$repo" "$branch" "$changes" "$ahead" "$behind"
done

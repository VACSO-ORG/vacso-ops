#!/usr/bin/env bash
# Check for outdated dependencies across all repos
set -euo pipefail
PROJECTS_DIR="${PROJECTS_DIR:-/c/Users/oscar/Projects}"
REPOS=(
  2050-fashion-brand brand-studio by2050-hydrogen fitness-goals
  moltbot org-docs-ai ozewine personal-website thirsti
  vacso-hub vacso-landing-page vacso-telemetry-service wiyd-landing-page
)

for repo in "${REPOS[@]}"; do
  dir="$PROJECTS_DIR/$repo"
  if [ -f "$dir/package.json" ]; then
    echo "=== $repo ==="
    (cd "$dir" && npm outdated 2>/dev/null || true) | head -20
    echo ""
  elif [ -f "$dir/requirements.txt" ] || [ -f "$dir/pyproject.toml" ]; then
    echo "=== $repo (python) ==="
    echo "  (run 'pip list --outdated' manually)"
    echo ""
  fi
done

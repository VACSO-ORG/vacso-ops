#!/usr/bin/env bash
# sync-secrets.sh — Sync secrets from 1Password to GitHub + Vercel
#
# Reads API keys from 1Password vaults and pushes them to:
#   - GitHub Actions secrets (per-repo)
#   - Vercel environment variables (for vacso-landing-page)
#
# Prerequisites:
#   - op CLI authenticated (OP_SERVICE_ACCOUNT_TOKEN in env)
#   - gh CLI authenticated
#   - vercel CLI authenticated
#
# Usage:
#   ./sync-secrets.sh          # Sync all secrets
#   ./sync-secrets.sh --dry    # Show what would be synced without writing

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry" ]] && DRY_RUN=true

VAULT="VACSO API Keys"
GITHUB_ORG="VACSO-ORG"
LANDING_PAGE_DIR="$HOME/Projects/vacso-landing-page"

# ── Secret mappings: 1Password item → env var name ──
# Format: "1Password Item Title|field|ENV_VAR_NAME|github_repos|vercel"
# github_repos: comma-separated repo names, or "all" for all repos, or "" for none
# vercel: "yes" to push to Vercel landing page, "" for no

ALL_REPOS="vacso-hub,brand-studio,vacso-telemetry-service,vacso-landing-page,by2050-hydrogen,wiyd-landing-page,personal-website"
COVERAGE_REPOS="vacso-hub,brand-studio,vacso-telemetry-service"

SECRETS=(
  "SonarQube API KEY|credential|SONAR_TOKEN|all|yes"
  "Codecov Token|credential|CODECOV_TOKEN|${COVERAGE_REPOS}|"
  "SNYK API KEY|credential|SNYK_TOKEN|all|yes"
  "YouTube API KEY|credential|YOUTUBE_API_KEY||yes"
)

echo "🔐 Syncing secrets from 1Password → GitHub + Vercel"
echo ""

for entry in "${SECRETS[@]}"; do
  IFS='|' read -r item field env_var repos vercel <<< "$entry"

  echo "── $env_var (from '$item')"

  # Read from 1Password
  value=$(op item get "$item" --vault "$VAULT" --fields "$field" --reveal 2>/dev/null) || {
    echo "   ⚠️  Not found in 1Password, skipping"
    continue
  }

  if [[ -z "$value" ]]; then
    echo "   ⚠️  Empty value, skipping"
    continue
  fi

  echo "   ✓ Read from 1Password (${#value} chars)"

  # Push to GitHub repos
  if [[ -n "$repos" ]]; then
    target_repos="$repos"
    [[ "$repos" == "all" ]] && target_repos="$ALL_REPOS"

    IFS=',' read -ra repo_list <<< "$target_repos"
    for repo in "${repo_list[@]}"; do
      if $DRY_RUN; then
        echo "   [dry] Would set on GitHub: $GITHUB_ORG/$repo"
      else
        echo "$value" | gh secret set "$env_var" -R "$GITHUB_ORG/$repo" 2>/dev/null && \
          echo "   ✓ GitHub: $repo" || \
          echo "   ✗ GitHub: $repo (failed)"
      fi
    done
  fi

  # Push to Vercel
  if [[ "$vercel" == "yes" ]]; then
    if $DRY_RUN; then
      echo "   [dry] Would set on Vercel: vacso-landing-page (production)"
    else
      # Remove existing, then add (Vercel doesn't have upsert)
      (cd "$LANDING_PAGE_DIR" && vercel env rm "$env_var" production -y 2>/dev/null || true)
      (cd "$LANDING_PAGE_DIR" && echo "$value" | vercel env add "$env_var" production 2>/dev/null) && \
        echo "   ✓ Vercel: vacso-landing-page" || \
        echo "   ✗ Vercel: vacso-landing-page (failed)"
    fi
  fi

  echo ""
done

echo "✅ Secret sync complete"

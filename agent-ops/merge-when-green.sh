#!/usr/bin/env bash
# Merge a PR once its REQUIRED checks pass, updating the branch when master moves. Never uses --admin.
# Usage: bash C:/Users/oscar/Projects/vacso-ops/agent-ops/merge-when-green.sh <owner/repo> <pr-number> [max-attempts]
# Note: merging a Vercel-linked site repo deploys that site; merging vacso-hub only stages (see release-hub).
set -u
REPO="$1"; PR="$2"; MAX="${3:-5}"
STATE="${LOCALAPPDATA:-$HOME}/VACSO/agent-ops"; mkdir -p "$STATE"
log() { printf '{"at":"%s","tool":"merge-when-green","repo":"%s","pr":%s,%s}\n' "$(date -u +%FT%TZ)" "$REPO" "$PR" "$1" >> "$STATE/audit.jsonl"; }

if [ -n "$(git -C /c/Users/oscar/Projects/vacso-ops status --porcelain -- agent-ops)" ]; then echo "REFUSED: agent-ops has uncommitted changes"; exit 1; fi

for attempt in $(seq 1 "$MAX"); do
  state=$(gh pr view "$PR" --repo "$REPO" --json state --jq .state)
  if [ "$state" = "MERGED" ]; then echo "#$PR already merged"; log '"outcome":"already-merged"'; exit 0; fi
  if [ "$state" != "OPEN" ]; then echo "#$PR is $state"; log "\"outcome\":\"$state\""; exit 1; fi
  sleep 20
  gh pr checks "$PR" --repo "$REPO" --required --watch --interval 60 >/dev/null 2>&1
  if ! gh pr checks "$PR" --repo "$REPO" --required >/dev/null 2>&1; then
    echo "#$PR REQUIRED CHECKS FAILED:"; gh pr checks "$PR" --repo "$REPO" --required 2>&1 | grep -v -w pass
    log '"outcome":"checks-failed"'; exit 1
  fi
  if gh pr merge "$PR" --repo "$REPO" --squash >/dev/null 2>&1; then
    sha=$(gh pr view "$PR" --repo "$REPO" --json mergeCommit --jq .mergeCommit.oid)
    echo "#$PR MERGED $sha"; log "\"outcome\":\"merged\",\"sha\":\"$sha\",\"attempt\":$attempt"; exit 0
  fi
  ms=$(gh pr view "$PR" --repo "$REPO" --json mergeStateStatus --jq .mergeStateStatus)
  if [ "$ms" = "DIRTY" ]; then echo "#$PR has conflicts; resolve them in its branch"; log '"outcome":"conflicts"'; exit 1; fi
  echo "#$PR merge refused ($ms), updating branch (attempt $attempt)"
  gh pr update-branch "$PR" --repo "$REPO" >/dev/null 2>&1
done
echo "#$PR gave up after $MAX attempts"; log '"outcome":"gave-up"'; exit 1

# vacso-ops

Bash scripts for managing the VACSO project portfolio (14 repos). All scripts use `PROJECTS_DIR` env var, defaulting to `/c/Users/oscar/Projects`.

## Stack
- Bash scripts (no dependencies)
- Docker CLI for infrastructure management

## Key files
- `scripts/status.sh` — cross-repo git status dashboard
- `scripts/pull-all.sh` — safe bulk pull (skips dirty repos)
- `scripts/infra-up.sh` — start Portainer + Uptime Kuma + VACSO Hub

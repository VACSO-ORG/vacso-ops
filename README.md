# vacso-ops

Infrastructure and management scripts for the VACSO project portfolio.

## Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/status.sh` | Git status across all 13 repos | `bash scripts/status.sh` |
| `scripts/pull-all.sh` | Pull latest (skips dirty repos) | `bash scripts/pull-all.sh` |
| `scripts/deps-check.sh` | Check outdated npm dependencies | `bash scripts/deps-check.sh` |
| `scripts/docker-status.sh` | Docker containers, resources, disk | `bash scripts/docker-status.sh` |
| `scripts/infra-up.sh` | Start all infrastructure services | `bash scripts/infra-up.sh` |

## Infrastructure

Portainer CE and Uptime Kuma are managed via `docker-compose.infra.yml` at the Projects root.

| Service | URL | Purpose |
|---------|-----|---------|
| Portainer | https://localhost:9443 | Docker container management |
| Uptime Kuma | http://localhost:3002 | Service & site monitoring |

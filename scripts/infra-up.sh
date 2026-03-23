#!/usr/bin/env bash
# Start all VACSO infrastructure services
set -euo pipefail
PROJECTS_DIR="${PROJECTS_DIR:-/c/Users/oscar/Projects}"

echo "Starting infrastructure (Portainer + Uptime Kuma)..."
docker compose -f "$PROJECTS_DIR/docker-compose.infra.yml" up -d

echo ""
echo "Starting VACSO Hub stack..."
docker compose -f "$PROJECTS_DIR/vacso-hub/docker-compose.yml" up -d

echo ""
echo "All services started:"
echo "  Portainer:   https://localhost:9443"
echo "  Uptime Kuma: http://localhost:3002"
echo "  VACSO Hub:   http://localhost:3000"
echo "  Grafana:     http://localhost:3001"

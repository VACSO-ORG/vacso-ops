#!/usr/bin/env bash
# Show all VACSO Docker containers, images, volumes, and resource usage

echo "=== Running Containers ==="
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null

echo ""
echo "=== Resource Usage ==="
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null

echo ""
echo "=== Infrastructure Volumes ==="
docker volume ls --format "table {{.Name}}\t{{.Driver}}" 2>/dev/null | grep -E "vacso|portainer|uptime|hub"

echo ""
echo "=== Disk Usage ==="
docker system df 2>/dev/null

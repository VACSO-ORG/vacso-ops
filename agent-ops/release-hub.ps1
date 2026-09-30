# Release the current vacso-hub master to the LOCAL Hub runtime (vacsoserver, Tailscale).
# Usage: powershell.exe -NoProfile -File C:/Users/oscar/Projects/vacso-ops/agent-ops/release-hub.ps1 --sha master [--execute]
# All gates live in lib/release.mjs; see agent-ops/README.md.
$NODE = 'C:/Users/oscar/AppData/Roaming/fnm/node-versions/v24.19.0/installation/node.exe'
& $NODE (Join-Path $PSScriptRoot 'lib\release.mjs') @args
exit $LASTEXITCODE

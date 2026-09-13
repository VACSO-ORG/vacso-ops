# Tailscale watchdog for VACSOServer.
#
# Why: on 8 September 2026 the node key expired, Tailscale silently logged out,
# and the server was unreachable from every other device until someone noticed
# from the machine itself. Disabling key expiry in the admin console is the real
# fix; this script is the alarm in case anything else ever drops the node.
#
# What it does, every 15 minutes (scheduled task "VACSO Tailscale Watchdog"):
#   - If the backend is Running: record the time in state.json and remove any
#     stale re-login file, so an old link never sits around looking live.
#   - If it is anything else: start `tailscale login`, wait for the daemon to
#     publish an auth URL, and write that URL (with a timestamp) to a file in
#     OneDrive, which syncs to Oscar's other devices. Also writes to the Windows
#     Application event log so it is visible in Event Viewer.
# It never writes secrets. The auth URL is single use and expires on its own.

$ErrorActionPreference = 'Continue'
$ts       = 'C:\Program Files\Tailscale\tailscale.exe'
$stateDir = 'C:\ProgramData\VACSO'
$state    = Join-Path $stateDir 'tailscale-watchdog-state.json'
$alert    = 'C:\Users\oscar\OneDrive\VACSOServer-TAILSCALE-NEEDS-LOGIN.txt'
$source   = 'VACSO Tailscale Watchdog'

if (-not [System.Diagnostics.EventLog]::SourceExists($source)) {
  try { New-EventLog -LogName Application -Source $source } catch {}
}
function Log([string]$msg, [string]$type = 'Information') {
  try { Write-EventLog -LogName Application -Source $source -EventId 1 -EntryType $type -Message $msg } catch {}
}

function Status() {
  try { return (& $ts status --json 2>$null | ConvertFrom-Json) } catch { return $null }
}

$now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$s = Status
$backend = if ($s) { $s.BackendState } else { 'Unknown' }

if ($backend -eq 'Running') {
  if (Test-Path $alert) { Remove-Item $alert -Force -ErrorAction SilentlyContinue; Log "Tailscale is back (Running). Removed the re-login file." }
  @{ lastOk = $now; backend = $backend; keyExpiry = $s.Self.KeyExpiry } | ConvertTo-Json | Set-Content -Path $state -Encoding utf8
  exit 0
}

# Not running. Ask the daemon to start a login and wait for the URL it publishes.
Log "Tailscale backend is '$backend', not Running. Requesting a login URL." 'Warning'
if (-not $s -or -not $s.AuthURL) {
  Start-Process -FilePath $ts -ArgumentList 'login' -WindowStyle Hidden -ErrorAction SilentlyContinue
}
$url = $null
for ($i = 0; $i -lt 12 -and -not $url; $i++) {
  Start-Sleep -Seconds 5
  $s = Status
  if ($s -and $s.AuthURL) { $url = $s.AuthURL }
  if ($s -and $s.BackendState -eq 'Running') { break }
}

if ($s -and $s.BackendState -eq 'Running') {
  Log "Tailscale recovered on its own (Running)."
  exit 0
}

$body = @(
  "VACSOServer has dropped off Tailscale.",
  "Detected: $now (server local time). Backend state: $backend.",
  "",
  "To bring it back, open this link on any device signed in to the Tailscale account and approve the machine:",
  ($(if ($url) { $url } else { "(no login URL yet; the watchdog will try again in 15 minutes)" })),
  "",
  "Then, in the admin console, disable key expiry for vacsoserver so this stops recurring:",
  "https://login.tailscale.com/admin/machines"
) -join "`r`n"
try { Set-Content -Path $alert -Value $body -Encoding utf8 } catch { Log "Could not write the re-login file: $($_.Exception.Message)" 'Error' }
Log ("Wrote re-login instructions to $alert. URL: " + $(if ($url) { $url } else { 'none yet' })) 'Warning'
@{ lastFail = $now; backend = $backend; authUrl = $url } | ConvertTo-Json | Set-Content -Path $state -Encoding utf8
exit 1

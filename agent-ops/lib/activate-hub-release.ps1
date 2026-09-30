<#
Local Hub release driver (vacsoserver, served over Tailscale). Called ONLY by agent-ops\release-hub.ps1,
which enforces the gates (master head, required CI green, single-flight lock, toolkit integrity, audit).

Derived from activate-prod-frontend.v4.ps1 (29 Sep 2026). Differences:
  - env changes come from -EnvChangesFile (a reviewed, committed file) instead of a hardcoded list; none by default
  - sign-in is resolved (passkey sessions live since 29 Sep), so the production bundle is always used

Runs activation-runbook.md steps 1-10 with the pinned tooling in
%LOCALAPPDATA%\VACSO\recovery\reboot-activation-plan-20260923:
  1 checkout, 2 npm ci, 2b client build, 3 images, 4 DB dump, 5 prepare (v4), 6 verify (v4),
  7 compose (LIVE), 8 frontend (LIVE), 9 finalize (v4), 10 checks.
Rollback: steps 1-6 fail -> nothing live changed. Step 7/8 fail -> R1 restores the previous compose.
Step 9 fail -> stop, never rerun blindly. Never prints *.private.json. Never deletes candidates, dumps or checkouts.
Default is a DRY RUN.
#>
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-f]{40}$')][string]$NewSha,
  [string]$EnvChangesFile = '',
  [switch]$Execute,
  [switch]$SkipStartupTaskRerun
)
$ErrorActionPreference = 'Stop'
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue   # npm ci must install devDependencies (vite)
# Windows bsdtar first: when launched from Git Bash, GNU tar leads PATH and reads 'C:\...' as a remote host.
$env:PATH = "$env:SystemRoot\System32;" + $env:PATH

$S12  = $NewSha.Substring(0,12)
$B    = 'C:\Users\oscar\AppData\Local\VACSO\recovery\reboot-activation-plan-20260923'
$NODE = 'C:/Users/oscar/AppData/Roaming/fnm/node-versions/v24.19.0/installation/node.exe'
$REPO = 'C:\Users\oscar\projects\vacso-hub'
$RUNTIME = Join-Path $env:LOCALAPPDATA 'VACSO\workflow\hub-runtime'
$CAND = "$B\candidate-$S12"
$DEPS = "$B\dependencies-$S12.json"
$CLIENT_RECEIPT = "$B\client-build-$S12.json"
$BACKUP = "before-release-$S12"
$LOG  = Join-Path $B ("agent-ops-release-$S12-" + (Get-Date -Format yyyyMMddHHmmss) + '.log')

# ---------- reviewed env changes ----------
$ENV_CHANGES = @(); $expectChanges = 0; $expectAsserts = 0
if ($EnvChangesFile) {
  $spec = Get-Content -LiteralPath $EnvChangesFile -Raw | ConvertFrom-Json
  foreach ($pair in $spec.changes) {
    $flag = [string]$pair[0]; $val = [string]$pair[1]
    if ($flag -notin @('--env-set','--env-set-from','--env-unset','--env-assert')) { throw "Unknown env flag in $EnvChangesFile : $flag" }
    $ENV_CHANGES += @($flag, $val)
    if ($flag -eq '--env-assert') { $expectAsserts++ } else { $expectChanges++ }
  }
}

function Say([string]$m) { $line = (Get-Date -Format o) + ' ' + $m; Write-Host $line; if ($Execute) { Add-Content -LiteralPath $LOG -Value $line } }
function Invoke-PinnedNode([string[]]$argv, [string]$what) {
  & $NODE @argv
  if ($LASTEXITCODE -ne 0) { throw ($what + ' failed (exit ' + $LASTEXITCODE + ')') }
}
function Get-Json([string]$url) { Invoke-RestMethod -Uri $url -TimeoutSec 5 }

# ---------- preconditions (read-only) ----------
# Image builder: the newest pinned build-final-images[.vN].cjs. Each lockfile change ships a new builder with a
# rebuilt base image (see build-final-images.v2.README.md); older builders refuse newer lockfiles.
$BUILDER = Get-ChildItem -LiteralPath $B -File | Where-Object { $_.Name -match '^build-final-images(\.v(\d+))?\.cjs$' } |
  Sort-Object { if ($_.Name -match '\.v(\d+)\.cjs$') { [int]$Matches[1] } else { 1 } } -Descending | Select-Object -First 1
if (-not $BUILDER) { throw 'No build-final-images*.cjs in the pinned tooling' }
$BUILDER = $BUILDER.FullName
foreach ($f in @('build-release-client.v3.cjs','prepare-release.v4.cjs','reviewed-env.v4.cjs','activate-frontend.v3.cjs','verify-candidate.v4.cjs','finalize-activation.v4.cjs','install-release-dependencies.ps1','backup-runtime.cjs')) {
  if (-not (Test-Path -LiteralPath (Join-Path $B $f))) { throw "Missing tooling: $f" }
}
if (-not (Test-Path -LiteralPath $NODE)) { throw 'Pinned Node 24.19.0 is missing' }
$prevActive = Get-Content -LiteralPath (Join-Path $RUNTIME 'active.json') -Raw | ConvertFrom-Json
$prevCompose = $prevActive.compose
if (-not (Test-Path -LiteralPath $prevCompose)) { throw 'Previous active compose file is missing; R1 would be impossible' }
if ($prevActive.sourceHead -eq $NewSha) { throw 'NewSha is already the active release' }
if (Test-Path -LiteralPath $CAND) { throw "Candidate folder already exists: $CAND (preserve it and inspect)" }
# Leftovers from an earlier attempt that failed before step 5 (no candidate, nothing live changed) are kept,
# renamed with a .failed-<time> suffix, so a retry can start clean. A dump receipt is never moved.
if (Test-Path -LiteralPath "$B\$BACKUP.json") { throw "DB dump receipt already exists, preserve and inspect: $B\$BACKUP.json" }
$stamp = Get-Date -Format yyyyMMddHHmmss
foreach ($p in @($DEPS, $CLIENT_RECEIPT, "$B\image-build-$S12")) {
  if (Test-Path -LiteralPath $p) {
    if ($Execute) { Rename-Item -LiteralPath $p -NewName ((Split-Path $p -Leaf) + ".failed-$stamp") }
    Write-Host "Earlier failed attempt left $p; it will be kept as .failed-$stamp"
  }
}
$REL = 'C:\Users\oscar\projects\vacso-hub-release-' + (Get-Date -Format yyyyMMdd)
foreach ($suffix in @('','-b','-c','-d','-e','-f','-g','-h','-i','-j','-k','-l')) { if (-not (Test-Path -LiteralPath ($REL + $suffix))) { $REL = $REL + $suffix; break } }
if (Test-Path -LiteralPath $REL) { throw 'No free release checkout name for today' }
foreach ($v in $ENV_CHANGES) { if ($v -match '=dotenv:(.+):[A-Z0-9_]+$' -and -not (Test-Path -LiteralPath $Matches[1])) { throw "Env source file missing: $($Matches[1])" } }

Say ("Plan: NEWSHA=$NewSha REL=$REL CAND=$CAND previous=" + $prevActive.sourceHead + " builder=" + (Split-Path $BUILDER -Leaf))
if ($ENV_CHANGES.Count -gt 0) {
  $shown = for ($i = 0; $i -lt $ENV_CHANGES.Count; $i += 2) { $ENV_CHANGES[$i] + ' ' + ($ENV_CHANGES[$i+1] -replace '=(dotenv|pm2|container):.*$','=<from $1 source>') }
  Say ('Reviewed env changes (values never printed): ' + ($shown -join '; '))
} else { Say 'Env: unchanged from the live containers' }
if (-not $Execute) { Say 'DRY RUN: no step executed.'; return }

$live = $false   # becomes true once step 7 starts
try {
  Say 'Step 1: fetch + detached release checkout'
  git -C $REPO fetch origin; if ($LASTEXITCODE -ne 0) { throw 'git fetch failed' }
  if ((git -C $REPO rev-parse origin/master) -ne $NewSha) { throw 'origin/master is not NEWSHA' }
  git -C $REPO worktree add --detach $REL $NewSha; if ($LASTEXITCODE -ne 0) { throw 'worktree add failed' }
  if (git -C $REL status --porcelain --untracked-files=normal) { throw 'Release checkout is not clean' }

  Say 'Step 2: npm ci (install-release-dependencies.ps1 -Install)'
  & powershell -NoProfile -File "$B\install-release-dependencies.ps1" -SourceRoot $REL -SourceHead $NewSha -NodePath $NODE -Install
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $DEPS)) { throw 'Dependency install failed; no receipt' }

  Say 'Step 2b: production client build'
  Invoke-PinnedNode @("$B\build-release-client.v3.cjs",'--source',$REL,'--head',$NewSha,'--dependency-receipt',$DEPS,'--build') 'Client build'
  Invoke-PinnedNode @("$B\build-release-client.v3.cjs",'--verify',$CLIENT_RECEIPT) 'Client build verification'

  Say 'Step 3: backend + MCP images'
  Say "Image builder: $BUILDER"
  Invoke-PinnedNode @($BUILDER,$REL,$NewSha) 'Image build'

  Say 'Step 4: fresh DB dump'
  Invoke-PinnedNode @("$B\backup-runtime.cjs",$BACKUP) 'DB backup'
  $r = Get-Content -LiteralPath "$B\$BACKUP.json" -Raw | ConvertFrom-Json
  if ((Get-FileHash -LiteralPath $r.path -Algorithm SHA256).Hash.ToLower() -ne $r.sha256 -or $r.tocEntries -lt 4000 -or $r.systemIdentifier -ne '7644177651090141223') { throw 'DB dump verification failed' }

  Say 'Step 5: prepare-release.v4'
  Invoke-PinnedNode (@("$B\prepare-release.v4.cjs",'--source',$REL,'--head',$NewSha,'--image',"vacso-hub-final-backend:$S12",'--mcp-image',"vacso-hub-final-mcp:$S12",'--dependency-receipt',$DEPS,'--client-build-receipt',$CLIENT_RECEIPT) + $ENV_CHANGES) 'Prepare release'
  $plan = Get-Content -LiteralPath "$CAND\plan.json" -Raw | ConvertFrom-Json
  if ($plan.frontendMode -ne 'production-build') { throw 'Candidate is not a production-build candidate' }
  if (@($plan.reviewedEnvironmentChanges).Count -ne $expectChanges -or @($plan.reviewedEnvironmentAssertions).Count -ne $expectAsserts) { throw "Candidate does not carry exactly the $expectChanges reviewed env changes and $expectAsserts assertions" }

  Say 'Step 6: verify-candidate.v4 --final'
  Invoke-PinnedNode @("$B\verify-candidate.v4.cjs",$CAND,'--final') 'Pre-activation verification'
  Invoke-PinnedNode @("$B\build-release-client.v3.cjs",'--verify',$CLIENT_RECEIPT) 'Client build re-verification'

  Say 'Step 7: LIVE compose switch (server, worker, mcp-hub)'
  $live = $true
  docker compose -p vacso-consolidated -f "$CAND\compose-candidate.private.json" up -d --no-build --pull never
  if ($LASTEXITCODE -ne 0) { throw 'STEP7: compose up failed' }
  $deadline = (Get-Date).AddMinutes(5); $ok = $false
  do {
    Start-Sleep -Seconds 5
    try { $v = Get-Json 'http://127.0.0.1:8080/api/v1/system/version'; $h = Get-Json 'http://127.0.0.1:8080/health'
      if ($h.serviceInitialization.status -eq 'failed') { throw 'STEP7: service initialization failed' }
      $ok = ($v.data.commit -eq $NewSha -and $h.serviceInitialization.status -eq 'completed' -and $h.serviceReadiness.ready) } catch { if ($_.Exception.Message -like 'STEP7*') { throw } }
  } until ($ok -or (Get-Date) -gt $deadline)
  if (-not $ok) { throw 'STEP7: API did not reach readiness with the new stamp within 5 minutes' }

  Say 'Step 8: LIVE frontend switch to the production build'
  & $NODE "$B\activate-frontend.v3.cjs" $CAND
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path -LiteralPath "$CAND\frontend-rollback-result.json") { Say ('Frontend rollback result: ' + (Get-Content -LiteralPath "$CAND\frontend-rollback-result.json" -Raw)) }
    throw 'STEP8: frontend activation failed (previous hub-client restored by the script)'
  }

  Say 'Step 9: finalize-activation.v4'
  & $NODE "$B\finalize-activation.v4.cjs" $CAND
  if ($LASTEXITCODE -ne 0) { $live = $false; throw 'STEP9: finalization failed. Do NOT rerun. Inspect finalization-*.json and finalization.lock in the candidate folder.' }
  $receipt = Get-Content -LiteralPath "$CAND\activation-receipt.json" -Raw | ConvertFrom-Json
  if (-not $receipt.complete) { $live = $false; throw 'STEP9: receipt not complete' }
  $live = $false

  Say 'Step 10: post-activation checks'
  $v = Get-Json 'http://127.0.0.1:8080/api/v1/system/version'; if ($v.data.commit -ne $NewSha) { throw 'STEP10: API stamp differs' }
  $shellPage = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/today' -Headers @{Accept='text/html'} -TimeoutSec 10
  if ($shellPage.Content -match '/@vite/client' -or $shellPage.Content -notmatch '/assets/index-') { throw 'STEP10: :3000 is not serving the built shell' }
  foreach ($u in @('http://127.0.0.1:3000/sw.js','http://127.0.0.1:3018/sw.js')) {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 10
    if ($resp.StatusCode -ne 200 -or $resp.Headers['Cache-Control'] -ne 'no-cache') { throw "STEP10: $u not served with no-cache" }
  }
  & powershell -NoProfile -File (Join-Path $RUNTIME 'start-hub.ps1') -Status
  if ($LASTEXITCODE -ne 0) { throw 'STEP10: start-hub -Status failed' }
  if (-not $SkipStartupTaskRerun) {
    Start-ScheduledTask -TaskName 'VACSO-Hub-Consolidated'
    $until = (Get-Date).AddMinutes(35)
    do { Start-Sleep -Seconds 10; $state = (Get-ScheduledTask -TaskName 'VACSO-Hub-Consolidated').State } while ($state -eq 'Running' -and (Get-Date) -lt $until)
    $result = (Get-ScheduledTaskInfo -TaskName 'VACSO-Hub-Consolidated').LastTaskResult
    if ($result -ne 0) { throw "STEP10: startup task rerun returned $result; read hub-runtime\startup.log" }
  }
  Say "DONE: $NewSha active."
}
catch {
  $msg = $_.Exception.Message
  Say ('FAILED: ' + $msg)
  if ($live -and ($msg -like 'STEP7*' -or $msg -like 'STEP8*')) {
    Say 'R1: restoring the previous containers from the previous active compose (saving server logs first)'
    docker logs --tail 400 vacso-consolidated-server-1 *> (Join-Path $B "failed-server-$S12.log")
    docker compose -p vacso-consolidated -f $prevCompose up -d --no-build --pull never
    if ($LASTEXITCODE -ne 0) { Say 'R1 compose FAILED: inspect immediately' }
    else {
      $deadline = (Get-Date).AddMinutes(5); $ok = $false
      do { Start-Sleep -Seconds 5; try { $v = Get-Json 'http://127.0.0.1:8080/api/v1/system/version'; $h = Get-Json 'http://127.0.0.1:8080/health'; $ok = ($v.data.commit -eq $prevActive.sourceHead -and $h.serviceReadiness.ready) } catch {} } until ($ok -or (Get-Date) -gt $deadline)
      Say ('R1 API back on ' + $prevActive.sourceHead + ': ' + $ok)
    }
  } elseif (-not $live) {
    Say 'No automatic rollback: nothing live changed (steps 1-6) or finalization needs inspection (step 9/10).'
  }
  throw
}

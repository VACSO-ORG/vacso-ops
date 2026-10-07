// Gatekeeper for local Hub releases. Entry: agent-ops/release-hub.ps1 -> node lib/release.mjs
//   --sha <40-hex | master>   commit to release (must equal origin/master)
//   --execute                 perform it; default is a dry run
// Gates: toolkit integrity, origin/master == sha, the merged PR's required checks all SUCCESS,
// single-flight lock, reviewed env changes applied at most once. Audited; result raised to the inbox.
// Before the image build, the base images are brought level with the commit's lockfiles when
// they differ (rebuild-bases.mjs), so a dependency pin no longer needs a hand-run script.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HUB_REPO, OPS_ROOT, STATE_DIR, acquireLock, assertToolkitIntegrity, audit, notifyInbox, run } from './common.mjs';
import { ensureBases } from './rebuild-bases.mjs';

const GH_REPO = 'VACSO-ORG/vacso-hub';
const argv = process.argv.slice(2);
const execute = argv.includes('--execute');
const shaArg = argv[argv.indexOf('--sha') + 1];
if (!argv.includes('--sha') || !shaArg) {
  console.error('usage: release-hub.ps1 --sha <40-hex|master> [--execute]');
  process.exit(2);
}

function requiredChecksGreen(sha) {
  const pulls = JSON.parse(run('gh', ['api', `repos/${GH_REPO}/commits/${sha}/pulls`]));
  const pr = pulls.find((p) => p.merged_at && p.base?.ref === 'master');
  if (!pr) throw new Error(`no merged master PR found for ${sha}`);
  const protection = JSON.parse(run('gh', ['api', `repos/${GH_REPO}/branches/master/protection/required_status_checks`]));
  const required = protection.contexts ?? [];
  const rollup = JSON.parse(run('gh', ['pr', 'view', String(pr.number), '--repo', GH_REPO, '--json', 'statusCheckRollup'])).statusCheckRollup;
  const missing = required.filter((ctx) => !rollup.some((c) => (c.name ?? c.context) === ctx && (c.conclusion ?? c.state) === 'SUCCESS'));
  if (missing.length) throw new Error(`PR #${pr.number}: required checks not green: ${missing.join(', ')}`);
  return { pr: pr.number, required };
}

function pendingEnv() {
  const file = path.join(OPS_ROOT, 'agent-ops', 'release-env', 'pending.json');
  if (!fs.existsSync(file)) return null;
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!spec.id || !Array.isArray(spec.changes)) throw new Error('release-env/pending.json needs id and changes');
  const applied = path.join(STATE_DIR, 'applied-env', `${spec.id}.json`);
  if (fs.existsSync(applied)) return null; // already applied in an earlier release
  return { file, spec, applied };
}

let release = () => {};
const started = Date.now();
try {
  assertToolkitIntegrity();
  run('git', ['-C', HUB_REPO, 'fetch', '--quiet', 'origin']);
  const master = run('git', ['-C', HUB_REPO, 'rev-parse', 'origin/master']);
  const sha = shaArg === 'master' ? master : shaArg;
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('sha must be 40 hex characters or "master"');
  if (sha !== master) throw new Error(`${sha} is not origin/master (${master}); release the current master`);
  const ci = requiredChecksGreen(sha);
  const env = pendingEnv();
  console.log(`Gates passed: ${sha} is master, PR #${ci.pr} required checks green (${ci.required.join(', ')}).`);
  console.log(env ? `Env changes: ${env.spec.id} (${env.spec.changes.length} entries, ${env.spec.reason ?? 'no reason given'})` : 'Env changes: none');

  if (execute) {
    // Other sessions release with their own drivers (activate-prod-frontend.vN.ps1); never run alongside one.
    const others = run('powershell', ['-NoProfile', '-Command',
      "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'activate-prod-frontend|build-final-images|prepare-release|activate-frontend|finalize-activation' -and $_.CommandLine -notmatch 'Get-CimInstance' } | ForEach-Object { $_.ProcessId }"]);
    if (others) throw new Error(`another release is running (pids ${others.split(/\s+/).join(', ')}); wait for it to finish`);
    release = acquireLock('hub-release', 3 * 60 * 60 * 1000);
  }
  // The bases first: a lockfile change rebuilds the base that carries it and writes the next
  // builder, which the driver below picks up as the newest. A dry run only says what would happen.
  const bases = ensureBases(sha, execute);
  const psArgs = ['-NoProfile', '-File', path.join(OPS_ROOT, 'agent-ops', 'lib', 'activate-hub-release.ps1'), '-NewSha', sha];
  if (env) psArgs.push('-EnvChangesFile', env.file);
  if (execute) psArgs.push('-Execute');
  const res = spawnSync('powershell', psArgs, { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`release driver exited ${res.status}`);

  if (execute) {
    if (env) {
      fs.mkdirSync(path.dirname(env.applied), { recursive: true });
      fs.writeFileSync(env.applied, JSON.stringify({ ...env.spec, appliedIn: sha, appliedAt: new Date().toISOString() }, null, 2));
    }
    audit('release-hub', { outcome: 'released', sha, pr: ci.pr, env: env?.spec.id ?? null, basesRebuilt: bases.rebuilt.map((b) => b.base), minutes: Math.round((Date.now() - started) / 60000) });
    await notifyInbox({
      title: `Hub released: ${sha.slice(0, 8)} (PR #${ci.pr})`,
      description: `Local Hub on vacsoserver now runs ${sha}.${env ? ` Env changes applied: ${env.spec.id}.` : ''}${bases.rebuilt.length ? ` Base images rebuilt for the new lockfiles: ${bases.rebuilt.map((b) => b.tag).join(', ')}.` : ''}`,
      dedupKey: `agent-ops:release:${sha}`, priority: 'low',
    });
  } else {
    audit('release-hub', { outcome: 'dry-run', sha, pr: ci.pr, env: env?.spec.id ?? null });
  }
} catch (err) {
  audit('release-hub', { outcome: execute ? 'failed' : 'dry-run-refused', sha: shaArg, error: err.message });
  if (execute) {
    await notifyInbox({ title: 'Hub release failed', description: err.message, dedupKey: `agent-ops:release-failed:${shaArg}`, priority: 'high' });
  }
  console.error(`REFUSED/FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  release();
}

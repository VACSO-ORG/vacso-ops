// Deploy services/claude-bridge from a vacso-hub commit to the PM2 `claude-bridge` (local, :3939).
// Usage: node C:/Users/oscar/Projects/vacso-ops/agent-ops/deploy-bridge.cjs --sha <40-hex|master> [--execute]
// Steps: detached runtime checkout -> npm ci (bridge workspace) -> bridge tests -> repoint PM2 keeping the
// running env, cwd and interpreter -> pm2 save -> /health. Health failure rolls back to the previous script.
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const APP = 'claude-bridge';
const HEALTH = 'http://127.0.0.1:3939/health';

function pm2App() {
  const list = JSON.parse(execSync('pm2 jlist', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  const app = list.find((p) => p.name === APP);
  if (!app) throw new Error(`${APP} not found in pm2`);
  return app;
}
function health() {
  return new Promise((resolve) => {
    http.get(HEALTH, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve({ status: r.statusCode, body: b })); })
      .on('error', (e) => resolve({ status: 0, body: e.message }));
  });
}
function startWith(script, env, cwd, interpreter) {
  const tmp = path.join(require('node:os').tmpdir(), `agent-ops-bridge-${process.pid}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ apps: [{ name: APP, script, cwd, interpreter, windowsHide: true, autorestart: true, max_restarts: 10, restart_delay: 5000, env }] }));
  try {
    execSync(`pm2 delete ${APP}`, { stdio: 'ignore' });
    execSync(`pm2 start "${tmp}"`, { stdio: 'ignore' });
    execSync('pm2 save', { stdio: 'ignore' });
  } finally {
    fs.rmSync(tmp, { force: true }); // holds BRIDGE_TOKEN
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { HUB_REPO, acquireLock, assertToolkitIntegrity, audit, notifyInbox, run } = await import('./lib/common.mjs');
  const argv = process.argv.slice(2);
  const execute = argv.includes('--execute');
  const shaArg = argv[argv.indexOf('--sha') + 1];
  if (!argv.includes('--sha') || !shaArg) { console.error('usage: deploy-bridge.cjs --sha <40-hex|master> [--execute]'); process.exit(2); }
  let release = () => {};
  try {
    assertToolkitIntegrity();
    run('git', ['-C', HUB_REPO, 'fetch', '--quiet', 'origin']);
    const sha = shaArg === 'master' ? run('git', ['-C', HUB_REPO, 'rev-parse', 'origin/master']) : shaArg;
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('sha must be 40 hex characters or "master"');
    try { run('git', ['-C', HUB_REPO, 'merge-base', '--is-ancestor', sha, 'origin/master']); } catch { throw new Error(`${sha} is not on origin/master`); }

    const rt = `C:\\Users\\oscar\\projects\\vacso-hub-bridge-runtime-${sha.slice(0, 8)}`;
    const script = path.join(rt, 'services', 'claude-bridge', 'src', 'server.mjs');
    const current = pm2App();
    console.log(`Plan: ${APP} ${current.pm2_env.pm_exec_path} -> ${script}`);
    if (current.pm2_env.pm_exec_path === script) { console.log('Already running this commit.'); return; }
    if (!execute) { console.log('DRY RUN: no step executed.'); audit('deploy-bridge', { outcome: 'dry-run', sha }); return; }

    release = acquireLock('bridge-deploy', 30 * 60 * 1000);
    if (!fs.existsSync(rt)) run('git', ['-C', HUB_REPO, 'worktree', 'add', '--detach', rt, sha]);
    const env = { ...process.env }; delete env.NODE_ENV;
    execFileSync('npm', ['ci', '-w', 'services/claude-bridge', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: rt, env, stdio: 'inherit', shell: true });
    execFileSync(process.execPath, ['--test', 'test/*.test.mjs'], { cwd: path.join(rt, 'services', 'claude-bridge'), stdio: 'inherit' });

    const prev = { script: current.pm2_env.pm_exec_path, env: current.pm2_env.env, cwd: current.pm2_env.pm_cwd, interpreter: current.pm2_env.exec_interpreter };
    startWith(script, prev.env, prev.cwd, prev.interpreter);
    await sleep(6000);
    const h = await health();
    if (h.status !== 200) {
      startWith(prev.script, prev.env, prev.cwd, prev.interpreter);
      await sleep(6000);
      const back = await health();
      throw new Error(`new bridge unhealthy (${h.status} ${h.body.slice(0, 120)}); rolled back, previous healthy: ${back.status === 200}`);
    }
    console.log(`Healthy: ${h.body.slice(0, 200)}`);
    audit('deploy-bridge', { outcome: 'deployed', sha, from: prev.script });
    await notifyInbox({ title: `Claude bridge deployed: ${sha.slice(0, 8)}`, description: h.body.slice(0, 300), dedupKey: `agent-ops:bridge:${sha}`, priority: 'low' });
  } catch (err) {
    audit('deploy-bridge', { outcome: execute ? 'failed' : 'refused', sha: shaArg, error: err.message });
    if (execute) await notifyInbox({ title: 'Claude bridge deploy failed', description: err.message, dedupKey: `agent-ops:bridge-failed:${shaArg}`, priority: 'high' });
    console.error(`REFUSED/FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    release();
  }
})();

// Retire finished git worktrees and dead worktree folders across Oscar's repos.
// Usage: node C:/Users/oscar/Projects/vacso-ops/agent-ops/retire-worktrees.mjs [--execute] [--dead-dirs]
//
// A worktree is removed ONLY when all hold:
//   - not the repo's main checkout, not locked
//   - not a runtime/release checkout (name patterns below), not used by PM2, Docker mounts or any running process
//   - not touched in the last 24 hours
//   - `git status --porcelain` is empty (ignored files such as node_modules are fine)
//   - every commit on HEAD is already on the default branch (ancestor, or patch-equivalent via git cherry)
// Before removal, node_modules junctions/symlinks inside it are unlinked so removal cannot delete through them.
// Branches are never deleted.
// --dead-dirs also retires sibling folders named like a worktree that contain no .git at all: their files,
// excluding node_modules and build output, are copied to %LOCALAPPDATA%\VACSO\agent-ops\retired\<name>\ first.
import fs from 'node:fs';
import path from 'node:path';
import { STATE_DIR, assertToolkitIntegrity, audit, run } from './lib/common.mjs';

const PROJECTS = 'C:/Users/oscar/Projects';
const REPOS = ['vacso-hub', 'brand-studio', 'by2050-store', 'cobba-media-site', 'personal-website', 'thirsti',
  'ozewine', 'wiyd-landing-page', 'banksia-house', 'vacso-landing-page', 'vacso-brand'];
const KEEP_PATTERNS = [/-release-\d{8}/i, /-release-activation/i, /-runtime/i, /daily-release/i, /cobba-app-release/i,
  /vacso-hub-today$/i, /consolidation-validation$/i, /vacso-hub-master-preview$/i];
const SKIP_COPY = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.turbo', '.cache', 'test-results', 'playwright-report']);
const DAY_MS = 24 * 60 * 60 * 1000;
const execute = process.argv.includes('--execute');
const deadDirs = process.argv.includes('--dead-dirs');
const norm = (p) => path.resolve(p).toLowerCase();

function inUsePaths() {
  const used = new Set();
  try {
    for (const p of JSON.parse(run('pm2', ['jlist'], { shell: true }))) {
      for (const v of [p.pm2_env?.pm_cwd, p.pm2_env?.pm_exec_path]) if (v) used.add(norm(v));
    }
  } catch { /* pm2 absent */ }
  try {
    const ids = run('docker', ['ps', '-q']).split(/\s+/).filter(Boolean);
    if (ids.length) {
      const sources = run('docker', ['inspect', '--format', '{{range .Mounts}}{{println .Source}}{{end}}', ...ids]).split('\n').filter(Boolean);
      for (const s of sources) used.add(norm(s.replace(/^\/run\/desktop\/mnt\/host\/c/i, 'C:')));
    }
  } catch { /* docker absent */ }
  let cmdlines = '';
  try {
    cmdlines = run('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"]).toLowerCase();
  } catch { /* ignore */ }
  return { used, cmdlines };
}

function isUsed(dir, usage) {
  const d = norm(dir);
  for (const u of usage.used) if (u === d || u.startsWith(d + path.sep)) return true;
  const fwd = d.replace(/\\/g, '/');
  return usage.cmdlines.includes(d) || usage.cmdlines.includes(fwd);
}

function recentlyTouched(dir) {
  try {
    const head = run('git', ['-C', dir, 'log', '-1', '--format=%ct']);
    if (Date.now() - Number(head) * 1000 < DAY_MS) return true;
  } catch { /* ignore */ }
  for (const f of ['.git', 'package.json']) {
    try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs < DAY_MS) return true; } catch { /* ignore */ }
  }
  return false;
}

function onDefault(dir, def) {
  try { run('git', ['-C', dir, 'merge-base', '--is-ancestor', 'HEAD', `origin/${def}`]); return true; } catch { /* not ancestor */ }
  const cherry = run('git', ['-C', dir, 'cherry', `origin/${def}`, 'HEAD']);
  return cherry.split('\n').filter(Boolean).every((l) => l.startsWith('-'));
}

function unlinkJunctions(dir, depth = 0) {
  if (depth > 3) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    let st;
    try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) {
      if (e.name === 'node_modules' || depth > 0) { fs.unlinkSync(p); n++; }
      continue;
    }
    if (st.isDirectory() && e.name !== '.git' && e.name !== 'node_modules') n += unlinkJunctions(p, depth + 1);
  }
  return n;
}

function copySalvage(src, dest) {
  let files = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY.has(e.name)) continue;
    const s = path.join(src, e.name);
    const st = fs.lstatSync(s);
    if (st.isSymbolicLink()) continue;
    const d = path.join(dest, e.name);
    if (st.isDirectory()) { fs.mkdirSync(d, { recursive: true }); files += copySalvage(s, d); }
    else { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(s, d); files++; }
  }
  return files;
}

assertToolkitIntegrity();
const usage = inUsePaths();
const summary = { removed: [], kept: [], dead: [] };

for (const repo of REPOS) {
  const root = path.join(PROJECTS, repo);
  if (!fs.existsSync(path.join(root, '.git'))) continue;
  run('git', ['-C', root, 'fetch', '--quiet', 'origin']);
  run('git', ['-C', root, 'worktree', 'prune']);
  let def = 'main';
  try { def = run('git', ['-C', root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).replace(/^origin\//, ''); } catch { /* default main */ }
  const entries = run('git', ['-C', root, 'worktree', 'list', '--porcelain']).split(/\n\n+/).map((b) => {
    const o = {};
    for (const line of b.split('\n')) { const [k, ...v] = line.split(' '); o[k] = v.join(' ') || true; }
    return o;
  }).filter((o) => o.worktree);
  for (const wt of entries) {
    const dir = path.resolve(wt.worktree);
    const name = path.basename(dir);
    const why = [];
    if (norm(dir) === norm(root)) continue;
    if (!fs.existsSync(dir)) continue;
    if (wt.locked) why.push('locked');
    if (KEEP_PATTERNS.some((r) => r.test(name))) why.push('runtime/release checkout');
    if (isUsed(dir, usage)) why.push('in use by a process, PM2 or Docker');
    if (!why.length && recentlyTouched(dir)) why.push('touched in the last 24h');
    if (!why.length && run('git', ['-C', dir, 'status', '--porcelain'])) why.push('uncommitted changes');
    if (!why.length && !onDefault(dir, def)) why.push(`commits not on origin/${def}`);
    if (why.length) { summary.kept.push({ dir, why: why.join('; ') }); continue; }
    if (execute) {
      const links = unlinkJunctions(dir);
      try {
        run('git', ['-C', root, 'worktree', 'remove', dir]);
        summary.removed.push({ dir, branch: wt.branch ?? 'detached', junctionsUnlinked: links });
      } catch (err) {
        summary.kept.push({ dir, why: `git worktree remove refused: ${err.message.split('\n')[0]}` });
      }
    } else {
      summary.removed.push({ dir, branch: wt.branch ?? 'detached', dryRun: true });
    }
  }
}

if (deadDirs) {
  const retired = path.join(STATE_DIR, 'retired');
  for (const e of fs.readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(PROJECTS, e.name);
    if (!REPOS.some((r) => e.name.startsWith(`${r}-`)) && e.name !== 'wt-rebase-922') continue;
    if (fs.existsSync(path.join(dir, '.git'))) continue;
    if (KEEP_PATTERNS.some((r) => r.test(e.name)) || isUsed(dir, usage)) { summary.kept.push({ dir, why: 'dead dir but in use or runtime-named' }); continue; }
    if (execute) {
      unlinkJunctions(dir);
      const files = copySalvage(dir, path.join(retired, e.name));
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      summary.dead.push({ dir, salvagedFiles: files, salvage: path.join(retired, e.name) });
    } else {
      summary.dead.push({ dir, dryRun: true });
    }
  }
}

audit('retire-worktrees', { outcome: execute ? 'executed' : 'dry-run', removed: summary.removed.length, dead: summary.dead.length, kept: summary.kept.length });
console.log(`${execute ? 'Removed' : 'Would remove'} ${summary.removed.length} worktrees; ${execute ? 'retired' : 'would retire'} ${summary.dead.length} dead folders; kept ${summary.kept.length}.`);
fs.writeFileSync(path.join(STATE_DIR, `retire-worktrees-${execute ? 'run' : 'plan'}-${Date.now()}.json`), JSON.stringify(summary, null, 2));
const keptByReason = {};
for (const k of summary.kept) keptByReason[k.why] = (keptByReason[k.why] ?? 0) + 1;
console.log('Kept by reason:', JSON.stringify(keptByReason, null, 1));
for (const r of summary.removed) console.log(`  ${execute ? 'removed' : 'remove'}: ${r.dir} (${r.branch})`);
for (const d of summary.dead) console.log(`  ${execute ? 'retired' : 'retire'} dead: ${d.dir}${d.salvagedFiles != null ? ` (${d.salvagedFiles} files salvaged)` : ''}`);

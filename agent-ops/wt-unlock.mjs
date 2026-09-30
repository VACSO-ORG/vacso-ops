// Clear a stale vacso-hub worktree registry lock (.git/wt-registry.lock) left by a crashed `wt` run.
// Usage: node C:/Users/oscar/Projects/vacso-ops/agent-ops/wt-unlock.mjs [--execute]
// Removes it ONLY when its owner process is dead, on this host, and the lock is older than 5 minutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertToolkitIntegrity, audit, pidAlive } from './lib/common.mjs';

const LOCK = 'C:/Users/oscar/projects/vacso-hub/.git/wt-registry.lock';
const execute = process.argv.includes('--execute');

try {
  assertToolkitIntegrity();
  if (!fs.existsSync(LOCK)) { console.log('No lock present.'); process.exit(0); }
  const ownerFile = path.join(LOCK, 'owner');
  const [pidText, host] = fs.existsSync(ownerFile) ? fs.readFileSync(ownerFile, 'utf8').trim().split(/\s+/) : [];
  const pid = Number(pidText);
  const ageMs = Date.now() - fs.statSync(LOCK).mtimeMs;
  const facts = { pid: pidText ?? null, host: host ?? null, ageSeconds: Math.round(ageMs / 1000) };
  if (host && host !== os.hostname()) throw new Error(`lock owned by another host ${host}`);
  if (pidAlive(pid)) throw new Error(`owner pid ${pid} is still running; the lock is live`);
  if (ageMs < 5 * 60 * 1000) throw new Error(`lock is only ${facts.ageSeconds}s old; wait until it is 5 minutes old`);
  if (!execute) { console.log(`DRY RUN: stale lock would be removed ${JSON.stringify(facts)}`); process.exit(0); }
  fs.rmSync(LOCK, { recursive: true, force: true });
  audit('wt-unlock', { outcome: 'removed', ...facts });
  console.log(`Removed stale lock ${JSON.stringify(facts)}`);
} catch (err) {
  audit('wt-unlock', { outcome: 'refused', error: err.message });
  console.error(`REFUSED: ${err.message}`);
  process.exitCode = 1;
}

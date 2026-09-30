// Shared helpers for the agent-ops toolkit: audit log, single-flight locks, toolkit integrity, inbox notice.
// Zero dependencies. Node 20+.
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const OPS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const STATE_DIR = path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'VACSO', 'agent-ops');
export const HUB_REPO = 'C:\\Users\\oscar\\projects\\vacso-hub';
export const HUB_API = process.env.HUB_API_URL ?? 'http://127.0.0.1:8080';
fs.mkdirSync(STATE_DIR, { recursive: true });

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
}
export function sh(command, opts = {}) {
  return execSync(command, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).trim();
}

export function audit(tool, event) {
  const line = JSON.stringify({ at: new Date().toISOString(), tool, host: os.hostname(), ...event });
  fs.appendFileSync(path.join(STATE_DIR, 'audit.jsonl'), line + '\n');
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    const out = run('tasklist', ['/FI', `PID eq ${pid}`, '/NH']);
    return out.includes(String(pid));
  } catch {
    return true; // cannot tell: treat as alive, never steal
  }
}

/** Atomic directory lock. A lock is stale only when its owner PID is dead AND it is older than staleMs. */
export function acquireLock(name, staleMs = 5 * 60 * 1000) {
  const dir = path.join(STATE_DIR, `${name}.lock`);
  try {
    fs.mkdirSync(dir);
  } catch {
    const ownerFile = path.join(dir, 'owner');
    const [pidText, host] = fs.existsSync(ownerFile) ? fs.readFileSync(ownerFile, 'utf8').split(' ') : [];
    const ageMs = Date.now() - fs.statSync(dir).mtimeMs;
    if (host === os.hostname() && !pidAlive(Number(pidText)) && ageMs > staleMs) {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
      audit('lock', { name, reclaimedFromPid: pidText, ageMs });
    } else {
      throw new Error(`${name} is locked by pid ${pidText ?? '?'} (${Math.round(ageMs / 1000)}s old); another run is in progress`);
    }
  }
  fs.writeFileSync(path.join(dir, 'owner'), `${process.pid} ${os.hostname()} ${new Date().toISOString()}`);
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Refuse to run if the toolkit differs from origin/main. Agents may propose toolkit changes by PR,
 * but only committed, pushed code runs; an edited-then-executed script is impossible.
 */
export function assertToolkitIntegrity() {
  run('git', ['-C', OPS_ROOT, 'fetch', '--quiet', 'origin']);
  const dirty = run('git', ['-C', OPS_ROOT, 'status', '--porcelain', '--', 'agent-ops']);
  if (dirty) throw new Error(`agent-ops has uncommitted changes; commit and push them first:\n${dirty}`);
  try {
    run('git', ['-C', OPS_ROOT, 'diff', '--quiet', 'origin/main', '--', 'agent-ops']);
  } catch {
    throw new Error('agent-ops differs from origin/main; push or pull before running');
  }
}

/** Best-effort notice in the One Inbox (reaches the phone). Never throws. */
export async function notifyInbox({ title, description, dedupKey, priority = 'medium' }) {
  const headers = { 'content-type': 'application/json' };
  if (process.env.HUB_API_TOKEN) headers.authorization = `Bearer ${process.env.HUB_API_TOKEN}`;
  const body = {
    agentKey: 'agent_ops', actionType: 'agent_ops_report', title, description, dedupKey, priority,
    anatomy: { evidenceLabel: 'vacso-ops/agent-ops audit.jsonl', expected: 'Local Hub runtime healthy on the new version.', downside: 'A failed step leaves the previous version running.' },
    expiresInMinutes: 4320,
  };
  try {
    const res = await fetch(`${HUB_API}/api/v1/inbox/raise`, { method: 'POST', headers, body: JSON.stringify(body) });
    return res.ok;
  } catch {
    return false;
  }
}

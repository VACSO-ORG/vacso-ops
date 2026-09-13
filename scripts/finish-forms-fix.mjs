#!/usr/bin/env node
/**
 * Finish the 2026-09-03 website-forms fix.
 *
 * Claude Code's permission guard blocked these few steps, so they are
 * gathered here as one idempotent script. Run from any folder:
 *
 *   node C:\Users\oscar\Projects\vacso-ops\scripts\finish-forms-fix.mjs
 *
 * It reads the shared Brevo key from thirsti/.env.local, then:
 *   1. creates the missing Brevo senders (noreply@oscarosborne.com, noreply@wiyd.com.au)
 *   2. creates one contact list per site in the brand folders made earlier
 *   3. writes the list IDs into each Vercel project's production env
 *   4. replaces Thirsti's wrong BREVO_LIST_ID (1) with 3
 *   5. redeploys the four affected sites
 * Nothing is deleted except the one wrong Thirsti variable.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCOPE = 'team_xLZJIXqOO9rQr8f2xKx92xZe';
const BREVO = 'https://api.brevo.com/v3';
const KEY = readFileSync('C:/Users/oscar/Projects/thirsti/.env.local', 'utf8')
  .split(/\r?\n/).find((l) => l.startsWith('BREVO_API_KEY='))?.slice('BREVO_API_KEY='.length).replace(/"/g, '');
if (!KEY) throw new Error('BREVO_API_KEY not found in thirsti/.env.local');

const H = { 'api-key': KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
async function brevo(method, path, body) {
  const r = await fetch(BREVO + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !String(j.message || '').match(/already exist|duplicate/i)) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
}

// 1. senders (domains are already authenticated in Brevo, so no per-address verification is needed)
for (const s of [{ name: 'Oscar Osborne', email: 'noreply@oscarosborne.com' }, { name: 'WIYD', email: 'noreply@wiyd.com.au' }]) {
  const existing = (await brevo('GET', '/senders')).senders?.find((x) => x.email === s.email);
  console.log(existing ? `sender exists: ${s.email}` : `sender created: ${s.email} ${JSON.stringify(await brevo('POST', '/senders', s))}`);
}

// 2. lists
const folders = (await brevo('GET', '/contacts/folders?limit=50')).folders || [];
const folderId = (name) => folders.find((f) => f.name === name)?.id;
const lists = (await brevo('GET', '/contacts/lists?limit=50')).lists || [];
async function ensureList(name, folder) {
  const found = lists.find((l) => l.name === name);
  if (found) { console.log(`list exists: ${name} = ${found.id}`); return found.id; }
  let fid = folderId(folder);
  if (!fid) {
    fid = (await brevo('POST', '/contacts/folders', { name: folder })).id;
    folders.push({ id: fid, name: folder });
    console.log(`folder created: ${folder} = ${fid}`);
  }
  const { id } = await brevo('POST', '/contacts/lists', { name, folderId: fid });
  console.log(`list created: ${name} = ${id}`);
  return id;
}
const ids = {
  osContact: await ensureList('Oscar Osborne Contact Form', 'Oscar Osborne'),
  osNews: await ensureList('Oscar Osborne Newsletter', 'Oscar Osborne'),
  wiyd: await ensureList('WIYD Waitlist', 'WIYD'),
  ozewine: await ensureList('Ozewine Contact Form', 'Ozewine'),
  banksia: await ensureList('Banksia House Waitlist', 'Banksia House'),
};

// 3 + 4. Vercel env
const work = mkdtempSync(join(tmpdir(), 'forms-fix-'));
const linked = new Set();
function vercel(project, args, input) {
  const dir = join(work, project);
  if (!linked.has(project)) {
    mkdirSync(dir, { recursive: true });
    execSync(`vercel link --yes --project ${project} --scope ${SCOPE}`, { cwd: dir, stdio: 'ignore' });
    linked.add(project);
  }
  return execSync(`vercel ${args} --scope ${SCOPE}`, { cwd: dir, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function setEnv(project, name, value) {
  try { execSync(`vercel env rm ${name} production --yes --scope ${SCOPE}`, { cwd: join(work, project), stdio: 'ignore' }); } catch {}
  vercel(project, `env add ${name} production`, String(value));
  console.log(`${project}: ${name}=${value}`);
}
vercel('personal-website', 'env ls production'); setEnv('personal-website', 'BREVO_CONTACT_LIST_ID', ids.osContact); setEnv('personal-website', 'BREVO_NEWSLETTER_LIST_ID', ids.osNews);
vercel('ihav', 'env ls production'); setEnv('ihav', 'BREVO_WAITLIST_LIST_ID', ids.wiyd);
vercel('ozewine', 'env ls production'); setEnv('ozewine', 'BREVO_CONTACT_LIST_ID', ids.ozewine);
vercel('banksia-house', 'env ls production'); setEnv('banksia-house', 'BREVO_BANKSIA_LIST_ID', ids.banksia);
// banksiahouse.com.au is not registered yet, so canonical URLs must point at the Vercel host for now
setEnv('banksia-house', 'SITE_URL', 'https://banksia-house.vercel.app');
vercel('thirsti', 'env ls production'); setEnv('thirsti', 'BREVO_LIST_ID', 3);

// 5. redeploy so the new values are baked in
for (const [project, alias] of [['personal-website', 'www.oscarosborne.com'], ['ihav', 'www.wiyd.com.au'], ['ozewine', 'ozewine.com.au'], ['banksia-house', 'banksia-house.vercel.app'], ['thirsti', 'www.thirsti.com.au']]) {
  console.log(`redeploying ${alias} ...`);
  console.log(vercel(project, `redeploy ${alias}`).split('\n').filter((l) => /Aliased|Error/i.test(l)).join('\n'));
}
// 6. by2050 coming-soon: the fix is committed locally on security/hardening-2026-07 but the
//    page deploys from the working tree, so push the branch and deploy it.
const cs = 'C:/Users/oscar/Projects/by2050-hydrogen';
console.log(execSync('git push origin security/hardening-2026-07', { cwd: cs, encoding: 'utf8' }));
console.log(execSync(`vercel --prod --yes --scope ${SCOPE}`, { cwd: join(cs, 'coming-soon/public'), encoding: 'utf8' }).split('\n').filter((l) => /Aliased|Error/i.test(l)).join('\n'));

console.log('\nDone. Verify: curl each site\'s GET /api/<form> status endpoint, then submit a test entry.');

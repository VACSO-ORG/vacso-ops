// Base images follow the lockfiles. Called by release.mjs before the image build.
//
// The pinned image builder (build-final-images.vN.cjs) byte-compares the root package.json,
// package-lock.json and server/package.json with its backend base, and mcp-server/package.json
// and package-lock.json with its MCP base, and refuses to build when they differ. Every
// dependency pin (five advisories on 6 Oct 2026, two more on the 7th) therefore needed a
// hand-written rebuild-base.vN.ps1 in the recovery folder, run by a human, before a release
// could happen. Oscar, 6 Oct: "this should not keep happening where I am getting blocked".
//
// This module does what those scripts did, from the release driver, under its gates:
//   1. read the base ids the newest builder pins
//   2. for each base, compare the manifests inside the pinned image with the commit's
//   3. rebuild only the bases that differ, FROM the pinned base, with the same recipes as
//      rebuild-base.v5.ps1 and rebuild-mcp-base.v1.ps1, and verify the manifests inside
//   4. write build-final-images.v(N+1).cjs with the new ids; existing files are never edited
//
// A dry run reports what would be rebuilt and writes nothing. The recovery folder's "never
// edited" rule holds: only new files appear there (a build context, a Dockerfile, a builder),
// each named by the commit, and a name already taken refuses rather than overwrites.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HUB_REPO, audit, run } from './common.mjs';

export const RECOVERY = 'C:\\Users\\oscar\\AppData\\Local\\VACSO\\recovery\\reboot-activation-plan-20260923';

const BASES = [
  {
    key: 'backend',
    repo: 'vacso-hub-reboot-repair',
    tagPrefix: 'vacso-hub-reboot-repair:lockfile-',
    pinPattern: /const backBase='vacso-hub-reboot-repair@(sha256:[0-9a-f]{64})';/,
    manifests: ['package.json', 'package-lock.json', 'server/package.json'],
    imageRoot: '/opt/hub',
    contextDir: (s8) => `base-rebuild-${s8}`,
    recipe: (fromTag, s8) => [
      `# Lockfile refresh on top of the previous base, written by agent-ops rebuild-bases.mjs for ${s8}.`,
      '# The release image build byte-compares the root package files with its base, so the base must carry them.',
      '# Same recipe as base-rebuild-d6b1acd0 (5 Oct 2026): npm ci for the server workspace as root, then the',
      '# voice model cache recreated for appuser and the models fetched again.',
      `FROM ${fromTag}`,
      'USER root',
      'COPY --chown=appuser:appuser package.json package-lock.json /opt/hub/',
      'COPY --chown=appuser:appuser server/package.json /opt/hub/server/package.json',
      'RUN cd /opt/hub && npm ci --workspace server --include-workspace-root=false --no-audit --no-fund',
      'RUN mkdir -p /opt/hub/node_modules/@livekit/agents-plugin-livekit/node_modules/@huggingface/transformers/.cache \\',
      ' && chown appuser:appuser /opt/hub/node_modules/@livekit/agents-plugin-livekit/node_modules/@huggingface/transformers/.cache',
      'USER appuser',
      'WORKDIR /opt/hub/server',
      'RUN node scripts/prefetch-voice-models.mjs',
      `LABEL org.opencontainers.image.revision="${s8}" vacso.source-commit="${s8}" vacso.purpose="consolidated-runtime" vacso.runtime.patch="lockfile-${s8}"`,
    ],
  },
  {
    key: 'mcp',
    repo: 'vacso-hub-consolidated-mcp',
    tagPrefix: 'vacso-hub-consolidated-mcp:lockfile-',
    pinPattern: /const mcpBase='(sha256:[0-9a-f]{64})';/,
    manifests: ['mcp-server/package.json', 'mcp-server/package-lock.json'],
    imageRoot: '/app',
    // The MCP image keeps its two manifests flat under /app.
    imagePath: (m) => `/app/${path.posix.basename(m)}`,
    contextDir: (s8) => `mcp-base-rebuild-${s8}`,
    recipe: (fromTag, s8) => [
      `# MCP lockfile refresh on top of the previous MCP base, written by agent-ops rebuild-bases.mjs for ${s8}.`,
      '# The base\'s own install step, unchanged: npm ci --legacy-peer-deps --ignore-scripts.',
      `FROM ${fromTag}`,
      'USER root',
      'WORKDIR /app',
      'COPY --chown=node:node package.json package-lock.json /app/',
      'RUN npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund',
      'USER node',
      `LABEL org.opencontainers.image.revision="${s8}" vacso.source-commit="${s8}" vacso.purpose="consolidated-mcp" vacso.runtime.patch="lockfile-${s8}"`,
    ],
  },
];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/** The newest pinned builder, by its .vN suffix (an unsuffixed one counts as v1). */
export function newestBuilder() {
  const files = fs.readdirSync(RECOVERY).filter((f) => /^build-final-images(\.v\d+)?\.cjs$/.test(f));
  if (!files.length) throw new Error('no build-final-images*.cjs in the pinned tooling');
  const version = (f) => (f.match(/\.v(\d+)\.cjs$/) ? Number(f.match(/\.v(\d+)\.cjs$/)[1]) : 1);
  files.sort((a, b) => version(b) - version(a));
  return { file: path.join(RECOVERY, files[0]), version: version(files[0]) };
}

function imagePathFor(base, manifest) {
  return base.imagePath ? base.imagePath(manifest) : `${base.imageRoot}/${manifest}`;
}

/** sha256 of one file inside an image, by running sha256sum there. */
function imageFileSha(imageId, filePath) {
  const out = run('docker', ['run', '--rm', '--entrypoint', 'sha256sum', imageId, filePath]);
  return out.split(/\s+/)[0].toLowerCase();
}

function commitFileBytes(sha, manifest) {
  const res = spawnSync('git', ['-C', HUB_REPO, 'show', `${sha}:${manifest}`], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`could not read ${manifest} at ${sha}: ${res.stderr.toString()}`);
  return res.stdout;
}

/**
 * What the commit needs: for each base, the pinned id and whether its manifests
 * already match the commit's. Read-only.
 */
export function planBases(sha) {
  const builder = newestBuilder();
  const source = fs.readFileSync(builder.file, 'utf8');
  const plan = [];
  for (const base of BASES) {
    const match = source.match(base.pinPattern);
    if (!match) throw new Error(`${path.basename(builder.file)} does not pin a ${base.key} base`);
    const pinnedId = match[1];
    const differing = [];
    for (const manifest of base.manifests) {
      const want = sha256(commitFileBytes(sha, manifest));
      const have = imageFileSha(pinnedId, imagePathFor(base, manifest));
      if (want !== have) differing.push(manifest);
    }
    plan.push({ base, pinnedId, differing });
  }
  return { builder, plan };
}

function refuseIfExists(p) {
  if (fs.existsSync(p)) throw new Error(`already exists, preserve and inspect: ${p}`);
}

/** Rebuild one base FROM its pinned image, verify, and return the new image id. */
function rebuildBase(entry, sha) {
  const { base, pinnedId } = entry;
  const s8 = sha.slice(0, 8);
  const newTag = `${base.tagPrefix}${s8}`;
  if (run('docker', ['images', '--quiet', newTag])) throw new Error(`image ${newTag} already exists; inspect it rather than rebuilding over it`);
  // A failed attempt leaves its context and recipe in the recovery folder as
  // evidence (never edited, never removed); the retry takes the next name.
  let ctx = path.join(RECOVERY, base.contextDir(s8));
  for (let attempt = 2; fs.existsSync(ctx) || fs.existsSync(`${ctx}.Dockerfile`); attempt += 1) {
    ctx = path.join(RECOVERY, `${base.contextDir(s8)}.attempt${attempt}`);
  }
  const recipe = `${ctx}.Dockerfile`;
  refuseIfExists(ctx);
  refuseIfExists(recipe);

  // FROM by repository digest, which Docker resolves from the local store and
  // which a retagged image cannot satisfy. `FROM sha256:<id>` is read by Docker
  // as a Docker Hub repository called "sha256" (first run, 8 Oct 2026).
  const fromRef = `${base.repo}@${pinnedId}`;
  const resolved = run('docker', ['image', 'inspect', fromRef, '--format', '{{.Id}}']);
  if (resolved !== pinnedId) throw new Error(`${fromRef} resolves to ${resolved || 'nothing'}, not the pinned ${pinnedId}`);

  // 1. the manifests, byte for byte, in the layout the recipe COPYs
  fs.mkdirSync(ctx, { recursive: true });
  for (const manifest of base.manifests) {
    const bytes = commitFileBytes(sha, manifest);
    const rel = base.imagePath ? path.posix.basename(manifest) : manifest;
    const out = path.join(ctx, ...rel.split('/'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, bytes);
    if (sha256(fs.readFileSync(out)) !== sha256(bytes)) throw new Error(`${manifest} was not written byte for byte`);
  }

  // 2. the recipe, FROM the pinned base by id so a retagged image cannot stand in
  fs.writeFileSync(recipe, `${base.recipe(fromRef, s8).join('\n')}\n`, 'ascii');

  // 3. build (several minutes for the backend: npm ci and the voice models)
  console.log(`Rebuilding ${base.key} base ${newTag} FROM ${fromRef.slice(0, base.repo.length + 20)}... (${path.basename(ctx)})`);
  const build = spawnSync('docker', ['build', '--file', recipe, '--tag', newTag, ctx], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error(`docker build of ${newTag} failed; nothing else was written`);

  // 4. verify the manifests inside
  const newId = run('docker', ['image', 'inspect', newTag, '--format', '{{.Id}}']);
  if (!/^sha256:[0-9a-f]{64}$/.test(newId)) throw new Error(`unexpected image id for ${newTag}: ${newId}`);
  for (const manifest of base.manifests) {
    const want = sha256(commitFileBytes(sha, manifest));
    const have = imageFileSha(newId, imagePathFor(base, manifest));
    if (want !== have) throw new Error(`${manifest} inside ${newTag} (${have}) is not the commit's (${want})`);
  }
  return { newTag, newId };
}

/**
 * Make sure the newest builder's bases carry the commit's manifests. Returns what
 * happened. In a dry run nothing is built or written.
 */
export function ensureBases(sha, execute) {
  const { builder, plan } = planBases(sha);
  const stale = plan.filter((p) => p.differing.length);
  for (const p of plan) {
    console.log(`Base ${p.base.key}: ${p.pinnedId.slice(0, 19)}... ${p.differing.length ? `differs in ${p.differing.join(', ')}` : 'matches the commit'}`);
  }
  if (!stale.length) return { rebuilt: [], builder: builder.file };
  if (!execute) {
    console.log(`DRY RUN: would rebuild ${stale.map((p) => p.base.key).join(' and ')} and write build-final-images.v${builder.version + 1}.cjs`);
    return { rebuilt: [], wouldRebuild: stale.map((p) => p.base.key), builder: builder.file };
  }

  const nextBuilder = path.join(RECOVERY, `build-final-images.v${builder.version + 1}.cjs`);
  refuseIfExists(nextBuilder);
  let source = fs.readFileSync(builder.file, 'utf8');
  const rebuilt = [];
  for (const entry of stale) {
    const { newTag, newId } = rebuildBase(entry, sha);
    const occurrences = source.split(entry.pinnedId).length - 1;
    if (occurrences !== 1) throw new Error(`${path.basename(builder.file)} names the ${entry.base.key} base ${occurrences} times, expected once`);
    source = source.replace(entry.pinnedId, newId);
    rebuilt.push({ base: entry.base.key, tag: newTag, id: newId, from: entry.pinnedId });
  }
  // 5. the builder that uses the new bases: a new file, never an edit
  fs.writeFileSync(nextBuilder, source, 'ascii');
  audit('rebuild-bases', { outcome: 'rebuilt', sha, rebuilt, builder: path.basename(nextBuilder) });
  console.log(`Wrote ${path.basename(nextBuilder)}; the release uses it.`);
  return { rebuilt, builder: nextBuilder };
}

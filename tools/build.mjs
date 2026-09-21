// Builds the Parlor upload: a static bundle with index.html and parlor.json at
// the root, no dev files, no external requests.
//
//   node tools/build.mjs        -> dist/ and neon-militia-parlor.zip

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ZIP = path.join(ROOT, 'neon-militia-parlor.zip');

// Everything the game needs at runtime, and nothing else.
const INCLUDE = ['index.html', 'parlor.json', 'styles.css', 'assets', 'src'];

async function copy(rel) {
  const from = path.join(ROOT, rel);
  const to = path.join(DIST, rel);
  const stat = await fsp.stat(from);
  if (stat.isDirectory()) {
    await fsp.mkdir(to, { recursive: true });
    for (const entry of await fsp.readdir(from)) await copy(path.join(rel, entry));
  } else {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.copyFile(from, to);
  }
}

await fsp.rm(DIST, { recursive: true, force: true });
await fsp.rm(ZIP, { force: true });
await fsp.mkdir(DIST, { recursive: true });
for (const rel of INCLUDE) await copy(rel);

// ---- checks that would otherwise only fail after upload ----
const problems = [];

for (const required of ['index.html', 'parlor.json']) {
  if (!fs.existsSync(path.join(DIST, required))) problems.push(`missing ${required} at the ZIP root`);
}

const manifest = JSON.parse(await fsp.readFile(path.join(DIST, 'parlor.json'), 'utf8'));
const expect = (cond, msg) => { if (!cond) problems.push(`parlor.json: ${msg}`); };
expect(/^[a-z][a-z0-9_]{0,31}$/.test(manifest.scoreIdentifier), 'bad scoreIdentifier');
expect(typeof manifest.scoreName === 'string' && manifest.scoreName.length <= 40, 'scoreName too long');
expect(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER'].includes(manifest.ordering), 'bad ordering');
expect(manifest.roundSeconds === 0 || (Number.isInteger(manifest.roundSeconds)
  && manifest.roundSeconds >= 30 && manifest.roundSeconds <= 600), 'bad roundSeconds');
expect(['SINGLE', 'MULTIPLAYER'].includes(manifest.mode), 'bad mode');
expect(Number.isInteger(manifest.minParticipants) && Number.isInteger(manifest.maxParticipants)
  && manifest.minParticipants >= 1 && manifest.maxParticipants <= 64
  && manifest.minParticipants <= manifest.maxParticipants, 'bad participant counts');
if (manifest.mode === 'SINGLE') {
  expect(manifest.minParticipants === 1 && manifest.maxParticipants === 1, 'SINGLE must be 1 and 1');
}
expect(Object.values(manifest).every((v) => typeof v !== 'object'), 'must be a flat object');

// No CDN scripts or external asset requests anywhere in the bundle.
const textFiles = [];
const walk = async (dir) => {
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(html|css|js|mjs|json)$/.test(entry.name)) textFiles.push(full);
  }
};
await walk(DIST);
for (const file of textFiles) {
  const text = await fsp.readFile(file, 'utf8');
  for (const m of text.matchAll(/(?:https?:)?\/\/[\w.-]+\.[a-z]{2,}[^\s"'`)]*/gi)) {
    const url = m[0];
    if (url.includes('www.w3.org/2000/svg')) continue;          // XML namespace, not a request
    if (/claude\.ai|localhost|example\.com/.test(url)) continue; // comments and defaults
    problems.push(`${path.relative(DIST, file)} references ${url}`);
  }
}

// Every locally referenced asset must resolve — a broken relative path only
// shows up as a 404 after upload otherwise.
for (const file of textFiles) {
  const text = await fsp.readFile(file, 'utf8');
  const markup = /\.(html|css)$/.test(file);
  const refs = [
    // CSS url() and HTML href/src only in markup, so `new URL(...)` in a
    // script is not mistaken for an asset reference
    ...(markup ? text.matchAll(/(?:href|src)=["']([^"'#?]+)["']/gi) : []),
    ...(markup ? text.matchAll(/(?<![\w-])url\(["']?([^"')#?]+)["']?\)/g) : []),
    ...text.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g),
  ].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:|data:|#|\/\/)/i.test(ref)) continue;
    const target = ref.startsWith('/')
      ? path.join(DIST, ref)
      : path.resolve(path.dirname(file), ref);
    if (!fs.existsSync(target)) {
      problems.push(`${path.relative(DIST, file)} references missing ${ref}`);
    }
  }
}

if (problems.length) {
  console.error('\nBuild failed:\n' + problems.map((p) => '  - ' + p).join('\n') + '\n');
  process.exit(1);
}

execFileSync('zip', ['-q', '-r', '-X', ZIP, '.'], { cwd: DIST });

const bytes = (await fsp.stat(ZIP)).size;
const count = textFiles.length;
console.log(`dist/  ${count} text files + fonts`);
console.log(`${path.basename(ZIP)}  ${(bytes / 1024).toFixed(1)} KiB`);
console.log('root:', (await fsp.readdir(DIST)).sort().join(', '));

#!/usr/bin/env node
/**
 * Ship new screens without an APK.
 *
 *   node scripts/live-update.mjs 1.0.9 --notes "Faster theme switch"
 *   node scripts/live-update.mjs 1.0.9 --notes "..." --min-native 10008
 *   node scripts/live-update.mjs --check          # verify what is staged
 *
 * Builds the web bundle at that version, zips it into website/updates/, and
 * writes a SIGNED manifest next to it. Commit and push: Cloudflare publishes
 * the site, and every phone on a new-enough APK picks the bundle up by itself
 * - downloaded quietly, applied on its next start. No Render variables, no
 * Update button.
 *
 * WHAT CANNOT SHIP THIS WAY: anything native. A new permission, a new or
 * upgraded Capacitor plugin, the icon, the app name - those need
 * scripts/release.mjs and an APK. --min-native (default: the versionCode in
 * variables.gradle, i.e. the newest APK) keeps a bundle off shells older than
 * it can run on.
 *
 * THE SIGNING KEY lives OUTSIDE the repository (the repository is public):
 * %USERPROFILE%\.moneva\live-update-ed25519.pem, or MONEVA_UPDATE_KEY. The app
 * carries only the public half and refuses anything it cannot verify, so a
 * lost key means live updates stop until an APK ships a new public key. Back
 * it up with the Android keystore.
 *
 * Every step fails loudly and stops - see release.mjs for why that matters.
 */
import { execSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps', 'web');
const DIST = join(WEB, 'dist');
const UPDATES = join(ROOT, 'website', 'updates');
const MANIFEST = join(UPDATES, 'manifest.json');
const ENV_PROD = join(WEB, '.env.production');
const GRADLE_VARS = join(WEB, 'android', 'variables.gradle');
const KEY_SOURCE = join(WEB, 'src', 'utils', 'liveUpdateManifest.ts');
const SITE_URL = 'https://moneva.monev.workers.dev/updates/';
const KEY_PATH = process.env.MONEVA_UPDATE_KEY || join(homedir(), '.moneva', 'live-update-ed25519.pem');
const KEEP_BUNDLES = 2;

let step = 0;
const heading = (msg) => console.log(`\n[${++step}] ${msg}`);
const ok = (msg) => console.log(`    ok  ${msg}`);
const die = (msg) => { console.error(`\n  STOPPED: ${msg}\n`); process.exit(1); };
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const VERSION_RE = /^(\d{1,3})\.(\d{1,2})\.(\d{1,2})$/;
const codeOf = (v) => { const m = VERSION_RE.exec(v); return m ? +m[1] * 10000 + +m[2] * 100 + +m[3] : -1; };

/** The public key the APP trusts, read from its source - not from the private key. */
const appPublicKey = () => {
  const m = /LIVE_UPDATE_PUBLIC_KEY = '([A-Za-z0-9_-]+)'/.exec(readFileSync(KEY_SOURCE, 'utf8'));
  if (!m) die(`no LIVE_UPDATE_PUBLIC_KEY in ${relative(ROOT, KEY_SOURCE)}`);
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: m[1] }, format: 'jwk' });
};

const readManifest = () => {
  if (!existsSync(MANIFEST)) return null;
  const env = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const payload = Buffer.from(env.payload, 'base64');
  const good = verify(null, payload, appPublicKey(), Buffer.from(env.signature, 'base64'));
  return { good, manifest: JSON.parse(payload.toString('utf8')) };
};

/* ---- a small, dependency-free zip writer (stored + deflate, no zip64) ---- */
const listFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? listFiles(full) : [full];
});
const zipDir = (dir) => {
  const local = [];
  const central = [];
  let offset = 0;
  for (const file of listFiles(dir).sort()) {
    const name = Buffer.from(relative(dir, file).split(sep).join('/'), 'utf8');
    const data = readFileSync(file);
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(useDeflate ? 8 : 0, 8); head.writeUInt32LE(0, 10);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
    local.push(head, name, body);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt32LE(0, 12);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
    central.push(cen, name);
    offset += head.length + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
};

/* ---------------------------------------------------------------- check */
if (process.argv.includes('--check')) {
  heading('Reading the staged manifest');
  const read = readManifest();
  if (!read) die('no website/updates/manifest.json yet');
  if (!read.good) die('the manifest signature does NOT verify against the key in the app');
  const m = read.manifest;
  ok(`signed, version ${m.version}, needs APK >= ${m.min_native_code}`);
  const zip = join(UPDATES, m.url.slice(SITE_URL.length));
  if (!existsSync(zip)) die(`${relative(ROOT, zip)} is missing`);
  const digest = createHash('sha256').update(readFileSync(zip)).digest('hex');
  if (digest !== m.sha256) die('the zip on disk does not match the manifest checksum');
  ok(`${relative(ROOT, zip)} matches its checksum`);
  process.exit(0);
}

/* -------------------------------------------------------------- publish */
const version = process.argv[2];
if (!VERSION_RE.test(version || '')) die('give the version, e.g.\n  node scripts/live-update.mjs 1.0.9 --notes "What changed"');
const notes = (arg('--notes') || '').trim();
if (!notes) die('say in one line what changed: --notes "..." (shown to people once, after the update)');
if (notes.length > 200) die('keep --notes under 200 characters');
const nativeNow = Number(/monevaVersionCode\s*=\s*(\d+)/.exec(readFileSync(GRADLE_VARS, 'utf8'))?.[1]);
const minNative = Number(arg('--min-native') || nativeNow);
if (!Number.isInteger(minNative) || minNative < 10008) die('--min-native must be 10008 or later (the first APK with live updates)');

heading('Checking the version moves forward');
const current = readManifest();
if (current && codeOf(version) <= codeOf(current.manifest.version)) {
  die(`${version} is not newer than the live ${current.manifest.version}`);
}
if (codeOf(version) <= nativeNow) die(`${version} is not newer than the APK (${nativeNow}); phones already have it`);
ok(`${current ? current.manifest.version : 'nothing'} -> ${version}, for APKs from ${minNative}`);

heading('Loading the signing key');
if (!existsSync(KEY_PATH)) die(`no signing key at ${KEY_PATH}`);
const privateKey = createPrivateKey(readFileSync(KEY_PATH));
const derivedX = createPublicKey(privateKey).export({ format: 'jwk' }).x;
if (derivedX !== appPublicKey().export({ format: 'jwk' }).x) {
  die('this private key does not match the public key built into the app - phones would refuse the update');
}
ok('matches the key the app trusts');

heading('Building the web bundle');
const env = readFileSync(ENV_PROD, 'utf8');
writeFileSync(ENV_PROD, env.replace(/^VITE_APP_VERSION=.*$/m, `VITE_APP_VERSION=${version}`));
execSync('npm run build', { cwd: WEB, stdio: ['ignore', 'ignore', 'inherit'] });
if (!existsSync(join(DIST, 'index.html'))) die('the build produced no dist/index.html');
const built = listFiles(join(DIST, 'assets')).filter((f) => f.endsWith('.js'))
  .some((f) => readFileSync(f, 'utf8').includes(`"${version}"`));
if (!built) die(`the built bundle does not contain "${version}" - the version did not reach it`);
ok(`dist/ built with version ${version}`);

heading('Packing and signing');
mkdirSync(UPDATES, { recursive: true });
const zipName = `moneva-web-${version}.zip`;
const zip = zipDir(DIST);
writeFileSync(join(UPDATES, zipName), zip);
const sha256 = createHash('sha256').update(zip).digest('hex');
const payload = Buffer.from(JSON.stringify({
  version, url: SITE_URL + zipName, sha256, min_native_code: minNative, notes,
  released_at: new Date().toISOString(),
}), 'utf8');
const signature = sign(null, payload, privateKey);
writeFileSync(MANIFEST, JSON.stringify({ payload: payload.toString('base64'), signature: signature.toString('base64') }, null, 2) + '\n');
if (!readManifest().good) die('the manifest just written does not verify');
ok(`${zipName}  ${(zip.length / 1024).toFixed(0)} KB  sha256 ${sha256.slice(0, 16)}...`);
ok('manifest signed and verified against the app key');

heading('Keeping only the newest bundles');
const bundles = readdirSync(UPDATES).filter((f) => /^moneva-web-.+\.zip$/.test(f))
  .sort((a, b) => codeOf(b.slice(11, -4)) - codeOf(a.slice(11, -4)));
for (const old of bundles.slice(KEEP_BUNDLES)) { unlinkSync(join(UPDATES, old)); ok(`removed ${old}`); }

console.log(`
--------------------------------------------------------------------
Live update ${version} staged.

  Commit and push. Cloudflare publishes the site within a minute, and
  phones on APK ${minNative}+ fetch it on their next launch or return to
  the app; it takes over on the start after that.

  Nothing to set on Render.
--------------------------------------------------------------------`);

/**
 * The signed update manifest at website/updates/manifest.json, shared by
 * scripts/release.mjs (writes the `apk` section) and scripts/live-update.mjs
 * (writes the bundle fields). Each keeps the other's part as it was.
 *
 * The private key lives OUTSIDE the repository (it is public):
 * %USERPROFILE%\.moneva\live-update-ed25519.pem, or MONEVA_UPDATE_KEY.
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST = join(ROOT, 'website', 'updates', 'manifest.json');
export const SITE_UPDATES = 'https://moneva.monev.workers.dev/updates/';
export const SITE_DOWNLOADS = 'https://moneva.monev.workers.dev/downloads/';
const KEY_SOURCE = join(ROOT, 'apps', 'web', 'src', 'utils', 'liveUpdateManifest.ts');
export const KEY_PATH = process.env.MONEVA_UPDATE_KEY || join(homedir(), '.moneva', 'live-update-ed25519.pem');

/** The public key the APP trusts, read from its source - not from the private key. */
export const appPublicKey = () => {
  const m = /LIVE_UPDATE_PUBLIC_KEY = '([A-Za-z0-9_-]+)'/.exec(readFileSync(KEY_SOURCE, 'utf8'));
  if (!m) throw new Error('no LIVE_UPDATE_PUBLIC_KEY in liveUpdateManifest.ts');
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: m[1] }, format: 'jwk' });
};

/** { good, manifest } for the staged manifest, or null when there is none. */
export const readManifest = () => {
  if (!existsSync(MANIFEST)) return null;
  const env = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const payload = Buffer.from(env.payload, 'base64');
  const good = verify(null, payload, appPublicKey(), Buffer.from(env.signature, 'base64'));
  return { good, manifest: JSON.parse(payload.toString('utf8')) };
};

/** The signing key, refused unless it matches the key built into the app. */
export const loadSigningKey = () => {
  if (!existsSync(KEY_PATH)) throw new Error(`no signing key at ${KEY_PATH}`);
  const key = createPrivateKey(readFileSync(KEY_PATH));
  if (createPublicKey(key).export({ format: 'jwk' }).x !== appPublicKey().export({ format: 'jwk' }).x) {
    throw new Error('this private key does not match the public key built into the app - phones would refuse it');
  }
  return key;
};

/** Signs and writes the manifest, then reads it back and verifies it. */
export const writeManifest = (manifest, key) => {
  const payload = Buffer.from(JSON.stringify(manifest), 'utf8');
  const signature = sign(null, payload, key);
  writeFileSync(MANIFEST, JSON.stringify({ payload: payload.toString('base64'), signature: signature.toString('base64') }, null, 2) + '\n');
  if (!readManifest()?.good) throw new Error('the manifest just written does not verify');
};

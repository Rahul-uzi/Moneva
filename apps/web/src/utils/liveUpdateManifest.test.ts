import { beforeAll, describe, expect, it } from 'vitest';
import { BUNDLE_URL_PREFIX, shouldDownload, verifyManifest, type LiveManifest } from './liveUpdateManifest';

/**
 * A live update replaces every screen in the app, so nothing is trusted that
 * the release key did not sign - and nothing is fetched from anywhere else.
 */

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const webcrypto = globalThis.crypto;
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

let signer: CryptoKey;
let publicKey: string;
let otherSigner: CryptoKey;

const GOOD = {
  version: '1.0.9',
  url: `${BUNDLE_URL_PREFIX}moneva-web-1.0.9.zip`,
  sha256: 'a'.repeat(64),
  min_native_code: 10008,
  notes: 'Faster theme switch',
};

const envelope = async (payload: Uint8Array<ArrayBuffer>, key = signer) => ({
  payload: b64(payload),
  signature: b64(new Uint8Array(await webcrypto.subtle.sign('Ed25519', key, payload))),
});

beforeAll(async () => {
  const pair = (await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair;
  signer = pair.privateKey;
  const raw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  publicKey = b64(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  otherSigner = ((await webcrypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair).privateKey;
});

describe('verifyManifest', () => {
  it('accepts a manifest signed by the release key', async () => {
    const m = await verifyManifest(await envelope(enc(GOOD)), publicKey);
    expect(m).toEqual(GOOD);
  });

  it('refuses one signed by any other key', async () => {
    expect(await verifyManifest(await envelope(enc(GOOD), otherSigner), publicKey)).toBeNull();
  });

  it('refuses a payload changed after signing', async () => {
    const env = await envelope(enc(GOOD));
    const forged = { ...env, payload: b64(enc({ ...GOOD, url: `${BUNDLE_URL_PREFIX}evil.zip` })) };
    expect(await verifyManifest(forged, publicKey)).toBeNull();
  });

  // Even a correctly signed manifest may only point at MONEVA's own site.
  it('refuses a bundle hosted anywhere else', async () => {
    const elsewhere = { ...GOOD, url: 'https://example.com/updates/moneva-web-1.0.9.zip' };
    expect(await verifyManifest(await envelope(enc(elsewhere)), publicKey)).toBeNull();
  });

  it.each([
    ['a bad version', { version: '1.0' }],
    ['a checksum that is not SHA-256', { sha256: 'abc' }],
    ['no native requirement', { min_native_code: undefined }],
    ['a url that is not a zip', { url: `${BUNDLE_URL_PREFIX}moneva-web-1.0.9.html` }],
  ])('refuses %s', async (_, change) => {
    expect(await verifyManifest(await envelope(enc({ ...GOOD, ...change })), publicKey)).toBeNull();
  });

  it('refuses anything that is not an envelope', async () => {
    expect(await verifyManifest(null, publicKey)).toBeNull();
    expect(await verifyManifest({ payload: 1, signature: 2 }, publicKey)).toBeNull();
    expect(await verifyManifest('nonsense', publicKey)).toBeNull();
  });

  it('keeps release notes to one short line', async () => {
    const m = await verifyManifest(await envelope(enc({ ...GOOD, notes: 'x'.repeat(500) })), publicKey);
    expect(m?.notes).toHaveLength(200);
  });
});

describe('shouldDownload', () => {
  const m = GOOD as LiveManifest;

  it('takes a newer bundle on a new-enough APK', () => {
    expect(shouldDownload(m, { bundleVersion: '1.0.8', nativeCode: 10008 })).toBe(true);
  });

  it('never goes backwards or sideways', () => {
    expect(shouldDownload(m, { bundleVersion: '1.0.9', nativeCode: 10008 })).toBe(false);
    expect(shouldDownload(m, { bundleVersion: '1.0.10', nativeCode: 10010 })).toBe(false);
  });

  // A bundle needing a plugin the installed APK lacks would start and break.
  it('waits for the APK when the bundle needs a newer one', () => {
    expect(shouldDownload({ ...m, min_native_code: 10010 }, { bundleVersion: '1.0.8', nativeCode: 10008 })).toBe(false);
  });
});

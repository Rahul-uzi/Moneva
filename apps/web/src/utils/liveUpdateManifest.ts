import { versionCodeOf } from '../services/updateCheck';

/**
 * Reading and trusting the live-update manifest.
 *
 * A live update replaces every screen and every line of logic in the app, so
 * the manifest that points at one is signed. The private key never leaves the
 * release machine; the app carries only the public half below and refuses any
 * manifest it cannot verify. Without this, whoever controlled the website -
 * or anything between it and the phone - could ship code into MONEVA.
 */

/** Ed25519 public key (raw, base64url). Its private half signs every release. */
export const LIVE_UPDATE_PUBLIC_KEY = 'xKnErog9UrpBwFsYoOtBH17j1fxWbx1kD0kATaYHs4I';

/** Bundles are only ever fetched from here. */
export const BUNDLE_URL_PREFIX = 'https://moneva.monev.workers.dev/updates/';

export interface LiveManifest {
  /** The web bundle's version, on the same sequence as the APK's. */
  version: string;
  url: string;
  /** SHA-256 of the zip, checked by the updater before it unpacks anything. */
  sha256: string;
  /** Oldest native shell (versionCode) this bundle runs on. */
  min_native_code: number;
  notes: string;
}

const VERSION = /^\d{1,3}\.\d{1,2}\.\d{1,2}$/;

const fromBase64 = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/**
 * The manifest, if and only if it is signed by MONEVA's key and well formed.
 *
 * The envelope is `{ payload, signature }`, both base64: the signature covers
 * the payload's exact bytes, so nothing has to agree on how JSON is spelled.
 * Anything unexpected - a bad signature, a missing field, a bundle hosted
 * anywhere else - returns null, and the app simply keeps what it has.
 */
export const verifyManifest = async (
  envelope: unknown,
  publicKey: string = LIVE_UPDATE_PUBLIC_KEY,
): Promise<LiveManifest | null> => {
  try {
    const { payload, signature } = (envelope ?? {}) as { payload?: unknown; signature?: unknown };
    if (typeof payload !== 'string' || typeof signature !== 'string') return null;
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;

    const key = await subtle.importKey('raw', fromBase64(publicKey), { name: 'Ed25519' }, false, ['verify']);
    const bytes = fromBase64(payload);
    const ok = await subtle.verify({ name: 'Ed25519' }, key, fromBase64(signature), bytes);
    if (!ok) return null;

    const m = JSON.parse(new TextDecoder().decode(bytes)) as Partial<LiveManifest>;
    if (typeof m.version !== 'string' || !VERSION.test(m.version)) return null;
    if (typeof m.url !== 'string' || !m.url.startsWith(BUNDLE_URL_PREFIX) || !m.url.endsWith('.zip')) return null;
    if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) return null;
    if (typeof m.min_native_code !== 'number' || !Number.isInteger(m.min_native_code)) return null;
    return {
      version: m.version,
      url: m.url,
      sha256: m.sha256,
      min_native_code: m.min_native_code,
      notes: typeof m.notes === 'string' ? m.notes.slice(0, 200) : '',
    };
  } catch {
    // Old WebViews without Ed25519 land here too: no verification, no update.
    return null;
  }
};

/**
 * Whether this phone should fetch the bundle.
 *
 * Only ever forwards - an older or equal bundle is never "updated" to - and
 * only onto a native shell new enough for it. A bundle that needs a plugin
 * the installed APK does not have would start and break; it waits for the APK.
 */
export const shouldDownload = (
  manifest: LiveManifest,
  { bundleVersion, nativeCode }: { bundleVersion: string; nativeCode: number },
): boolean =>
  versionCodeOf(manifest.version) > versionCodeOf(bundleVersion) && manifest.min_native_code <= nativeCode;

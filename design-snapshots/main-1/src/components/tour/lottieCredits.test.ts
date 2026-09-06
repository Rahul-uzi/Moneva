import { describe, it, expect } from 'vitest';
import credits from '../../assets/lottie/CREDITS.md?raw';

/**
 * Third-party animations come with obligations even when the licence asks
 * for no attribution: we must know where each one came from, and every file
 * we ship must be one we chose deliberately. These checks keep the credits
 * file and the assets folder in step with each other, and confirm each file
 * is something the light player can actually draw.
 *
 * Read through Vite's own import machinery rather than Node's fs, so the test
 * needs nothing the browser build does not already have.
 */
interface LottieDoc {
  v: string;
  fr: number;
  op: number;
  w: number;
  h: number;
  layers: Array<{ ty: number }>;
  assets?: Array<{ p?: string; e?: number }>;
}

const files = import.meta.glob('../../assets/lottie/*.json', { eager: true }) as Record<
  string,
  { default: LottieDoc }
>;
const USED = ['grow', 'walk', 'coin', 'calendar', 'lock'];
const nameOf = (path: string) => path.split('/').pop() ?? path;

describe('bundled Lottie animations', () => {
  it('ships exactly the animations the scenes use', () => {
    expect(Object.keys(files).map(nameOf).sort()).toEqual(USED.map((u) => `${u}.json`).sort());
  });

  it('credits every animation with its source page', () => {
    for (const u of USED) {
      const line = credits.split('\n').find((l) => l.includes(`${u}.json`)) ?? '';
      expect(line, `${u}.json is missing from CREDITS.md`).toMatch(
        /https:\/\/lottiefiles\.com\/free-animation\/[a-z0-9-]+/i,
      );
    }
    expect(credits).toMatch(/Lottie Simple License/);
  });

  it.each(USED)('%s.json is a vector animation the light player can render', (u) => {
    const entry = Object.entries(files).find(([p]) => nameOf(p) === `${u}.json`);
    expect(entry).toBeDefined();
    const d = entry![1].default;
    expect(d.layers.length).toBeGreaterThan(0);
    expect(d.op).toBeGreaterThan(1);
    expect(d.w).toBeGreaterThan(0);
    // The light build has no text or expression support, and embedded rasters
    // would blur when scaled - so none of those may be present.
    expect(d.layers.some((l) => l.ty === 5)).toBe(false);
    expect((d.assets ?? []).some((a) => a.e === 1 || String(a.p ?? '').startsWith('data:image'))).toBe(false);
    expect(JSON.stringify(d)).not.toContain('"x":"');
  });

  it('keeps the total payload reasonable for a once-per-install tour', () => {
    const total = Object.values(files).reduce((s, m) => s + JSON.stringify(m.default).length, 0);
    expect(total).toBeLessThan(1_200_000);
  });
});

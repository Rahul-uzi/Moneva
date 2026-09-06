import React from 'react';
import { brandMarkFor, brandNameIn } from '../../utils/brandMark';
import './BrandMark.css';

/**
 * Every logo fetched into src/assets/brands, keyed by slug.
 *
 * Resolved by the bundler at build time, so this is a plain lookup at runtime
 * with no network and no waiting - and a brand with no file simply is not in
 * the map, which is what selects the monogram below.
 */
const LOGO_FILES = import.meta.glob('../../assets/brands/*.{png,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const LOGOS: Record<string, string> = {};
for (const [path, url] of Object.entries(LOGO_FILES)) {
  const file = path.split('/').pop() ?? '';
  LOGOS[file.replace(/\.(png|svg)$/i, '')] = url;
}

/** Must match slugFor() in scripts/fetch-brand-logos.mjs. */
const slugFor = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Not exported: this file exports a component, and mixing the two breaks
    fast refresh. Anything that needs to know goes through the component. */
const logoFor = (name: string): string | undefined => LOGOS[slugFor(name)];

interface Props {
  /** Bank, wallet, merchant or account name. */
  name: string;
  /** Tile edge in px. */
  size?: number;
  className?: string;
}

/**
 * A brand's logo, or its initials when there is no logo worth showing.
 *
 * Both treatments are the same tile at the same size, so a list of accounts
 * lines up whether or not every one of them has a logo. Roughly two thirds of
 * the catalogue has a real mark; the rest keep a coloured monogram, which is
 * deliberately not a blurry 16px favicon stretched to fit.
 *
 * Decorative either way: the name is always written beside it, so announcing
 * it again would only make a screen reader say everything twice.
 */
export const BrandMark: React.FC<Props> = ({ name, size = 38, className }) => {
  // Resolve the brand out of the text first: an account is called "HDFC
  // Savings" and a transaction "UPI/ZOMATO/9812", so looking a logo up by the
  // whole string finds almost nothing.
  const brand = brandNameIn(name) ?? name;
  const logo = logoFor(brand);
  const radius = Math.round(size * 0.28);

  if (logo) {
    return (
      <span
        className={['brand-mark', 'is-logo', className].filter(Boolean).join(' ')}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          // In pixels, from the tile's own size. As a CSS percentage this
          // resolved against the parent instead and squeezed the image to 0.
          padding: Math.max(2, Math.round(size * 0.14)),
        }}
        aria-hidden="true"
      >
        <img src={logo} alt="" loading="lazy" decoding="async" />
      </span>
    );
  }

  const { initials, background, ink } = brandMarkFor(brand);
  return (
    <span
      className={['brand-mark', className].filter(Boolean).join(' ')}
      style={{
        width: size,
        height: size,
        background,
        color: ink,
        // Letters scale with the tile, so one component covers a 26px row
        // marker and a 56px card badge without a size variant for each.
        fontSize: Math.round(size * 0.4),
        borderRadius: radius,
      }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
};

/**
 * Ask Gemini which brands people actually pay, then keep the ones that have a
 * logo.
 *
 *   node scripts/discover-brands.mjs [count]
 *
 * The rule, and the whole point of the script: a brand is added ONLY if a real
 * logo can be fetched for it. A name Gemini is sure about but that has no mark
 * anywhere is not worth recognising - it would show a monogram, and the app
 * can already do that for any text without being told the name in advance.
 *
 * Why the model runs HERE and not in the app:
 *
 *   - It cannot draw a logo. It can say "Dominos, dominos.co.in", and the
 *     image still has to be fetched. The model solves the naming half only.
 *   - At runtime this would mean sending a person's spending descriptions to
 *     Google to decorate a list. "Dr Sharma Clinic" is not something a finance
 *     app should disclose for an icon.
 *   - Asked per transaction it would also be a network round trip inside a
 *     list render, and it would confidently name a brand for "Ramesh Kumar".
 *
 * Run once, ship the results, and none of that applies.
 *
 * Needs GEMINI_API_KEY - the same key the API uses. Read from the environment,
 * or from services/api/.env as a convenience. Never printed.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLogo, saveLogo, slugFor } from './lib/logoSource.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'assets', 'brands');
const GENERATED = join(HERE, '..', 'src', 'utils', 'brandsWithLogos.generated.ts');
const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.0-flash';

/**
 * `--file list.json` takes the candidates from a file instead of the model -
 * same shape, `[{name, domain}]`. Useful when you already know what you want
 * added, and the only way to exercise the rest of this script without a key.
 */
const fileArg = process.argv.indexOf('--file');
const fromFile = fileArg !== -1 ? process.argv[fileArg + 1] : null;
const wanted = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 60);

const readKey = async () => {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const env = await readFile(join(HERE, '..', '..', '..', 'services', 'api', '.env'), 'utf8');
    const m = /^GEMINI_API_KEY\s*=\s*(.*)$/m.exec(env);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
};

// Only needed when the model is actually being asked.
const key = fromFile ? null : await readKey();
if (!fromFile && !key) {
  console.error('No GEMINI_API_KEY found, in the environment or services/api/.env.');
  console.error('Set it and run again; nothing was changed.');
  process.exit(1);
}

/** Brands already covered, so the model is not asked to repeat itself. */
const existing = new Set(
  (await readdir(OUT).catch(() => [])).map((f) => f.replace(/\.(png|svg)$/i, '')),
);

const PROMPT = `List ${wanted} well-known consumer brands that appear on Indian
bank and UPI transaction messages - shops, food delivery, travel, streaming,
utilities, pharmacies, fuel, banks and fintech apps.

Return ONLY a JSON array, no prose and no code fence, of objects shaped:
  {"name": "Brand Name", "domain": "brand.com"}

Rules:
- "domain" must be the company's own primary website, no path, no protocol.
- Use the name a person would type, not a legal entity name.
- Skip any brand whose name is an ordinary English word on its own
  (for example Shell, Titan, Slice, Jupiter), because matching it inside a
  description would produce false positives.
- Do not include: ${[...existing].slice(0, 120).join(', ')}`;

const askGemini = async () => {
  console.log(`Asking ${MODEL} for ${wanted} brands (${existing.size} already covered)...`);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  ).catch((e) => ({ ok: false, status: 0, statusText: e.message }));

  if (!res.ok) {
    const detail = typeof res.text === 'function' ? await res.text().catch(() => '') : '';
    console.error(`Gemini refused the request: ${res.status} ${res.statusText}`);
    // Enough of the body to name the cause - a bad key, a disabled API - and
    // no more, so nothing long is echoed into a terminal.
    if (detail) console.error(detail.replace(/\s+/g, ' ').slice(0, 180));
    process.exit(1);
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  try {
    return JSON.parse(text.replace(/^```(?:json)?|```$/gm, '').trim());
  } catch {
    console.error('Gemini did not return JSON. First 200 characters:');
    console.error(text.slice(0, 200));
    return process.exit(1);
  }
};

let candidates;
if (fromFile) {
  console.log(`Reading candidates from ${fromFile} (${existing.size} already covered)...`);
  candidates = JSON.parse(await readFile(fromFile, 'utf8'));
} else {
  candidates = await askGemini();
}

if (!Array.isArray(candidates)) {
  console.error('Expected a JSON array of {name, domain}.');
  process.exit(1);
}

// The model is a source of SUGGESTIONS, not of truth: everything it returns is
// checked before it is used, and a malformed row is dropped rather than
// crashing the run.
const clean = candidates
  .filter((c) => c && typeof c.name === 'string' && typeof c.domain === 'string')
  .map((c) => ({ name: c.name.trim(), domain: c.domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') }))
  .filter((c) => c.name.length > 1 && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(c.domain))
  .filter((c) => !existing.has(slugFor(c.name)));

console.log(`${clean.length} usable suggestions. Fetching logos...\n`);

await mkdir(OUT, { recursive: true });

const added = [];
const rejected = [];
for (const { name, domain } of clean) {
  const result = await fetchLogo(domain).catch((e) => ({ error: e.message }));
  if (result.error) {
    // No logo, so the brand is NOT added. Recognising a name only to draw
    // initials for it buys nothing the app cannot already do.
    rejected.push(`${name} (${domain}): ${result.error.split(';')[0]}`);
    continue;
  }
  await saveLogo(OUT, name, result);
  added.push(name);
  console.log(`  + ${name} — ${result.ext} ${result.size.w}`);
}

/**
 * The names the app should recognise, written from the files that actually
 * exist. Keeping this generated means the recognised list and the shipped
 * images can never drift apart.
 */
const slugs = (await readdir(OUT))
  .filter((f) => /\.(png|svg)$/i.test(f))
  .map((f) => f.replace(/\.(png|svg)$/i, ''))
  .sort();

await writeFile(GENERATED, `/**
 * GENERATED by scripts/discover-brands.mjs - do not edit by hand.
 *
 * Every brand that has a logo file in src/assets/brands, as a name the
 * matcher can look for. Derived from the files themselves, so a brand can
 * never be recognised without an image to show for it.
 */
export const BRANDS_WITH_LOGOS: readonly string[] = [
${slugs.map((s) => `  '${s.replace(/-/g, ' ')}',`).join('\n')}
];
`);

console.log(`\nADDED ${added.length}`);
console.log(`NO LOGO, SKIPPED ${rejected.length}:`);
for (const line of rejected.slice(0, 20)) console.log('  ' + line);
console.log(`\n${slugs.length} brands now have a logo; wrote ${GENERATED}`);

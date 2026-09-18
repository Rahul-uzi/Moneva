#!/usr/bin/env node
/**
 * One command that produces a release, or stops.
 *
 * WHY THIS EXISTS. Shipping a version was six steps in three places - the two
 * files holding the version, the four download links on the site, and three
 * environment variables on Render - and nothing connected them. Doing five of
 * the six leaves no error anywhere:
 *
 *   - miss the version in .env.production and the app misreports itself, and
 *     the update check compares the wrong number
 *   - miss one of the four hrefs and the footer quietly serves the old build
 *   - miss Render and the site offers a new version that no existing user is
 *     ever told about
 *
 * Both of the first two have already happened in this repository.
 *
 * THE RULE THIS SCRIPT IS WRITTEN AROUND: every step fails loudly and stops.
 * That is not a style preference. A gradle build whose JAVA_HOME was wrong
 * once left the PREVIOUS apk on disk and reported success at every later step,
 * and the stale file was installed on a phone before anyone noticed. So
 * nothing here trusts an exit code where it can check the artefact instead:
 * the APK's mtime is compared against the start of the run, both artefacts are
 * verified as signed, and the version inside the built APK is read back.
 *
 *   node scripts/release.mjs 1.0.2          # build, verify, stage
 *   node scripts/release.mjs 1.0.2 --install # ... and adb install it
 *   node scripts/release.mjs --check         # verify the current state only
 */

import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'apps', 'web');
const ANDROID = join(WEB, 'android');
const SITE = join(ROOT, 'website');

/* Windows paths, deliberately. gradlew rejects the POSIX spelling that the
   Bash tool accepts everywhere else, and JAVA_HOME must include the version
   directory - D:/Android/JDK holds 17/ and 21/, not a JDK. */
const JAVA_HOME = process.env.MONEVA_JAVA_HOME || 'D:\\Android\\JDK\\21';
const ADB = process.env.MONEVA_ADB || 'D:\\Android\\Sdk\\platform-tools\\adb.exe';

const startedAt = Date.now();
let step = 0;

const say = (msg) => console.log(msg);
const heading = (msg) => console.log(`\n[${++step}] ${msg}`);
const ok = (msg) => console.log(`    ok  ${msg}`);

/** Stop the whole run. Nothing here continues past a failure. */
const die = (msg) => {
  console.error(`\nFAILED: ${msg}\n`);
  process.exit(1);
};

const run = (cmd, cwd, env = {}) => {
  try {
    return execSync(cmd, {
      cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
      env: { ...process.env, JAVA_HOME, ...env },
    });
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`.trim();
    die(`${cmd}\n\n${out.split('\n').slice(-25).join('\n')}`);
  }
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/**
 * apksigner, from whichever build-tools version is installed.
 *
 * Not hard-coded to a version: build-tools are updated by Android Studio
 * without asking, and a pinned path breaks silently the next time that
 * happens. The newest installed one is taken.
 */
const findApksigner = () => {
  const base = process.env.MONEVA_SDK || 'D:\\Android\\Sdk';
  const dir = join(base, 'build-tools');
  if (!existsSync(dir)) die(`no build-tools under ${dir} - set MONEVA_SDK`);
  const versions = readdirSync(dir).sort().reverse();
  for (const v of versions) {
    const p = join(dir, v, 'apksigner.bat');
    if (existsSync(p)) return p;
  }
  die(`no apksigner found under ${dir}`);
};

/** Built during THIS run, not left over from a previous one. */
const assertFresh = (file, what) => {
  if (!existsSync(file)) die(`${what} was not produced at ${file}`);
  const m = statSync(file).mtimeMs;
  if (m < startedAt) {
    die(`${what} is STALE - last written ${new Date(m).toISOString()}, before this run began.\n`
      + 'The build step reported success without producing anything. This is the\n'
      + 'exact failure the script exists to catch; do not ship this file.');
  }
  return statSync(file).size;
};

// ---------------------------------------------------------------- versions ---

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** MAJOR*10000 + MINOR*100 + PATCH. Must match versionCodeOf in updateCheck.ts. */
const versionCodeOf = (name) => {
  const m = VERSION_RE.exec(name);
  if (!m) die(`"${name}" is not a three-part version like 1.0.2`);
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
};

const readVersions = () => {
  const gradle = readFileSync(join(ANDROID, 'variables.gradle'), 'utf8');
  const envProd = readFileSync(join(WEB, '.env.production'), 'utf8');
  return {
    gradleName: /monevaVersionName\s*=\s*'([^']+)'/.exec(gradle)?.[1],
    gradleCode: Number(/monevaVersionCode\s*=\s*(\d+)/.exec(gradle)?.[1]),
    envName: /^VITE_APP_VERSION=(.+)$/m.exec(envProd)?.[1]?.trim(),
  };
};

const setVersion = (name) => {
  const code = versionCodeOf(name);
  const gradleFile = join(ANDROID, 'variables.gradle');
  let g = readFileSync(gradleFile, 'utf8');
  g = g.replace(/monevaVersionCode\s*=\s*\d+/, `monevaVersionCode = ${code}`)
       .replace(/monevaVersionName\s*=\s*'[^']+'/, `monevaVersionName = '${name}'`);
  writeFileSync(gradleFile, g);

  // All three env files, because .env is what a local build reads and
  // .env.production is what a release build reads - and a mismatch between
  // them is invisible until the wrong number ships.
  for (const f of ['.env', '.env.production', '.env.example']) {
    const p = join(WEB, f);
    if (!existsSync(p)) continue;
    const s = readFileSync(p, 'utf8');
    writeFileSync(p, s.replace(/^VITE_APP_VERSION=.*$/m, `VITE_APP_VERSION=${name}`));
  }
  return code;
};

const checkAgreement = () => {
  const v = readVersions();
  if (!v.gradleName || !v.envName) die('could not read the version from variables.gradle or .env.production');
  if (v.gradleName !== v.envName) {
    die(`the two version files disagree: variables.gradle says ${v.gradleName}, `
      + `.env.production says ${v.envName}.\nThe app would misreport itself and the `
      + 'update check would compare the wrong number.');
  }
  if (v.gradleCode !== versionCodeOf(v.gradleName)) {
    die(`versionCode ${v.gradleCode} does not match the name ${v.gradleName} `
      + `(expected ${versionCodeOf(v.gradleName)})`);
  }
  return v;
};

// -------------------------------------------------------------------- site ---

/**
 * Every download link on the page, rewritten together.
 *
 * Counted, not just replaced: the README once said three and there were four,
 * and the fourth - in the footer - went on serving an older build.
 */
const repointSite = (version) => {
  const indexFile = join(SITE, 'index.html');
  let html = readFileSync(indexFile, 'utf8');

  const hrefs = html.match(/href="downloads\/moneva-[^"]+\.apk"/g) || [];
  if (hrefs.length === 0) die('found no APK download links in website/index.html');

  const unique = new Set(hrefs);
  if (unique.size > 1) {
    say(`    note: links already disagreed - ${[...unique].join(', ')}`);
  }
  html = html.replace(/href="downloads\/moneva-[^"]+\.apk"/g,
    `href="downloads/moneva-${version}.apk"`);

  const specBefore = html;
  html = html.replace(/<span>APK · v[^<]*<\/span>/,
    `<span>APK · v${version} · SIZE_MB MB · Android 7.0+</span>`);
  const specChanged = html !== specBefore;

  writeFileSync(indexFile, html);
  return { links: hrefs.length, specChanged };
};

// ------------------------------------------------------------------- steps ---

const version = process.argv.find((a) => VERSION_RE.test(a));
const wantInstall = process.argv.includes('--install');
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  const v = checkAgreement();
  say(`\nversions agree: ${v.gradleName} (code ${v.gradleCode})\n`);
  process.exit(0);
}

if (!version) {
  die('give the version to build, e.g.\n  node scripts/release.mjs 1.0.2\n  node scripts/release.mjs 1.0.2 --install\n  node scripts/release.mjs --check');
}

const current = readVersions();
const code = versionCodeOf(version);
if (code <= current.gradleCode && version !== current.gradleName) {
  die(`${version} (code ${code}) is not newer than the current ${current.gradleName} `
    + `(code ${current.gradleCode}). Android refuses a downgrade.`);
}

say(`\nMONEVA release ${version}  (versionCode ${code})`);
say(`  from ${current.gradleName}`);

heading('Setting the version in both places');
setVersion(version);
const agreed = checkAgreement();
ok(`variables.gradle and .env.production both say ${agreed.gradleName}`);

heading('Building the web bundle');
run('npm run build', WEB);
ok('tsc and vite succeeded');

heading('Syncing into the Android project');
run('npx cap sync android', WEB);
ok('capacitor sync done');

heading('Building the signed APK');
run('.\\gradlew.bat assembleRelease', ANDROID);
const apk = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const apkSize = assertFresh(apk, 'the APK');
ok(`${(apkSize / 1048576).toFixed(2)} MB, written during this run`);

heading('Building the signed App Bundle');
run('.\\gradlew.bat bundleRelease', ANDROID);
const aab = join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
const aabSize = assertFresh(aab, 'the AAB');
ok(`${(aabSize / 1048576).toFixed(2)} MB, written during this run`);

heading('Verifying both are signed');
/*
 * Two tools, because they read different things and only one works per
 * artefact.
 *
 * jarsigner understands v1 (JAR) signing only. build.gradle sets
 * enableV1Signing false deliberately - v1 is needed below API 24 and this app
 * requires 24 - so jarsigner reports the release APK as "jar is unsigned"
 * while it is perfectly signed with v2 and v3. Using it here would fail every
 * release for a reason that is not real; it was written that way first and
 * caught by checking against a known-good build.
 *
 * apksigner reads v2/v3/v4 and is the right tool for an APK. An AAB is not an
 * APK and apksigner will not take it - a bundle really is jar-signed, so that
 * one goes to jarsigner.
 */
const apksigner = findApksigner();
const apkCert = run(`"${apksigner}" verify --print-certs "${apk}"`, ROOT);
if (!/Signer #1 certificate DN/i.test(apkCert)) {
  die(`the APK is not signed. apksigner said:\n${apkCert}`);
}
ok(`APK signed - ${/Signer #1 certificate DN:\s*(.+)/.exec(apkCert)?.[1]?.trim()}`);

const aabOut = run(`"${JAVA_HOME}\\bin\\jarsigner.exe" -verify "${aab}"`, ROOT);
if (!/jar verified/i.test(aabOut)) die(`the AAB is NOT signed - jarsigner said:\n${aabOut}`);
ok('AAB signed');

heading('Reading the version back out of the built APK');
/*
 * Asks the ARTEFACT, not the file that was meant to configure it. The version
 * reaches the bundled JavaScript through VITE_APP_VERSION, so it is present as
 * plain bytes inside the APK - which makes this a genuine check that the web
 * build picked up the new number, rather than a restatement of what was
 * written two steps ago.
 *
 * This is the check that would have caught the release where `tsc` failed, the
 * web build never ran, and gradle packaged the PREVIOUS dist while every step
 * still reported success.
 */
if (!readFileSync(apk).includes(Buffer.from(version, 'utf8'))) {
  die([
    `the built APK does not contain the string "${version}".`,
    'The web bundle inside it is from an earlier build: the version was written',
    'to .env.production but vite did not pick it up. Do not ship this file.',
  ].join('\n'));
}
ok(`"${version}" found inside the packaged web bundle`);

heading('Staging the APK on the site');
mkdirSync(join(SITE, 'downloads'), { recursive: true });
const staged = join(SITE, 'downloads', `moneva-${version}.apk`);
copyFileSync(apk, staged);
if (sha256(staged) !== sha256(apk)) die('the copied APK does not match the build');
const { links, specChanged } = repointSite(version);
// The size is only known after the build, so the placeholder is filled now.
const sizeMb = (apkSize / 1048576).toFixed(1);
const indexFile = join(SITE, 'index.html');
writeFileSync(indexFile, readFileSync(indexFile, 'utf8').replace('SIZE_MB', sizeMb));
ok(`${links} download link${links === 1 ? '' : 's'} repointed`);
ok(specChanged ? `spec line now reads v${version} · ${sizeMb} MB` : 'spec line unchanged - check it by hand');

const digest = sha256(apk);

if (wantInstall) {
  heading('Installing on the connected device');
  const devices = run(`"${ADB}" devices`, ROOT);
  const connected = devices.split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim()));
  if (connected.length === 0) {
    die('no authorised device. Check the cable, and accept the "Allow USB debugging" prompt on the phone.');
  }
  run(`"${ADB}" install -r "${apk}"`, ROOT);
  ok(`installed on ${connected.length} device${connected.length === 1 ? '' : 's'}`);
}

// ------------------------------------------------------------------ report ---

say(`\n${'-'.repeat(68)}`);
say(`MONEVA ${version} built and staged.\n`);
say(`  APK  ${(apkSize / 1048576).toFixed(2)} MB   website/downloads/moneva-${version}.apk`);
say(`  AAB  ${(aabSize / 1048576).toFixed(2)} MB   ${aab}`);
say(`       (an .aab cannot be installed - it is for Play upload only)\n`);
say(`  SHA-256  ${digest}\n`);
say('Still to do by hand, because neither lives in this repository:\n');
say('  1. Commit and push. Cloudflare redeploys the site within a minute.');
say('  2. Set these on Render, or NO EXISTING USER IS TOLD about this release:\n');
say(`       LATEST_VERSION_CODE=${code}`);
say(`       LATEST_VERSION_NAME=${version}`);
say(`       APK_DOWNLOAD_URL=https://moneva.monev.workers.dev/downloads/moneva-${version}.apk`);
say('       LATEST_RELEASE_NOTES=<one line on what changed>\n');
say('  3. Delete the previous APK from website/downloads/ - git keeps every');
say('     version of a binary for ever.\n');
say(`${'-'.repeat(68)}\n`);

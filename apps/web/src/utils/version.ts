/**
 * MONEVA's one version scheme, shared by the APK and live updates.
 *
 * MAJOR*10000 + MINOR*100 + PATCH - the same formula build.gradle uses, so
 * 1.2.3 is 10203 on both sides. Kept apart from updateCheck so the manifest
 * reader and the updater can both use it without importing each other.
 */
export const versionCodeOf = (name: string): number => {
  const parts = String(name).trim().split('.').map((n) => parseInt(n, 10));
  const [major, minor, patch] = [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  return major * 10000 + minor * 100 + patch;
};

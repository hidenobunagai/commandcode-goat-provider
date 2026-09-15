/**
 * Pure half of the release check: does the changelog carry this version's heading?
 *
 * `scripts/check-changelog.ts` owns the file I/O and calls `process.exit`, so importing
 * it from a test would run `main()` and kill the Jest worker. The match itself — the only
 * part that can silently stop working — lives here, the same split as
 * `scripts/model-catalog.ts` for the drift gate.
 */
export function hasChangelogEntry(version: string, changelog: string): boolean {
  // Escape every regex metacharacter, not just the dots: a semver build suffix such as
  // `0.1.17+build.1` would otherwise be read as a quantifier and never match its heading.
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s*\\[\\s*${escapedVersion}\\s*\\]`, "m").test(changelog);
}

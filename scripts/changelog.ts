/**
 * Pure half of the release check: does the changelog carry this version's heading, and is
 * the version history itself readable — every version once, newest first?
 *
 * `scripts/check-changelog.ts` owns the file I/O and calls `process.exit`, so importing
 * it from a test would run `main()` and kill the Jest worker. The logic itself — the only
 * part that can silently stop working — lives here, the same split as
 * `scripts/model-catalog.ts` for the drift gate.
 */
export function hasChangelogEntry(version: string, changelog: string): boolean {
  // Escape every regex metacharacter, not just the dots: a semver build suffix such as
  // `0.1.17+build.1` would otherwise be read as a quantifier and never match its heading.
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^##\\s*\\[\\s*${escapedVersion}\\s*\\]`, "m").test(changelog);
}

/** A `## [X.Y.Z] - YYYY-MM-DD` heading; the date is optional. */
const SECTION_PATTERN = /^##\s*\[\s*(\d+\.\d+\.\d+)\s*\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/gm;

function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split(".").map(Number);
  const [bMajor, bMinor, bPatch] = b.split(".").map(Number);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

/**
 * Problems that make the version history unreadable, as ready-to-print lines: a version
 * whose section appears twice — how a rebase that lands two version bumps on the same
 * number goes unnoticed — and sections that are not newest-first by version or by date.
 * Empty on a healthy changelog. Same-day releases and gaps in the numbering are fine.
 */
export function findChangelogProblems(changelog: string): string[] {
  const sections = [...changelog.matchAll(SECTION_PATTERN)].map((match) => ({
    version: match[1],
    date: match[2],
  }));

  const problems: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < sections.length; index++) {
    const section = sections[index];
    if (seen.has(section.version)) {
      problems.push(`Duplicate section: ## [${section.version}] appears more than once.`);
    }
    seen.add(section.version);

    const previous = sections[index - 1];
    if (!previous) {
      continue;
    }
    if (compareVersions(section.version, previous.version) > 0) {
      problems.push(
        `Not in descending order: ## [${section.version}] appears after ## [${previous.version}].`,
      );
    } else if (previous.date && section.date && section.date > previous.date) {
      problems.push(
        `Not in descending order: ## [${section.version}] is dated ${section.date}, after ## [${previous.version}] dated ${previous.date}.`,
      );
    }
  }

  return problems;
}

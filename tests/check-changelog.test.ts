/**
 * Regression tests for the release check's changelog checks (scripts/changelog.ts): the
 * heading match for the shipping version, and the duplicate / descending-order scan over
 * every version section.
 *
 * `bun run package:vsix` runs `scripts/check-changelog.ts` before packaging, and that
 * script cannot be imported from a test — `import("./scripts/check-changelog.ts")`
 * runs `main()` and exits the process before the next statement. The first case pins
 * the extracted match against this repo's own package.json + CHANGELOG.md, so a
 * reflow that stops the regex from finding the current heading fails here, not only
 * at package time.
 */
import fs from "node:fs";
import path from "node:path";
import { findChangelogProblems, hasChangelogEntry } from "../scripts/changelog";

const ROOT = path.resolve(__dirname, "..");
const version = (
  JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }
).version;
const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");

test("finds the heading for the version package.json ships", () => {
  expect(hasChangelogEntry(version, changelog)).toBe(true);
});

test("accepts the heading spacing variants and no others", () => {
  expect(hasChangelogEntry("0.1.16", "## [0.1.16] - 2026-09-15\n")).toBe(true);
  expect(hasChangelogEntry("0.1.16", "##[0.1.16]\n")).toBe(true);
  expect(hasChangelogEntry("0.1.16", "## [ 0.1.16 ]\n")).toBe(true);
  expect(hasChangelogEntry("0.1.16", "## [0.1.160] - 2026-09-15\n")).toBe(false);
  expect(hasChangelogEntry("0.1.16", "## [0.1.1] - 2026-09-15\n")).toBe(false);
});

test("ignores the version outside a level-2 heading of its own line", () => {
  expect(hasChangelogEntry("0.1.16", "### [0.1.16] - 2026-09-15\n")).toBe(false);
  expect(hasChangelogEntry("0.1.16", "Shipped in [0.1.16] today.\n")).toBe(false);
  expect(hasChangelogEntry("0.1.16", "## [Unreleased]\n")).toBe(false);
});

test("reads regex metacharacters in the version as literals", () => {
  expect(hasChangelogEntry("0.1.17+build.1", "## [0.1.17+build.1]\n")).toBe(true);
});

const section = (sectionVersion: string, date: string) =>
  `## [${sectionVersion}] - ${date}\n\n### Fixed\n\n- something\n\n`;

test("finds no problems in this repo's own CHANGELOG.md", () => {
  expect(findChangelogProblems(changelog)).toEqual([]);
});

test("allows same-day releases and gaps in the version numbers", () => {
  const clean =
    section("0.1.16", "2026-09-15") +
    section("0.1.9", "2026-09-15") +
    section("0.1.8", "2026-09-12");
  expect(findChangelogProblems(clean)).toEqual([]);
});

test("reads only version sections, not other level-2 headings", () => {
  expect(findChangelogProblems("# Change Log\n\n## [Unreleased]\n\n- wip\n")).toEqual([]);
  expect(findChangelogProblems("## [0.1.16] - 2026-09-15\n\n## [Unreleased]\n")).toEqual([]);
});

test("reports a version whose section appears twice", () => {
  const changelog = section("0.1.16", "2026-09-15") + section("0.1.16", "2026-09-15");
  expect(findChangelogProblems(changelog)).toEqual([
    "Duplicate section: ## [0.1.16] appears more than once.",
  ]);
});

test("reports a version heading below an older one", () => {
  const changelog = section("0.1.15", "2026-09-12") + section("0.1.16", "2026-09-15");
  expect(findChangelogProblems(changelog)).toEqual([
    "Not in descending order: ## [0.1.16] appears after ## [0.1.15].",
  ]);
});

test("reports a section dated after the newer section above it", () => {
  const changelog = section("0.1.16", "2026-09-10") + section("0.1.15", "2026-09-12");
  expect(findChangelogProblems(changelog)).toEqual([
    "Not in descending order: ## [0.1.15] is dated 2026-09-12, after ## [0.1.16] dated 2026-09-10.",
  ]);
});

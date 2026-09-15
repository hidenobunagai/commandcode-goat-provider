/**
 * Regression tests for the release check's heading match (scripts/changelog.ts).
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
import { hasChangelogEntry } from "../scripts/changelog";

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

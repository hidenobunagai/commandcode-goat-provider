/**
 * The effort gate's resolution order (scripts/effort-evidence.ts): recorded decision,
 * then an explicit pi-ai thinkingLevelMap (vendor file before aggregators), and only then
 * pi-ai's generic default, which counts as unverified.
 */
import fs from "node:fs";
import path from "node:path";
import {
  compareEfforts,
  resolveEfforts,
  supportedLevels,
  type PiData,
  type PiModel,
} from "../scripts/effort-evidence";

const data = (files: Record<string, PiModel[]>): PiData =>
  new Map(
    Object.entries(files).map(([file, models]) => [
      file,
      new Map(models.map((m) => [m.id.toLowerCase(), m])),
    ]),
  );

const PI = data({
  meta: [
    {
      id: "muse-spark-1.3",
      reasoning: true,
      thinkingLevelMap: { off: null, minimal: "minimal", xhigh: "xhigh", max: "max" },
    },
  ],
  openrouter: [
    { id: "meta/muse-spark-1.3", reasoning: true, thinkingLevelMap: { max: null } },
    {
      id: "z-ai/glm-5.2",
      reasoning: true,
      thinkingLevelMap: { low: null, medium: null, max: "max" },
    },
  ],
  xiaomi: [{ id: "mimo-v2.6-pro", reasoning: true }],
  moonshotai: [{ id: "kimi-k2.7-code", reasoning: true, thinkingLevelMap: { off: null } }],
  openai: [{ id: "gpt-4.1", reasoning: false }],
});

test("supportedLevels mirrors pi-ai: no map means off..high, xhigh/max need a mapping", () => {
  expect(supportedLevels({ id: "a", reasoning: true })).toEqual([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  expect(supportedLevels({ id: "a", reasoning: false })).toEqual([]);
});

test("the vendor's own explicit map wins over an aggregator's", () => {
  const ev = resolveEfforts("meta/muse-spark-1.3", PI, {});
  expect(ev).toMatchObject({ strength: "explicit", source: "pi-ai meta:muse-spark-1.3" });
  expect(ev.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
});

test("a map that only mentions off, or no map at all, is pi-ai's default, not evidence", () => {
  expect(resolveEfforts("moonshotai/Kimi-K2.7-Code", PI, {}).strength).toBe("default");
  expect(resolveEfforts("xiaomi/mimo-v2.6-pro", PI, {})).toMatchObject({
    strength: "default",
    efforts: ["low", "medium", "high"],
  });
  expect(resolveEfforts("stealth/unknown", PI, {}).strength).toBe("none");
});

test("an explicit non-reasoning model resolves to no efforts", () => {
  expect(resolveEfforts("gpt-4.1", PI, {})).toMatchObject({ strength: "explicit", efforts: [] });
});

test("a recorded decision overrides pi-ai", () => {
  const ev = resolveEfforts("meta/muse-spark-1.3", PI, {
    "meta/muse-spark-1.3": {
      efforts: ["low", "high"],
      source: "vendor docs",
      decided: "2026-10-02",
    },
  });
  expect(ev).toMatchObject({ strength: "decision", efforts: ["low", "high"] });
});

test("compareEfforts splits mismatches against evidence from rows that need research", () => {
  const catalog = new Map([
    ["z-ai/glm-5.2", { efforts: ["high", "max"] }],
    ["meta/muse-spark-1.3", { efforts: ["high", "low"] }],
    ["xiaomi/mimo-v2.6-pro", { efforts: [] }],
  ]);
  const { mismatched, unverified } = compareEfforts(catalog, PI, {});
  expect(mismatched.map((m) => m.id)).toEqual(["meta/muse-spark-1.3"]);
  expect(unverified.map((m) => m.id)).toEqual(["xiaomi/mimo-v2.6-pro"]);
});

test("docs/effort-decisions.json is well-formed", () => {
  const file = path.resolve(__dirname, "../docs/effort-decisions.json");
  const decisions = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  for (const [id, d] of Object.entries(decisions)) {
    expect(d).toEqual({
      efforts: expect.any(Array),
      source: expect.stringMatching(/\S/),
      decided: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    for (const rung of (d as { efforts: string[] }).efforts)
      expect(["low", "medium", "high", "xhigh", "max"]).toContain(rung);
    expect(id).not.toBe("");
  }
});

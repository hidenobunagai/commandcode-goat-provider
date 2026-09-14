/**
 * Regression tests for the drift gate's parsers (scripts/model-catalog.ts).
 *
 * The parsers read catalogs with line-oriented regexes, so a reformat can silently
 * change what the gate sees. The first two tests pin them against the extension's
 * own tables (`FALLBACK_MODELS`, built from the same literals at runtime), which is
 * the cross-check a prettier reflow of src/constants.ts would break.
 */
import fs from "node:fs";
import path from "node:path";
import { FALLBACK_MODELS } from "../src/constants";
import {
  compare,
  compareCapabilities,
  parseDshCapabilities,
  parseDshCatalog,
  parseVsceCapabilities,
  parseVsceCatalog,
  type Capability,
  type ModelEntry,
} from "../scripts/model-catalog";

const ROOT = path.resolve(__dirname, "..");
const VSCE_SOURCE = fs.readFileSync(path.join(ROOT, "src/constants.ts"), "utf8");

const entry = (id: string, name: string, contextWindow: number): ModelEntry => ({
  id,
  name,
  contextWindow,
});

const cap = (vision: boolean, efforts: string[], protocol: string): Capability => ({
  vision,
  efforts,
  protocol,
});

test("parseVsceCatalog reads every OFFICIAL_MODELS row the extension ships", () => {
  expect([...parseVsceCatalog(VSCE_SOURCE).values()]).toEqual(
    FALLBACK_MODELS.map((m) => entry(m.id, m.name, m.contextWindow)),
  );
});

test("parseVsceCapabilities reads the tables the extension runs on", () => {
  const parsed = parseVsceCapabilities(VSCE_SOURCE);

  expect(parsed.size).toBe(FALLBACK_MODELS.length);
  for (const model of FALLBACK_MODELS) {
    expect(parsed.get(model.id)).toEqual(
      cap(
        model.supportsVision,
        model.supportedReasoningEfforts ? [...model.supportedReasoningEfforts].sort() : [],
        model.apiFormat ?? "openai",
      ),
    );
  }
});

test("parseVsceCatalog fails loudly on a row it cannot fully read", () => {
  const source = [
    "const OFFICIAL_MODELS: Array<[string, string, number]> = [",
    '  ["good-model", "Good Model", 1000],',
    '  ["no-context", "No Context"],',
    "];",
    "const VISION_SET = new Set([",
    '  "good-model",',
    "]);",
  ].join("\n");

  expect(() => parseVsceCatalog(source)).toThrow(/malformed OFFICIAL_MODELS row/);
});

test("parseVsceCatalog fails loudly when the tables are gone", () => {
  expect(() => parseVsceCatalog("export const OTHER = [];\n")).toThrow(
    /cannot locate OFFICIAL_MODELS block/,
  );
});

test("parseDshCatalog reads CATALOG rows and ignores everything else", () => {
  const source = [
    "import type { CatalogEntry } from '../types.ts'",
    "",
    "// ── Single source of truth ──",
    "export const CATALOG: readonly CatalogEntry[] = [",
    "  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 1050000, maxTokens: 65536 },",
    "  { id: 'Qwen/Qwen3.8-Max', name: 'Qwen 3.8 Max', contextWindow: 1000000, latest: true },",
    "]",
    "",
    "export const BY_ID = new Map(CATALOG.map((m) => [m.id, m]))",
  ].join("\n");

  expect([...parseDshCatalog(source).values()]).toEqual([
    entry("gpt-5.6-luna", "GPT-5.6 Luna", 1050000),
    entry("Qwen/Qwen3.8-Max", "Qwen 3.8 Max", 1000000),
  ]);
});

test("parseDshCatalog fails loudly when no CATALOG row survives", () => {
  expect(() => parseDshCatalog("export const CATALOG: readonly CatalogEntry[] = []\n")).toThrow(
    /no CATALOG rows parsed/,
  );
});

test("parseDshCapabilities derives vision, sorted efforts and protocol per row", () => {
  const source = [
    "export const CATALOG: readonly CatalogEntry[] = [",
    "  { id: 'vision-anthropic', name: 'A', contextWindow: 1, protocol: 'anthropic', modalities: ['text', 'image'], efforts: ['max', 'high'] },",
    "  { id: 'text-openai', name: 'B', contextWindow: 2, modalities: ['text'] },",
    "]",
  ].join("\n");
  const parsed = parseDshCapabilities(source);

  expect(parsed.get("vision-anthropic")).toEqual(cap(true, ["high", "max"], "anthropic"));
  expect(parsed.get("text-openai")).toEqual(cap(false, [], "openai"));
});

test("compareCapabilities reports each divergence and each one-sided model", () => {
  const vscode = new Map([
    ["same", cap(true, ["high"], "openai")],
    ["vsce-only", cap(true, ["high"], "openai")],
    ["differs", cap(false, ["high", "max"], "openai")],
  ]);
  const dsh = new Map([
    ["same", cap(true, ["high"], "openai")],
    ["dsh-only", cap(false, [], "openai")],
    ["differs", cap(true, ["low"], "anthropic")],
  ]);

  expect(compareCapabilities(vscode, dsh)).toEqual([
    { id: "vsce-only", changed: ["missing from DSH CATALOG"] },
    {
      id: "differs",
      changed: [
        "vision vsce=false dsh=true",
        "protocol vsce=openai dsh=anthropic",
        "efforts vsce=[high,max] dsh=[low]",
      ],
    },
    { id: "dsh-only", changed: ["missing from VS Code tables"] },
  ]);
});

test("compare sorts live models into new, changed, missing-from-DSH and removed", () => {
  const live = [
    { id: "known", name: "Known", context_length: 100 },
    { id: "retuned", name: "New Name", context_length: 200 },
    { id: "fresh", name: "Fresh", context_length: 300 },
    { id: "vsce-only", name: "VS Code Only", context_length: 400 },
  ];
  const vscode = new Map([
    ["known", entry("known", "Known", 100)],
    ["retuned", entry("retuned", "Old Name", 100)],
    ["vsce-only", entry("vsce-only", "VS Code Only", 400)],
    ["gone", entry("gone", "Gone", 50)],
  ]);
  const dsh = new Map([["known", entry("known", "Known", 100)]]);

  expect(compare(live, vscode, dsh)).toEqual({
    newModels: [{ id: "fresh", name: "Fresh", contextWindow: 300, dsh: undefined, changed: [] }],
    changedModels: [
      {
        id: "retuned",
        vscode: entry("retuned", "Old Name", 100),
        dsh: undefined,
        changed: ["VS Code contextWindow 100 → 200", 'VS Code name "Old Name" → "New Name"'],
      },
    ],
    missingFromDsh: [
      {
        id: "vsce-only",
        vscode: entry("vsce-only", "VS Code Only", 400),
        changed: ["present in VS Code catalog, absent from DSH CATALOG"],
      },
    ],
    removedModels: [
      {
        id: "gone",
        name: "Gone",
        contextWindow: 50,
        vscode: entry("gone", "Gone", 50),
        dsh: undefined,
        changed: [],
      },
    ],
  });
});

test("compare treats a live row without name or context_length as unchanged", () => {
  const source = new Map([["known", entry("known", "Known", 100)]]);

  expect(compare([{ id: "known" }], source, source)).toEqual({
    newModels: [],
    changedModels: [],
    missingFromDsh: [],
    removedModels: [],
  });
});

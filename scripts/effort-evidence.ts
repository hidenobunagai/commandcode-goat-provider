/**
 * Thinking-effort evidence for the drift gate.
 *
 * Command Code's gateway cannot tell us a model's real effort ladder: `/provider/v1/models`
 * carries no capability data, and `/provider/v1/chat/completions` accepts the same enum
 * (`off|low|medium|high|xhigh|max`) for every model — probed 2026-10-02, xiaomi/mimo-v2.6-flash
 * returns 200 for xhigh/max although the vendor only offers low/medium/high. So the ladder is
 * resolved from, in order:
 *
 *   1. docs/effort-decisions.json — a decision an agent (or a human) researched and recorded,
 *      with its sources. Always wins; this is how vendor docs and live probes override pi-ai.
 *   2. pi-ai's provider data (the Pi install's `dist/providers/data/*.json`): the vendor's own
 *      provider file first, then aggregators. Only an explicit `thinkingLevelMap` counts as
 *      evidence ("explicit"); `reasoning: true` with no map is pi-ai's generic default
 *      (off..high) and only a hint ("default").
 *
 * The ladder is pi-ai's `getSupportedThinkingLevels` intersected with GATEWAY_EFFORTS.
 * Pure functions take the loaded data so tests run without a Pi install.
 */
import fs from "node:fs";
import path from "node:path";

/** Rungs the Command Code gateway accepts for reasoning_effort ("off" is not a picker rung). */
export const GATEWAY_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const PI_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface PiModel {
  id: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
}

/** provider file name (without .json) → lower-cased model id → model */
export type PiData = Map<string, Map<string, PiModel>>;

export interface EffortDecision {
  efforts: string[];
  /** Where the ladder came from: vendor doc URLs, probe results, pi-ai source. */
  source: string;
  decided: string;
}

export type Strength = "decision" | "explicit" | "default" | "none";

export interface EffortEvidence {
  id: string;
  efforts: string[];
  strength: Strength;
  source: string;
}

/** Vendor prefix of a Command Code id → the pi-ai provider file that vendor maintains. */
const VENDOR_FILE: Record<string, string> = {
  meta: "meta",
  xiaomi: "xiaomi",
  deepseek: "deepseek",
  "z-ai": "zai",
  zai: "zai",
  "zai-org": "zai",
  moonshotai: "moonshotai",
  minimax: "minimax",
  minimaxai: "minimax",
  mistral: "mistral",
  "x-ai": "xai",
  xai: "xai",
  inclusionai: "ant-ling",
  google: "google",
  openai: "openai",
  qwen: "qwen-token-plan",
};
const AGGREGATORS = ["openrouter", "opencode", "opencode-go", "vercel-ai-gateway"];

function vendorFile(id: string): string | undefined {
  if (id.includes("/")) return VENDOR_FILE[id.split("/")[0].toLowerCase()];
  if (id.startsWith("gpt-")) return "openai";
  if (id.startsWith("claude-")) return "anthropic";
  if (id.startsWith("gemini-")) return "google";
  if (id.startsWith("grok-")) return "xai";
  return undefined;
}

/** pi-ai models.js getSupportedThinkingLevels: null drops a level, xhigh/max need an explicit mapping. */
export function supportedLevels(model: PiModel): string[] {
  if (!model.reasoning) return [];
  return PI_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

const toGateway = (levels: string[]) =>
  GATEWAY_EFFORTS.filter((rung) => levels.includes(rung)) as string[];

function lookup(data: PiData, file: string, id: string): PiModel | undefined {
  const models = data.get(file);
  if (!models) return undefined;
  const lid = id.toLowerCase();
  return (
    models.get(lid) ??
    models.get(
      lid
        .split("/")
        .pop()!
        .replace(/:free$/, ""),
    )
  );
}

export function resolveEfforts(
  id: string,
  data: PiData,
  decisions: Record<string, EffortDecision>,
): EffortEvidence {
  const decision = decisions[id];
  if (decision) {
    return { id, efforts: decision.efforts, strength: "decision", source: decision.source };
  }
  const files = [vendorFile(id), ...AGGREGATORS].filter((f): f is string => Boolean(f));
  let fallback: EffortEvidence | undefined;
  for (const file of files) {
    const model = lookup(data, file, id);
    if (!model) continue;
    const efforts = toGateway(supportedLevels(model));
    const source = `pi-ai ${file}:${model.id}`;
    // A map with only an `off` key (e.g. kimi-k2.7-code `{off: null}`) still says nothing about rungs.
    const explicit =
      model.reasoning === false ||
      Object.keys(model.thinkingLevelMap ?? {}).some((level) => level !== "off");
    if (explicit) return { id, efforts, strength: "explicit", source };
    fallback ??= { id, efforts, strength: "default", source };
  }
  return fallback ?? { id, efforts: [], strength: "none", source: "no pi-ai entry" };
}

export interface EffortDiff {
  id: string;
  catalog: string[];
  evidence: EffortEvidence;
}

/**
 * Catalog rows whose efforts are not backed by evidence:
 * - decision / explicit evidence that disagrees with the catalog → MISMATCH
 * - default / none evidence → UNVERIFIED (needs research, then a decision entry)
 */
export function compareEfforts(
  catalog: Map<string, { efforts: string[] }>,
  data: PiData,
  decisions: Record<string, EffortDecision>,
): { mismatched: EffortDiff[]; unverified: EffortDiff[] } {
  const mismatched: EffortDiff[] = [];
  const unverified: EffortDiff[] = [];
  for (const [id, entry] of catalog) {
    const evidence = resolveEfforts(id, data, decisions);
    const current = toGateway(entry.efforts);
    const diff = { id, catalog: current, evidence };
    if (evidence.strength === "decision" || evidence.strength === "explicit") {
      if (current.join(",") !== evidence.efforts.join(",")) mismatched.push(diff);
    } else {
      unverified.push(diff);
    }
  }
  return { mismatched, unverified };
}

/** Pi's bundled pi-ai data: global bun install first (what `pi update` refreshes). */
export function findPiDataDir(home = process.env.HOME ?? ""): string | undefined {
  const candidates = [
    process.env.PI_AI_DATA_DIR,
    path.join(home, ".bun/install/global/node_modules/@earendil-works/pi-ai/dist/providers/data"),
  ];
  return candidates.find((dir): dir is string => Boolean(dir && fs.existsSync(dir)));
}

export function loadPiData(dir: string): PiData {
  const data: PiData = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const models = new Map<string, PiModel>();
    const byApi = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as Record<
      string,
      Record<string, PiModel> | undefined
    >;
    for (const api of Object.values(byApi)) {
      for (const [key, model] of Object.entries(api ?? {})) {
        if (!model?.id) continue;
        models.set(model.id.toLowerCase(), model);
        models.set(key.replace(/^[a-z]+:/, "").toLowerCase(), model);
      }
    }
    data.set(file.slice(0, -".json".length), models);
  }
  return data;
}

export function loadDecisions(file: string): Record<string, EffortDecision> {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, EffortDecision>;
}

#!/usr/bin/env node
/**
 * Detect model-catalog drift against the live Command Code provider API.
 *
 * Compares `GET https://api.commandcode.ai/provider/v1/models` (public, no auth)
 * with the two catalogs that must stay in sync:
 *   1. dsh-commandcode-goat-provider  src/catalog/data.ts   (CATALOG — upstream truth)
 *   2. commandcode-goat-provider      src/constants.ts      (OFFICIAL_MODELS — VS Code extension)
 *
 * No LLM involved: this is the cheap gate that decides whether an agent run is needed.
 *
 * Exit codes:
 *   0  no drift
 *   2  drift detected (new / removed / renamed / retuned models) — agent run warranted
 *   1  internal error (API unreachable, catalog unreadable, malformed entry)
 *
 * Usage:
 *   bun run check:models                       # human-readable report
 *   bun run check:models --json                # machine-readable report
 *   bun run check:models --repo <path>         # override sibling repo location
 */
import fs from "node:fs";
import path from "node:path";

const API_URL = "https://api.commandcode.ai/provider/v1/models";
const DEFAULT_DSH_REPO = path.join(process.env.HOME ?? "/home/pi", "projects/commandcode-goat-dsh-provider");
const VSCE_REPO = process.cwd();

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const repoIdx = argv.indexOf("--repo");
const DSH_REPO = repoIdx >= 0 && argv[repoIdx + 1] ? path.resolve(argv[repoIdx + 1]) : DEFAULT_DSH_REPO;

interface ApiModel {
  id: string;
  name?: string;
  context_length?: number;
}

interface ModelEntry {
  id: string;
  name: string;
  contextWindow: number;
}

/** Vision / thinking / wire-protocol facts, kept identical across the two catalogs. */
interface Capability {
  vision: boolean;
  efforts: string[];
  protocol: string;
}

interface ModelDiff {
  id: string;
  name?: string;
  contextWindow?: number;
  vscode?: ModelEntry;
  dsh?: ModelEntry;
  changed: string[];
}

interface Report {
  ok: boolean;
  apiCount: number;
  apiError?: string;
  vscode: { path: string; count: number | null; error?: string; version?: string };
  dsh: { path: string; count: number | null; error?: string; version?: string };
  newModels: ModelDiff[];
  removedModels: ModelDiff[];
  changedModels: ModelDiff[];
  missingFromDsh: ModelDiff[];
  capabilityModels: ModelDiff[];
  drift: boolean;
}

function die(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function fetchLiveModels(): Promise<ApiModel[]> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${API_URL}`);
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error(`unexpected payload shape from ${API_URL}`);
  return body.data as ApiModel[];
}

/** VS Code extension: OFFICIAL_MODELS rows are `["<id>", "<name>", <context>],`. */
function parseVsceCatalog(repo: string): Map<string, ModelEntry> {
  const file = path.join(repo, "src/constants.ts");
  if (!fs.existsSync(file)) die(`VS Code catalog not found: ${file}`);
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("const OFFICIAL_MODELS");
  const end = source.indexOf("const VISION_SET");
  if (start < 0 || end < 0 || end < start) die(`cannot locate OFFICIAL_MODELS block in ${file}`);
  const block = source.slice(start, end);

  const entries = new Map<string, ModelEntry>();
  for (const line of block.split("\n")) {
    const id = /^\s*\[\s*"([^"]+)"/.exec(line);
    if (!id) continue;
    const name = /^\s*\[\s*"[^"]+"\s*,\s*"([^"]*)"/.exec(line);
    const ctx = /^\s*\[\s*"[^"]+"\s*,\s*"[^"]*"\s*,\s*(\d+)\s*\]/.exec(line);
    if (!name || !ctx) die(`malformed OFFICIAL_MODELS row: ${line.trim()}`);
    entries.set(id[1], { id: id[1], name: name[1], contextWindow: Number(ctx[1]) });
  }
  if (entries.size === 0) die(`no OFFICIAL_MODELS rows parsed from ${file}`);
  return entries;
}

/** DSH plugin: CATALOG rows are `{ id: '...', name: '...', contextWindow: N, ... }`. */
function parseDshCatalog(repo: string): Map<string, ModelEntry> {
  const file = path.join(repo, "src/catalog/data.ts");
  if (!fs.existsSync(file)) die(`DSH catalog not found: ${file}`);
  const source = fs.readFileSync(file, "utf8");
  const start = source.indexOf("export const CATALOG");
  if (start < 0) die(`cannot locate CATALOG in ${file}`);
  const block = source.slice(start);

  const entries = new Map<string, ModelEntry>();
  for (const line of block.split("\n")) {
    if (!/^\s*\{\s*id:/.test(line)) continue;
    const id = /id:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(line);
    const name = /name:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(line);
    const ctx = /contextWindow:\s*(\d+)/.exec(line);
    if (!id || !name || !ctx) die(`malformed CATALOG row: ${line.trim()}`);
    entries.set(id[2], { id: id[2], name: name[2], contextWindow: Number(ctx[1]) });
  }
  if (entries.size === 0) die(`no CATALOG rows parsed from ${file}`);
  return entries;
}

/** VS Code extension capabilities: VISION_SET, EFFORTS_MAP and PROTOCOL_MAP in src/constants.ts. */
function parseVsceCapabilities(repo: string): Map<string, Capability> {
  const source = fs.readFileSync(path.join(repo, "src/constants.ts"), "utf8");
  const block = (name: string, next: string): string => {
    const start = source.indexOf(name);
    const end = source.indexOf(next, start + name.length);
    if (start < 0 || end < 0) die(`cannot locate ${name} in ${repo}/src/constants.ts`);
    return source.slice(start, end);
  };

  const vision = new Set([...block("const VISION_SET", "const EFFORTS_MAP").matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]));
  const efforts = new Map(
    [...block("const EFFORTS_MAP", "const PROTOCOL_MAP").matchAll(/^\s*\["([^"]+)",\s*\[([^\]]*)\]\]/gm)].map((m) => [
      m[1],
      m[2]
        .split(",")
        .map((s) => s.trim().replace(/"/g, ""))
        .filter(Boolean)
        .sort(),
    ]),
  );
  const protocol = new Map([...block("const PROTOCOL_MAP", "const vision =").matchAll(/^\s*\["([^"]+)",\s*"([^"]+)"\]/gm)].map((m) => [m[1], m[2]]));

  const ids = new Set([...vision, ...efforts.keys(), ...protocol.keys()]);
  return new Map(
    [...ids].map((id) => [
      id,
      { vision: vision.has(id), efforts: efforts.get(id) ?? [], protocol: protocol.get(id) ?? "openai" } satisfies Capability,
    ]),
  );
}

/** DSH plugin: capabilities implied by `modalities`, `efforts` and `protocol` on each CATALOG row. */
function parseDshCapabilities(repo: string): Map<string, Capability> {
  const source = fs.readFileSync(path.join(repo, "src/catalog/data.ts"), "utf8");
  const block = source.slice(source.indexOf("export const CATALOG"));

  const entries = new Map<string, Capability>();
  for (const line of block.split("\n")) {
    if (!/^\s*\{\s*id:/.test(line)) continue;
    const id = /id:\s*'([^']+)'/.exec(line);
    if (!id) die(`malformed CATALOG row: ${line.trim()}`);
    const modalities = /modalities:\s*\[([^\]]*)\]/.exec(line)?.[1] ?? "";
    const efforts = /efforts:\s*\[([^\]]*)\]/.exec(line)?.[1] ?? "";
    entries.set(id[1], {
      vision: modalities.includes("image"),
      efforts: efforts
        .split(",")
        .map((s) => s.trim().replace(/'/g, ""))
        .filter(Boolean)
        .sort(),
      protocol: /protocol:\s*'([^']+)'/.exec(line)?.[1] ?? "openai",
    });
  }
  return entries;
}

/** The extension derives its tables from the DSH CATALOG; surface any divergence in either direction. */
function compareCapabilities(vscode: Map<string, Capability>, dsh: Map<string, Capability>): ModelDiff[] {
  const diffs: ModelDiff[] = [];
  for (const id of new Set([...vscode.keys(), ...dsh.keys()])) {
    const vs = vscode.get(id);
    const ds = dsh.get(id);
    if (!vs || !ds) {
      const side = vs ? "DSH CATALOG" : "VS Code tables";
      diffs.push({ id, changed: [`missing from ${side}`] });
      continue;
    }
    const changed: string[] = [];
    if (vs.vision !== ds.vision) changed.push(`vision vsce=${vs.vision} dsh=${ds.vision}`);
    if (vs.protocol !== ds.protocol) changed.push(`protocol vsce=${vs.protocol} dsh=${ds.protocol}`);
    if (vs.efforts.join(",") !== ds.efforts.join(",")) {
      changed.push(`efforts vsce=[${vs.efforts.join(",")}] dsh=[${ds.efforts.join(",")}]`);
    }
    if (changed.length > 0) diffs.push({ id, changed });
  }
  return diffs;
}

function gitVersion(repo: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as { version?: string };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function compare(
  live: ApiModel[],
  vscode: Map<string, ModelEntry>,
  dsh: Map<string, ModelEntry>,
): Pick<Report, "newModels" | "removedModels" | "changedModels" | "missingFromDsh"> {
  const liveById = new Map(live.map((m) => [m.id, m]));
  const newModels: ModelDiff[] = [];
  const changedModels: ModelDiff[] = [];
  const missingFromDsh: ModelDiff[] = [];

  for (const [id, api] of liveById) {
    const vs = vscode.get(id);
    const ds = dsh.get(id);
    if (!vs) {
      newModels.push({ id, name: api.name, contextWindow: api.context_length, dsh: ds, changed: [] });
      continue;
    }
    const changed: string[] = [];
    const side = (label: string, entry: ModelEntry) => {
      if (typeof api.context_length === "number" && api.context_length > 0 && api.context_length !== entry.contextWindow) {
        changed.push(`${label} contextWindow ${entry.contextWindow} → ${api.context_length}`);
      }
      if (api.name && api.name !== entry.name) changed.push(`${label} name "${entry.name}" → "${api.name}"`);
    };
    side("VS Code", vs);
    if (ds) side("DSH", ds);
    if (changed.length > 0) changedModels.push({ id, vscode: vs, dsh: ds, changed });
    else if (!ds) missingFromDsh.push({ id, vscode: vs, changed: ["present in VS Code catalog, absent from DSH CATALOG"] });
  }

  const removedModels: ModelDiff[] = [];
  for (const [id, vs] of vscode) {
    if (!liveById.has(id)) removedModels.push({ id, name: vs.name, contextWindow: vs.contextWindow, vscode: vs, dsh: dsh.get(id), changed: [] });
  }

  return { newModels, removedModels, changedModels, missingFromDsh };
}

function writeText(report: Report): void {
  const line = "─".repeat(72);
  if (report.apiError) {
    console.log(`❌ live API unreachable: ${report.apiError}`);
  } else {
    console.log(`✅ live API: ${report.apiCount} models — ${API_URL}`);
  }
  console.log(`   VS Code catalog: ${report.vscode.count ?? "?"} models (v${report.vscode.version ?? "?"}) ${report.vscode.path}`);
  console.log(`   DSH catalog:     ${report.dsh.count ?? "?"} models (v${report.dsh.version ?? "?"}) ${report.dsh.path}`);

  if (!report.drift) {
    console.log("✅ no catalog drift");
    return;
  }

  console.log(line);
  console.log("DRIFT DETECTED");
  console.log(line);

  const section = (title: string, items: ModelDiff[], render: (m: ModelDiff) => string) => {
    if (items.length === 0) return;
    console.log(`\n${title} (${items.length})`);
    for (const item of items) console.log(`  - ${render(item)}`);
  };

  section("NEW — in live API, missing from both catalogs", report.newModels, (m) => `${m.id}  "${m.name}"  ctx=${m.contextWindow}`);
  section("CHANGED — metadata differs from live API", report.changedModels, (m) => `${m.id}  ${m.changed.join("; ")}`);
  section("MISSING FROM DSH — VS Code only", report.missingFromDsh, (m) => `${m.id}  ${m.changed.join("; ")}`);
  section("REMOVED — in VS Code catalog, no longer served by API", report.removedModels, (m) => `${m.id}  "${m.name}"`);
  section("CAPABILITY — VS Code tables differ from the DSH CATALOG", report.capabilityModels, (m) => `${m.id}  ${m.changed.join("; ")}`);

  console.log(`\n${line}`);
  console.log("Next: follow docs/model-sync.md to update both catalogs and publish.");
}

const live = await fetchLiveModels().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return { error: message } as const;
});

const report: Report = {
  ok: !("error" in live),
  apiCount: "error" in live ? 0 : live.length,
  apiError: "error" in live ? live.error : undefined,
  vscode: { path: VSCE_REPO, count: null, version: gitVersion(VSCE_REPO) },
  dsh: { path: DSH_REPO, count: null, version: gitVersion(DSH_REPO) },
  newModels: [],
  removedModels: [],
  changedModels: [],
  missingFromDsh: [],
  capabilityModels: [],
  drift: false,
};

if (!report.ok) {
  // A dead API is not catalog drift: report it and exit 1 so the timer logs an error
  // instead of waking an agent that would only be able to conclude "API unreachable".
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  else writeText(report);
  process.exit(1);
}

const vscode = parseVsceCatalog(VSCE_REPO);
const dsh = parseDshCatalog(DSH_REPO);
report.vscode.count = vscode.size;
report.dsh.count = dsh.size;

const capabilities = compareCapabilities(parseVsceCapabilities(VSCE_REPO), parseDshCapabilities(DSH_REPO));
Object.assign(report, compare(live, vscode, dsh));
report.capabilityModels = capabilities.filter((m) => !report.newModels.some((n) => n.id === m.id));
report.drift =
  report.newModels.length > 0 ||
  report.changedModels.length > 0 ||
  report.missingFromDsh.length > 0 ||
  report.removedModels.length > 0 ||
  report.capabilityModels.length > 0;

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else writeText(report);
process.exit(report.drift ? 2 : 0);

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
 *   node scripts/check-live-models.ts            # human-readable report
 *   node scripts/check-live-models.ts --json     # machine-readable report
 *   node scripts/check-live-models.ts --repo <path>   # override sibling repo location
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
    if (typeof api.context_length === "number" && api.context_length > 0 && api.context_length !== vs.contextWindow) {
      changed.push(`contextWindow ${vs.contextWindow} → ${api.context_length}`);
    }
    if (api.name && api.name !== vs.name) changed.push(`name "${vs.name}" → "${api.name}"`);
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

Object.assign(report, compare(live, vscode, dsh));
report.drift =
  report.newModels.length > 0 ||
  report.changedModels.length > 0 ||
  report.missingFromDsh.length > 0 ||
  report.removedModels.length > 0;

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else writeText(report);
process.exit(report.drift ? 2 : 0);

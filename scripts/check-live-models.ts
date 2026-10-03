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
 *   2  drift detected (new / removed / renamed / retuned models, or thinking efforts
 *      not backed by evidence — see scripts/effort-evidence.ts) — agent run warranted
 *   1  internal error (API unreachable, catalog unreadable, malformed entry)
 *
 * Usage:
 *   bun run check:models                       # human-readable report
 *   bun run check:models --json                # machine-readable report
 *   bun run check:models --repo <path>         # override sibling repo location
 */
import fs from "node:fs";
import path from "node:path";
import {
  compare,
  compareCapabilities,
  parseDshCapabilities,
  parseDshCatalog,
  parseVsceCapabilities,
  parseVsceCatalog,
  type ApiModel,
  type ModelDiff,
} from "./model-catalog";
import {
  compareEfforts,
  findPiDataDir,
  loadDecisions,
  loadPiData,
  type EffortDiff,
} from "./effort-evidence";

const API_URL = "https://api.commandcode.ai/provider/v1/models";
const DEFAULT_DSH_REPO = path.join(
  process.env.HOME ?? "/home/pi",
  "projects/commandcode-goat-dsh-provider",
);
const VSCE_REPO = process.cwd();
const VSCE_FILE = path.join(VSCE_REPO, "src/constants.ts");
const DECISIONS_FILE = path.join(VSCE_REPO, "docs/effort-decisions.json");

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");
const repoIdx = argv.indexOf("--repo");
const DSH_REPO =
  repoIdx >= 0 && argv[repoIdx + 1] ? path.resolve(argv[repoIdx + 1]) : DEFAULT_DSH_REPO;
const DSH_FILE = path.join(DSH_REPO, "src/catalog/data.ts");

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
  effortMismatched: EffortDiff[];
  effortUnverified: EffortDiff[];
  effortError?: string;
  drift: boolean;
}

function die(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function readCatalog(file: string, label: string): string {
  if (!fs.existsSync(file)) die(`${label} not found: ${file}`);
  return fs.readFileSync(file, "utf8");
}

/** The parsers in ./model-catalog throw; this script reports one line and exits 1. */
function parseOrDie<T>(file: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    die(`${error instanceof Error ? error.message : String(error)} in ${file}`);
  }
}

async function fetchLiveModels(): Promise<ApiModel[]> {
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${API_URL}`);
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) throw new Error(`unexpected payload shape from ${API_URL}`);
  return body.data as ApiModel[];
}

function gitVersion(repo: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version;
  } catch {
    return undefined;
  }
}

function writeText(report: Report): void {
  const line = "─".repeat(72);
  if (report.apiError) {
    console.log(`❌ live API unreachable: ${report.apiError}`);
  } else {
    console.log(`✅ live API: ${report.apiCount} models — ${API_URL}`);
  }
  console.log(
    `   VS Code catalog: ${report.vscode.count ?? "?"} models (v${report.vscode.version ?? "?"}) ${report.vscode.path}`,
  );
  console.log(
    report.dsh.error
      ? `   DSH catalog:     ⚠️  ${report.dsh.error} (${report.dsh.path})`
      : `   DSH catalog:     ${report.dsh.count ?? "?"} models (v${report.dsh.version ?? "?"}) ${report.dsh.path}`,
  );

  if (report.effortError) console.log(`⚠️  effort check skipped: ${report.effortError}`);
  if (!report.drift) {
    console.log("✅ no catalog drift");
    return;
  }

  console.log(line);
  console.log("DRIFT DETECTED");
  console.log(line);

  const section = <T>(title: string, items: T[], render: (m: T) => string) => {
    if (items.length === 0) return;
    console.log(`\n${title} (${items.length})`);
    for (const item of items) console.log(`  - ${render(item)}`);
  };

  section(
    "NEW — in live API, missing from both catalogs",
    report.newModels,
    (m) => `${m.id}  "${m.name}"  ctx=${m.contextWindow}`,
  );
  section(
    "CHANGED — metadata differs from live API",
    report.changedModels,
    (m) => `${m.id}  ${m.changed.join("; ")}`,
  );
  section(
    "MISSING FROM DSH — VS Code only",
    report.missingFromDsh,
    (m) => `${m.id}  ${m.changed.join("; ")}`,
  );
  section(
    "REMOVED — in VS Code catalog, no longer served by API",
    report.removedModels,
    (m) => `${m.id}  "${m.name}"`,
  );
  section(
    "CAPABILITY — VS Code tables differ from the DSH CATALOG",
    report.capabilityModels,
    (m) => `${m.id}  ${m.changed.join("; ")}`,
  );
  const effortLine = (m: EffortDiff) =>
    `${m.id}  catalog=[${m.catalog.join(",")}] evidence=[${m.evidence.efforts.join(",")}] (${m.evidence.strength}: ${m.evidence.source})`;
  section(
    "EFFORTS MISMATCH — DSH CATALOG disagrees with a recorded decision or explicit pi-ai map",
    report.effortMismatched,
    effortLine,
  );
  section(
    "EFFORTS UNVERIFIED — no decision and no explicit pi-ai map; research, then record a decision",
    report.effortUnverified,
    effortLine,
  );

  console.log(`\n${line}`);
  console.log("Next: follow docs/model-sync.md to update the catalog and publish.");
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
  effortMismatched: [],
  effortUnverified: [],
  drift: false,
};

// Same test as `!report.ok`, but spelled on `live` so control-flow analysis narrows it
// back to ApiModel[] past the never-returning exit below.
if ("error" in live) {
  // A dead API is not catalog drift: report it and exit 1 so the timer logs an error
  // instead of waking an agent that would only be able to conclude "API unreachable".
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
  else writeText(report);
  process.exit(1);
}

const vsceSource = readCatalog(VSCE_FILE, "VS Code catalog");
// The DSH plugin repo is retired (2026-10-03): its CATALOG is still the upstream truth while
// the checkout exists, but a missing one must not stop the gate — that would silently disable
// the daily auto-update. Without it, the VS Code tables are the only catalog and the DSH
// cross-checks (capabilities, missingFromDsh, DSH-side metadata) are skipped with a warning.
const dshSource = fs.existsSync(DSH_FILE) ? readCatalog(DSH_FILE, "DSH catalog") : undefined;

const vscode = parseOrDie(VSCE_FILE, () => parseVsceCatalog(vsceSource));
const dsh = dshSource ? parseOrDie(DSH_FILE, () => parseDshCatalog(dshSource)) : new Map();
report.vscode.count = vscode.size;
report.dsh.count = dshSource ? dsh.size : null;
if (!dshSource) report.dsh.error = "catalog not found (DSH retired?) — DSH cross-checks skipped";

let capabilities: ModelDiff[] = [];
const vsceCapabilities = parseOrDie(VSCE_FILE, () => parseVsceCapabilities(vsceSource));
const dshCapabilities = dshSource
  ? parseOrDie(DSH_FILE, () => parseDshCapabilities(dshSource))
  : undefined;
if (dshCapabilities) capabilities = compareCapabilities(vsceCapabilities, dshCapabilities);

// A missing Pi install only disables this section; it must not hide the rest of the gate.
const piDataDir = findPiDataDir();
if (piDataDir) {
  // Without the DSH catalog the extension's own tables are the catalog side of the effort check:
  // it still proves every ladder is backed by a decision or an explicit pi-ai map, it just cannot
  // cross-check the ladders against DSH any more.
  const decisions = parseOrDie(DECISIONS_FILE, () => loadDecisions(DECISIONS_FILE));
  const efforts = compareEfforts(
    dshCapabilities ?? vsceCapabilities,
    loadPiData(piDataDir),
    decisions,
  );
  report.effortMismatched = efforts.mismatched;
  report.effortUnverified = efforts.unverified;
} else {
  report.effortError = "pi-ai provider data not found (install Pi or set PI_AI_DATA_DIR)";
}
Object.assign(report, compare(live, vscode, dsh, { crossCheckDsh: Boolean(dshSource) }));
report.capabilityModels = capabilities.filter((m) => !report.newModels.some((n) => n.id === m.id));
report.drift =
  report.newModels.length > 0 ||
  report.changedModels.length > 0 ||
  report.missingFromDsh.length > 0 ||
  report.removedModels.length > 0 ||
  report.capabilityModels.length > 0 ||
  report.effortMismatched.length > 0 ||
  report.effortUnverified.length > 0;

if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else writeText(report);
process.exit(report.drift ? 2 : 0);

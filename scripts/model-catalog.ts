/**
 * Pure parsing of the two catalogs the model-drift gate keeps in sync.
 *
 * Split out of check-live-models.ts so the regexes can be exercised with literal
 * text instead of a repo on disk: everything here takes source text and throws on
 * malformed input, and the caller decides how to report it (check-live-models.ts
 * turns a throw into `die()`). Nothing here touches fs, network or process.
 */

export interface ApiModel {
  id: string;
  name?: string;
  context_length?: number;
}

export interface ModelEntry {
  id: string;
  name: string;
  contextWindow: number;
}

/** Vision / thinking / wire-protocol facts, kept identical across the two catalogs. */
export interface Capability {
  vision: boolean;
  efforts: string[];
  protocol: string;
}

export interface ModelDiff {
  id: string;
  name?: string;
  contextWindow?: number;
  vscode?: ModelEntry;
  dsh?: ModelEntry;
  changed: string[];
}

export interface CatalogComparison {
  newModels: ModelDiff[];
  removedModels: ModelDiff[];
  changedModels: ModelDiff[];
  missingFromDsh: ModelDiff[];
}

/** VS Code extension: OFFICIAL_MODELS rows are `["<id>", "<name>", <context>],`. */
export function parseVsceCatalog(source: string): Map<string, ModelEntry> {
  const start = source.indexOf("const OFFICIAL_MODELS");
  const end = source.indexOf("const VISION_SET");
  if (start < 0 || end < 0 || end < start) throw new Error("cannot locate OFFICIAL_MODELS block");
  const block = source.slice(start, end);

  const entries = new Map<string, ModelEntry>();
  for (const line of block.split("\n")) {
    const id = /^\s*\[\s*"([^"]+)"/.exec(line);
    if (!id) {
      // Every other line in the block (the declaration, the closing bracket, blank
      // lines, comments) does not open a row. One that does and still fails to read
      // means a row was split or reshaped: skipping it like the rest would shrink the
      // catalog instead of failing the gate the way a one-line malformed row does.
      if (line.trim().startsWith("[")) {
        throw new Error(`malformed OFFICIAL_MODELS row: ${line.trim()}`);
      }
      continue;
    }
    const name = /^\s*\[\s*"[^"]+"\s*,\s*"([^"]*)"/.exec(line);
    const ctx = /^\s*\[\s*"[^"]+"\s*,\s*"[^"]*"\s*,\s*(\d+)\s*\]/.exec(line);
    if (!name || !ctx) throw new Error(`malformed OFFICIAL_MODELS row: ${line.trim()}`);
    entries.set(id[1], { id: id[1], name: name[1], contextWindow: Number(ctx[1]) });
  }
  if (entries.size === 0) throw new Error("no OFFICIAL_MODELS rows parsed");
  return entries;
}

/**
 * Slice out the CATALOG literal, from its declaration to its own closing bracket.
 *
 * The close (`]`, `] as const`, `];`) is the only line that both opens with `]` and
 * holds nothing after it -- a bracket closed inside a row is indented and/or trailed
 * by a comma -- so cutting here keeps the guards below inside the catalog instead of
 * over the helpers that follow the literal. With no recognisable close the rest of
 * the file is scanned, the way it was before, rather than dropping rows silently.
 */
function dshCatalogBlock(source: string): string {
  const start = source.indexOf("export const CATALOG");
  if (start < 0) throw new Error("cannot locate CATALOG");
  const close = /^\]\s*(?:as const)?\s*;?\s*$/m.exec(source.slice(start));
  return close ? source.slice(start, start + close.index) : source.slice(start);
}

/** DSH plugin: CATALOG rows are `{ id: '...', name: '...', contextWindow: N, ... }`. */
export function parseDshCatalog(source: string): Map<string, ModelEntry> {
  const block = dshCatalogBlock(source);

  const entries = new Map<string, ModelEntry>();
  for (const line of block.split("\n")) {
    if (!/^\s*\{\s*id:/.test(line)) {
      // Every other line in the block (the declaration, the closing bracket, blanks
      // and comments) does not open a row. One that does and still fails to read means
      // a row was split or reshaped: skipping it like the rest would shrink the
      // catalog instead of failing the gate the way a one-line malformed row does.
      if (line.trim().startsWith("{")) {
        throw new Error(`malformed CATALOG row: ${line.trim()}`);
      }
      continue;
    }
    const id = /id:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(line);
    const name = /name:\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(line);
    const ctx = /contextWindow:\s*(\d+)/.exec(line);
    if (!id || !name || !ctx) throw new Error(`malformed CATALOG row: ${line.trim()}`);
    entries.set(id[2], { id: id[2], name: name[2], contextWindow: Number(ctx[1]) });
  }
  if (entries.size === 0) throw new Error("no CATALOG rows parsed");
  return entries;
}

/** VS Code extension capabilities: VISION_SET, EFFORTS_MAP and PROTOCOL_MAP in src/constants.ts. */
export function parseVsceCapabilities(source: string): Map<string, Capability> {
  const block = (name: string, next: string): string => {
    const start = source.indexOf(name);
    const end = source.indexOf(next, start + name.length);
    if (start < 0 || end < 0) throw new Error(`cannot locate ${name}`);
    return source.slice(start, end);
  };

  const vision = new Set(
    [...block("const VISION_SET", "const EFFORTS_MAP").matchAll(/^\s*"([^"]+)",/gm)].map(
      (m) => m[1],
    ),
  );
  const efforts = new Map(
    [
      ...block("const EFFORTS_MAP", "const PROTOCOL_MAP").matchAll(
        /^\s*\["([^"]+)",\s*\[([^\]]*)\]\]/gm,
      ),
    ].map((m) => [
      m[1],
      m[2]
        .split(",")
        .map((s) => s.trim().replace(/"/g, ""))
        .filter(Boolean)
        .sort(),
    ]),
  );
  const protocol = new Map(
    [
      ...block("const PROTOCOL_MAP", "const vision =").matchAll(/^\s*\["([^"]+)",\s*"([^"]+)"\]/gm),
    ].map((m) => [m[1], m[2]]),
  );

  const ids = new Set([...vision, ...efforts.keys(), ...protocol.keys()]);
  return new Map(
    [...ids].map((id) => [
      id,
      {
        vision: vision.has(id),
        efforts: efforts.get(id) ?? [],
        protocol: protocol.get(id) ?? "openai",
      } satisfies Capability,
    ]),
  );
}

/** DSH plugin: capabilities implied by `modalities`, `efforts` and `protocol` on each CATALOG row. */
export function parseDshCapabilities(source: string): Map<string, Capability> {
  const block = dshCatalogBlock(source);

  const entries = new Map<string, Capability>();
  for (const line of block.split("\n")) {
    if (!/^\s*\{\s*id:/.test(line)) {
      // Same guard as parseDshCatalog: a line that opens a row but cannot be read is
      // a split row, not filler, and skipping it would hide the capabilities of a
      // model the catalog still ships.
      if (line.trim().startsWith("{")) {
        throw new Error(`malformed CATALOG row: ${line.trim()}`);
      }
      continue;
    }
    const id = /id:\s*'([^']+)'/.exec(line);
    if (!id) throw new Error(`malformed CATALOG row: ${line.trim()}`);
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
export function compareCapabilities(
  vscode: Map<string, Capability>,
  dsh: Map<string, Capability>,
): ModelDiff[] {
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
    if (vs.protocol !== ds.protocol)
      changed.push(`protocol vsce=${vs.protocol} dsh=${ds.protocol}`);
    if (vs.efforts.join(",") !== ds.efforts.join(",")) {
      changed.push(`efforts vsce=[${vs.efforts.join(",")}] dsh=[${ds.efforts.join(",")}]`);
    }
    if (changed.length > 0) diffs.push({ id, changed });
  }
  return diffs;
}

export function compare(
  live: ApiModel[],
  vscode: Map<string, ModelEntry>,
  dsh: Map<string, ModelEntry>,
): CatalogComparison {
  const liveById = new Map(live.map((m) => [m.id, m]));
  const newModels: ModelDiff[] = [];
  const changedModels: ModelDiff[] = [];
  const missingFromDsh: ModelDiff[] = [];

  for (const [id, api] of liveById) {
    const vs = vscode.get(id);
    const ds = dsh.get(id);
    if (!vs) {
      newModels.push({
        id,
        name: api.name,
        contextWindow: api.context_length,
        dsh: ds,
        changed: [],
      });
      continue;
    }
    const changed: string[] = [];
    const side = (label: string, entry: ModelEntry) => {
      if (
        typeof api.context_length === "number" &&
        api.context_length > 0 &&
        api.context_length !== entry.contextWindow
      ) {
        changed.push(`${label} contextWindow ${entry.contextWindow} → ${api.context_length}`);
      }
      if (api.name && api.name !== entry.name)
        changed.push(`${label} name "${entry.name}" → "${api.name}"`);
    };
    side("VS Code", vs);
    if (ds) side("DSH", ds);
    if (changed.length > 0) changedModels.push({ id, vscode: vs, dsh: ds, changed });
    else if (!ds)
      missingFromDsh.push({
        id,
        vscode: vs,
        changed: ["present in VS Code catalog, absent from DSH CATALOG"],
      });
  }

  const removedModels: ModelDiff[] = [];
  for (const [id, vs] of vscode) {
    if (!liveById.has(id))
      removedModels.push({
        id,
        name: vs.name,
        contextWindow: vs.contextWindow,
        vscode: vs,
        dsh: dsh.get(id),
        changed: [],
      });
  }

  return { newModels, removedModels, changedModels, missingFromDsh };
}

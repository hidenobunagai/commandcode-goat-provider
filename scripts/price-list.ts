/**
 * Pure parsing of the published price list, plus the price-drift comparison.
 *
 * The live provider API (`/provider/v1/models`) publishes no pricing at all, so the
 * only machine-readable source is the marketing site's model table. This module takes
 * that HTML as text and returns prices keyed by the page's own model slug; nothing here
 * touches fs, network or process, so the parser can be exercised with a literal fixture.
 *
 * Split from check-live-models.ts for the same reason as `model-catalog.ts`: the caller
 * decides how a throw is reported.
 */
import { dshCatalogBlock } from "./model-catalog";

/** One published price. `'Free'` is a real listing, not a missing value. */
export type Price = number | "Free";

export interface PagePrice {
  /** Slug from the row's `<a href="/models/...">`. */
  slug: string;
  /** Display name as the page writes it. */
  name: string;
  input: Price;
  output: Price;
  /** `-50%` when an active deal badge is present, else undefined. */
  discount?: string;
}

/**
 * One price disagreement between the catalogs and the published table.
 *
 * `side` names which catalog holds the stale figure: both catalogs must be updated, but
 * the DSH `CATALOG` is the upstream one, so the two are reported separately rather than
 * collapsed into a single row a reader would have to unpack.
 */
export interface PriceDiff {
  id: string;
  /** How the row was matched to the page: by id slug, or by display name. */
  matchedBy: "id" | "name";
  side: "DSH" | "VS Code";
  /** `$0.20→$1.20` / `Free`, rendered for the report. */
  catalog: string;
  published: string;
  changed: string[];
}

/** A catalog row's own price fields, as the two parsers read them. */
export interface CatalogPrice {
  input?: Price;
  output?: Price;
  discount?: string;
}

/** Render a price pair the way the picker and the report spell it. */
export function formatPriceRange(input?: Price, output?: Price): string {
  if (input === undefined && output === undefined) return "unpriced";
  if (input === "Free") return "Free";
  return `${formatPrice(input)}→${formatPrice(output)}`;
}

/** `$0.20` / `Free`; `?` marks a field the catalog has not filled in yet. */
export function formatPrice(price?: Price): string {
  if (price === undefined) return "?";
  return price === "Free" ? "Free" : `$${price}`;
}

/** `$0.20` / `Free`; distinguishes a real zero from an absent figure. */
function readPrice(text: string): Price | undefined {
  // The first price token, not the whole cell: a data cell trails a `+1` note when the
  // model has several context price bands, and a header cell holds its label plus a
  // sort arrow. Both are decorations around the figure.
  const free = /(^|[^A-Za-z])free([^A-Za-z]|$)/i.exec(text);
  const amount = /\$([0-9]+(?:\.[0-9]+)?)/.exec(text);
  if (amount) return Number(amount[1]);
  if (free) return "Free";
  return undefined;
}

/** Plain cell text, entities decoded. Keeps text that sits inside nested elements. */
function cellText(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Text of a price cell with the one decoration that would corrupt the figure removed.
 *
 * `<s>…</s>` is the struck-through pre-discount original, so a naive read of
 * `$0.60 $0.30` yields the stale half. The leftover `+1` band note needs no removal:
 * `readPrice` takes the first price token.
 */
function priceCellText(cell: string): string {
  return cellText(cell.replace(/<s\b[\s\S]*?<\/s>/g, " "));
}

/**
 * Parse the marketing site's model table.
 *
 * Only the first table is read: the page carries one, and taking the first keeps a later
 * pricing-example table (the limits page has several) from being mistaken for the catalog.
 * @param html - page source.
 * @returns prices keyed by slug.
 * @throws when the table or its columns cannot be located, so a reshaped page fails the
 * gate instead of silently reporting "no drift" forever.
 */
export function parsePublishedPrices(html: string): Map<string, PagePrice> {
  const table = /<table[\s\S]*?<\/table>/.exec(html);
  if (!table) throw new Error("cannot locate the model price table");
  const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  if (rows.length < 2) throw new Error("model price table has no data rows");

  // Locate the columns by header rather than by index: the table is a marketing page and
  // a column may be added on either side, which would silently shift a positional read.
  const headers = [...rows[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) =>
    cellText(m[1]).replace(/[↕⇅]/g, "").trim().toLowerCase(),
  );
  const col = (name: string): number => {
    const i = headers.indexOf(name);
    if (i < 0)
      throw new Error(`model price table has no "${name}" column (found: ${headers.join(", ")})`);
    return i;
  };
  const inCol = col("input");
  const outCol = col("output");

  const prices = new Map<string, PagePrice>();
  for (const row of rows.slice(1)) {
    const cells = [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((m) => m[1]);
    if (cells.length === 0) continue;
    const link = /<a[^>]*href="\/models\/([a-z0-9.-]+)"[^>]*>([\s\S]*?)<\/a>/.exec(cells[0]);
    if (!link) continue;
    const input = readPrice(priceCellText(cells[inCol]));
    const output = readPrice(priceCellText(cells[outCol]));
    if (input === undefined || output === undefined) {
      throw new Error(
        `unreadable price for ${link[1]}: ${priceCellText(cells[inCol])} / ${priceCellText(cells[outCol])}`,
      );
    }
    // The deal badge is an aria-label on the name cell: "50% off — view deal details".
    const badge = /\b(\d+)% off\b/.exec(cells[0]);
    prices.set(link[1], {
      slug: link[1],
      name: cellText(link[2]),
      input,
      output,
      ...(badge ? { discount: `-${badge[1]}%` } : {}),
    });
  }
  if (prices.size === 0) throw new Error("no model price rows parsed");
  return prices;
}

/**
 * Slug for a model id or display name, matching the page's own slug shape
 * (`deepseek/deepseek-v4.1-flash` → `deepseek-v4-1-flash`, `Cat Jam` → `cat-jam`).
 * @param text - model id or display name.
 * @returns the slug.
 */
export function priceSlug(text: string): string {
  const tail = text.split("/").pop() ?? text;
  return (
    tail
      .replace(/:/g, "-")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      // A dated snapshot id (`claude-haiku-4-5-20251001`) addresses the same listing as its
      // undated name, so the trailing stamp is dropped rather than reported as a missing row.
      .replace(/-\d{8}$/, "")
  );
}

/**
 * Resolve one catalog row's price against the published table.
 * @param published - parsed page prices.
 * @param id - catalog model id.
 * @param name - catalog display name.
 * @returns the page row and how it matched, or undefined when the page lists neither.
 */
export function findPublished(
  published: Map<string, PagePrice>,
  id: string,
  name: string,
): { price: PagePrice; matchedBy: "id" | "name" } | undefined {
  const byId = published.get(priceSlug(id));
  if (byId) return { price: byId, matchedBy: "id" };
  const byName = published.get(priceSlug(name));
  if (byName) return { price: byName, matchedBy: "name" };
  return undefined;
}

/** Compare one catalog's price against the published one. */
export function diffPrice(catalog: CatalogPrice, published: PagePrice): string[] {
  const changed: string[] = [];
  const same = (a?: Price, b?: Price) => a !== undefined && a === b;
  if (!same(catalog.input, published.input)) {
    changed.push(`input ${formatPrice(catalog.input)} → ${formatPrice(published.input)}`);
  }
  if (!same(catalog.output, published.output)) {
    changed.push(`output ${formatPrice(catalog.output)} → ${formatPrice(published.output)}`);
  }
  // A deal that started or ended moves a price even when the figure is unchanged (a -50%
  // listing expiring returns the row to its list rate), so the badge is compared too.
  if ((catalog.discount ?? "") !== (published.discount ?? "")) {
    changed.push(`discount ${catalog.discount ?? "none"} → ${published.discount ?? "none"}`);
  }
  return changed;
}

/**
 * Read the price fields of every DSH `CATALOG` row.
 *
 * A row may legitimately carry no price (the daily watch adds one as soon as the API
 * serves it, and that API publishes none), so a missing pair is not an error here; it
 * surfaces in the diff as `input ? → $0.20`, which is exactly the gap to fill.
 * @param source - `src/catalog/data.ts` text.
 * @returns price fields keyed by model id.
 * @throws when a row opens but cannot be read, matching the other parsers.
 */
export function parseDshCatalogPrices(source: string): Map<string, CatalogPrice> {
  const prices = new Map<string, CatalogPrice>();
  for (const line of dshCatalogBlock(source).split("\n")) {
    if (!/^\s*\{\s*id:/.test(line)) continue;
    const id = /id:\s*'([^']+)'/.exec(line);
    if (!id) throw new Error(`malformed CATALOG row: ${line.trim()}`);
    const read = (field: string): Price | undefined => {
      const m = new RegExp(`${field}:\\s*([^,}]+)`).exec(line);
      if (!m) return undefined;
      const raw = m[1].trim();
      if (raw === "'free'") return "Free";
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    };
    const discount = /discount:\s*'([^']+)'/.exec(line)?.[1];
    prices.set(id[1], {
      ...(read("inputPrice") !== undefined ? { input: read("inputPrice") } : {}),
      ...(read("outputPrice") !== undefined ? { output: read("outputPrice") } : {}),
      ...(discount ? { discount } : {}),
    });
  }
  if (prices.size === 0) throw new Error("no CATALOG price rows parsed");
  return prices;
}

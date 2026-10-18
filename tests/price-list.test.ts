/**
 * Regression tests for the published-price gate (scripts/price-list.ts).
 *
 * The price page is a marketing table, not an API: it carries strikethroughs,
 * "N bands" notes and time-of-day annotations that all look like prices to a naive
 * read. `tests/fixtures/price-page.html` is a slice of the real table holding one row
 * per shape, so these tests fail when the parser starts believing a decoration.
 */
import fs from "node:fs";
import path from "node:path";
import {
  diffPrice,
  findPublished,
  formatPriceRange,
  parseDshCatalogPrices,
  parsePublishedPrices,
  priceSlug,
  type PagePrice,
} from "../scripts/price-list";

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = fs.readFileSync(path.join(ROOT, "tests/fixtures/price-page.html"), "utf8");

const page = parsePublishedPrices(FIXTURE);

test("reads a plain row's input and output", () => {
  expect(page.get("muse-spark-open")).toEqual({
    slug: "muse-spark-open",
    name: "Muse Spark Open",
    input: 1.25,
    output: 4.25,
  });
});

test("reads Free as a listing rather than a missing price", () => {
  expect(page.get("beam-free")?.input).toBe("Free");
  expect(page.get("beam-free")?.output).toBe("Free");
});

test("takes the effective price, not the struck-through original", () => {
  // The row reads `<s>$0.60</s>$0.30`; reading the first figure would have the gate
  // rewrite the catalog to a price the model no longer costs.
  expect(page.get("minimax-m3")?.input).toBe(0.3);
  expect(page.get("minimax-m3")?.output).toBe(1.2);
});

test("ignores the context-band note that trails a price", () => {
  // `$0.20+1` must not read as `$0.20` plus something, nor as a missing price.
  expect(page.get("deepseek-v4-flash")?.input).toBe(0.15);
  expect(page.get("deepseek-v4-flash")?.output).toBe(0.6);
});

test("reads the deal badge as a discount in the catalog's own format", () => {
  expect(page.get("minimax-m3")?.discount).toBe("-50%");
  expect(page.get("mimo-v2-5-pro")?.discount).toBe("-99%");
  expect(page.get("muse-spark-open")?.discount).toBeUndefined();
});

test("keeps sub-cent prices exact", () => {
  // Jev is listed at $0.042/M; rounding to cents would misstate it by 20%.
  expect(page.get("muse-spark-open")?.output).toBe(4.25);
  expect(page.size).toBeGreaterThan(5);
});

describe("priceSlug", () => {
  test("folds a namespaced id the way the page writes it", () => {
    expect(priceSlug("deepseek/deepseek-v4.1-flash")).toBe("deepseek-v4-1-flash");
    expect(priceSlug("tencent/hy3-paid")).toBe("hy3-paid");
    expect(priceSlug("stealth/cat-jam:free")).toBe("cat-jam-free");
  });

  test("folds a display name", () => {
    expect(priceSlug("Cat Jam")).toBe("cat-jam");
    expect(priceSlug("Gemini 3.7 Flash")).toBe("gemini-3-7-flash");
  });

  test("drops a dated snapshot stamp", () => {
    // `claude-haiku-4-5-20251001` addresses the same listing as `claude-haiku-4-5`.
    expect(priceSlug("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });
});

describe("findPublished", () => {
  test("matches on the id slug first", () => {
    // `claude-haiku-4-5-20251001` folds to the page's `claude-haiku-4-5`, so the id
    // reaches the listing directly — no name fallback needed.
    const hit = findPublished(page, "claude-haiku-4-5-20251001", "Claude Haiku 4.5");
    expect(hit?.matchedBy).toBe("id");
    expect(hit?.price.input).toBe(1);
  });

  test("falls back to the display name when the id slug misses", () => {
    // The catalog id is `tencent/hy3-paid` but the page lists the row as `tencent-hy3`,
    // so only the display name reaches it. Without this fallback the row would be
    // reported "unlisted" and its price would never be checked again.
    expect(findPublished(page, "tencent/hy3-paid", "Tencent Hy3")?.matchedBy).toBe("name");
    expect(findPublished(page, "tencent/hy3-paid", "Tencent Hy3")?.price.input).toBe(0.14);
  });

  test("returns nothing for a model the page does not list", () => {
    expect(findPublished(page, "not-a-model", "Not A Model")).toBeUndefined();
  });
});

describe("diffPrice", () => {
  const published: PagePrice = { slug: "x", name: "X", input: 0.2, output: 1.2 };

  test("reports nothing when the pair matches", () => {
    expect(diffPrice({ input: 0.2, output: 1.2 }, published)).toEqual([]);
  });

  test("reports each side that moved, with both values", () => {
    expect(diffPrice({ input: 0.15, output: 0.9 }, published)).toEqual([
      "input $0.15 → $0.2",
      "output $0.9 → $1.2",
    ]);
  });

  test("treats an unpriced row as a gap to fill, not a match", () => {
    expect(diffPrice({}, published)).toEqual(["input ? → $0.2", "output ? → $1.2"]);
  });

  test("counts a free listing as a price", () => {
    expect(
      diffPrice({ input: "Free", output: "Free" }, { ...published, input: "Free", output: "Free" }),
    ).toEqual([]);
    expect(diffPrice({ input: "Free", output: "Free" }, published)).toEqual([
      "input Free → $0.2",
      "output Free → $1.2",
    ]);
  });

  test("reports a deal starting or ending even when the figure did not move", () => {
    // The -50% row above was retired: same numbers, different discount, and the gate
    // must still wake so the catalog drops its stale `-50%`.
    expect(
      diffPrice(
        { input: 1.5, output: 7.5, discount: "-50%" },
        { ...published, input: 1.5, output: 7.5 },
      ),
    ).toEqual(["discount -50% → none"]);
  });
});

describe("parsePublishedPrices guards", () => {
  test("fails loudly when the table is gone", () => {
    expect(() => parsePublishedPrices("<html><body>no table</body></html>")).toThrow(
      /cannot locate the model price table/,
    );
  });

  test("fails loudly when a column is renamed", () => {
    // A reshaped page must break the gate, not silently report "no drift" forever.
    const reshaped = FIXTURE.replace(/>Input</g, ">Cost<");
    expect(() => parsePublishedPrices(reshaped)).toThrow(/no "input" column/);
  });

  test("fails loudly on a price cell it cannot read", () => {
    const broken = FIXTURE.replace(/\$1\.25/, "on request");
    expect(() => parsePublishedPrices(broken)).toThrow(/unreadable price/);
  });
});

describe("parseDshCatalogPrices", () => {
  test("reads the price fields the DSH CATALOG ships", () => {
    const source = [
      "export const CATALOG: readonly CatalogEntry[] = [",
      "  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 1050000, inputPrice: 0.20, outputPrice: 1.20, latest: true },",
      "  { id: 'stealth/cat-jam:free', name: 'Cat Jam', contextWindow: 1000000, inputPrice: 'free', outputPrice: 'free' },",
      "  { id: 'brand-new', name: 'Brand New', contextWindow: 1000 },",
      "];",
    ].join("\n");

    expect([...parseDshCatalogPrices(source).entries()]).toEqual([
      ["gpt-5.6-luna", { input: 0.2, output: 1.2 }],
      ["stealth/cat-jam:free", { input: "Free", output: "Free" }],
      // No price yet: a real state the daily watch creates, not an error.
      ["brand-new", {}],
    ]);
  });

  test("reads a discount alongside the price", () => {
    const source = [
      "export const CATALOG: readonly CatalogEntry[] = [",
      "  { id: 'google/gemini-3.7-flash', name: 'Gemini 3.7 Flash', contextWindow: 1048576, inputPrice: 0.75, outputPrice: 3.75, discount: '-50%' },",
      "];",
    ].join("\n");

    expect(parseDshCatalogPrices(source).get("google/gemini-3.7-flash")).toEqual({
      input: 0.75,
      output: 3.75,
      discount: "-50%",
    });
  });

  test("fails loudly when no price row survives", () => {
    expect(() =>
      parseDshCatalogPrices("export const CATALOG: readonly CatalogEntry[] = [\n]\n"),
    ).toThrow(/no CATALOG price rows parsed/);
  });
});

describe("formatPriceRange", () => {
  test("spells a paid pair, a free listing and a missing price distinctly", () => {
    expect(formatPriceRange(0.2, 1.2)).toBe("$0.2→$1.2");
    expect(formatPriceRange("Free", "Free")).toBe("Free");
    expect(formatPriceRange(undefined, 1.2)).toBe("?→$1.2");
    expect(formatPriceRange()).toBe("unpriced");
  });
});

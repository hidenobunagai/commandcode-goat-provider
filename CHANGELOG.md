# Change Log

## [0.1.27] - 2026-09-24

### Added

- **Catalog gains Space Bunny Alpha** (`stealth/space-bunny-alpha`, "Space Bunny Alpha"), closing the NEW
  drift `check:models` flagged (live API 81 models vs 80 in each catalog). Capabilities curated from
  commandcode.ai, not guessed: context 1,000,000 straight from the API `context_length`; protocol `openai`
  (the id is not `claude-*` and the API advertises `/chat/completions` only); vision on — the pricing rows
  on commandcode.ai declare `caps: { text: true, vision: true, reasoning: true }`. `EFFORTS_MAP` is
  deliberately left empty: the site publishes `reasoning: true` but no effort ladder for this stealth
  preview, so the model ships without the Thinking UI rather than with an invented one. `FALLBACK_MODELS`
  pinned at 81; `docs/models.md` gains the row with the extension-derived 131,072 max output. Sibling DSH
  plugin `dsh-commandcode-goat-provider` 0.1.16 carries the fuller record: tier `free` / label `Free` /
  `inputPrice`-`outputPrice` `'free'` (the 100% `space-bunny-alpha-free` deal — $0.00/M in, out and cache
  reads while the stealth preview lasts), `maxTokens: 65536`, no `intelligence` ("not yet scored"), no
  `latest` flag.

### Fixed

- **`stepfun/Step-3.5-Flash` context window 1,000,000 → 262,144** in both catalogs, matching the live API
  (`context_length: 262144`). The static 1M value was stale; the API value is authoritative.

No other changes ride this release: `package.json` moves 0.1.26 → 0.1.27 so the tag matches the version the
Marketplace accepts, and `main` carried no unreleased commits when this was cut (HEAD was the `v0.1.26`
tag), so nothing else is folded in. The sibling plugin's 0.1.15 → 0.1.16 bump, by contrast, does fold two
idle-improvement commits already on its `main` — `refactor(usage): remove Go/GOAT failover entirely —
quota badge reads GOAT only` and `fix(badge): portal the quota panel with viewport clamping (mobile
left-clip)` — into the same release as its catalog change (this repo keeps such notes here; that repo has
no CHANGELOG, so its commit message carries them). Local gate before tagging:
`lint` (0 errors, 2 pre-existing `src/api.ts` any-warnings), `compile`, `test -- --runInBand`
(14 suites / 218 tests), `check-changelog`, and `check:models` clean (81 live / 81 VS Code / 81 DSH).

## [0.1.26] - 2026-09-24

Roll-up release: the first published version since v0.1.22. The three commits below had already
carried their own entries and bumped `package.json` through 0.1.23–0.1.25 on `main`, but were never
tagged, so nothing reached the Marketplace. This version folds all three into one tag; the detailed
per-commit notes stay in their sections below.

### Added

- **Muse Spark gets the Thinking Effort picker** (`3b680c0`, entry [0.1.23]): all five `meta/muse-spark-*`
  ids join `EFFORTS_MAP` with the five-rung ladder `low, medium, high, xhigh, max`, probed live against
  `/provider/v1/chat/completions` (every rung 200 with `reasoning_tokens` differentiating by effort;
  `minimal`/`ultra` rejected 400). Before this, `supportsThinking` was false and the extension silently
  dropped `reasoningEffort`.
- **Catalog gains the GPT-6 trio** (`37e18b7`, entry [0.1.25]): `gpt-6-astra` (Provider tier, $10/$50),
  `gpt-6-sol` (Pro, $2/$10) and `gpt-6-luna` (Go, $0.10/$0.50), all 1,050,000 context with vision on and
  the probed `low..max` ladder — closing the NEW drift `check:models` flagged (live 80 models vs 77 in
  each catalog). `tests/model-catalog.test.ts` pins `FALLBACK_MODELS` at 80; `docs/models.md` carries the
  three rows.

### Fixed

- **Contributor-tier Muse Spark loses the inert `max` rung** (`e601cdc`, entry [0.1.24]):
  `meta/muse-spark-1.2-contributor` / `-1.3-contributor` now declare `low, medium, high, xhigh`. Meta's
  docs reserve `max` for standard tier, and live probing confirmed the gateway clamps contributor `max`
  to `xhigh` (4 pairs, mean reasoning_tokens 1071 vs 1086) — the rung answered 200 but did nothing, so
  offering it advertised a dead knob. Standard-tier ids (`1.1`/`1.2`/`1.3`) keep `max`.

No other changes ride this release: `package.json` moves 0.1.25 → 0.1.26 purely so the tag matches the
version the Marketplace accepts. Local gate before tagging: `bun install --frozen-lockfile`, `lint`
(0 errors), `compile`, `test -- --runInBand` (14 suites / 218 tests).

## [0.1.25] - 2026-09-23

### Added

- **Catalog sync: the GPT-6 trio joins both catalogs** (`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`), closing the NEW drift `check:models` had been flagging (live API 80 models vs 77 in each catalog).
  - All three: context 1,050,000 (API `context_length`), protocol `openai` (`supported_endpoints: ["/chat/completions", "/responses"]` — both endpoints were probed 200 on 2026-09-23; the extension keeps routing chat/completions), vision on (1×1 PNG accepted with a content answer on each model), efforts `low, medium, high, xhigh, max` with `defaultEffort: medium` in the DSH `CATALOG`. The ladder is probed, not guessed: `minimal` → 400 (`expected one of "low"|"medium"|"high"|"xhigh"|"max"`), every listed rung → 200, and effort **differentiates** on a hard problem at `temperature: 0` (reasoning_tokens none → max: astra 408 → 2070, sol 455 → 2047, luna 963–1257 → 2588–3291; the trivial "primes under 200" prompt saturates near 35 rt for every rung, so a hard problem is what proves the knob). `max_tokens: 262144` is accepted gateway-wide; the DSH entries keep the house `maxTokens: 65536` convention every sibling carries, and `docs/models.md` records the extension-derived 131,072.
  - `gpt-6-astra` — intelligence 52.7 (#3 of 67; coding 76.9 #4 of 54), $10 / $50 per 1M (cache read $1), tier `provider` / label `Provider` ("Available on Max and above"), released 2026-09-03.
  - `gpt-6-sol` — intelligence 47.5 (#8 of 67), $2 / $10 (cache read $0.20), tier `pro` / label `Pro` ("Available on Pro and above"), released 2026-09-22.
  - `gpt-6-luna` — intelligence 37.3 (#31 of 67), $0.10 / $0.50 (cache read $0.01; agent-loop effective $0.04/M in; the >272K long-context band doubles but the catalog stores the standard band like every sibling), tier `go` / label `Go/GOAT` ("Available on Go and above"), released 2026-09-22. On the GOAT plan only Luna is servable — Sol/Astra carry their `pro`/`provider` labels so the picker shows the gate. No discount values were invented (the model pages show no deal row).
  - `tests/model-catalog.test.ts` pins `FALLBACK_MODELS` at 80 and `docs/models.md` gains the three rows. README's family table has no OpenAI/GPT row (gpt-5.x was never listed there), so it stays untouched. Sibling DSH plugin ships the same catalog as 0.1.15.

## [0.1.24] - 2026-09-23

### Fixed

- **Contributor-tier Muse Spark loses the `max` effort rung.** `meta/muse-spark-1.3-contributor` and `meta/muse-spark-1.2-contributor` now declare `low, medium, high, xhigh` in `EFFORTS_MAP` instead of adding `max`; the standard-tier ids (`1.1`, `1.2`, `1.3`) keep `max`. Meta's model docs (dev.meta.ai/docs/reasoning) state `"max"` = "Extended reasoning beyond xhigh. Standard-tier muse-spark-1.3 only; not available on Contributor-tier models", and live probing on 2026-09-23 confirms the split: with `temperature: 0` on the same prompt, contributor `max` is statistically indistinguishable from `xhigh` (4 pairs, mean reasoning_tokens 1071 vs 1086 — max wins only 2 of 4), while plain `muse-spark-1.3` shows a real `max` tier (mean 1218 vs 1074, max ≥ xhigh in 3/3 samples plus longer wall-clock). The gateway still answers 200 for contributor `max` (it clamps to xhigh instead of 400 — `none` is the only documented rung it rejects outright), so the rung was accepted but inert: offering it advertised a knob that did nothing. `docs/models.md` contributor rows carry the four-rung ladder. Sibling DSH plugin: `dsh-commandcode-goat-provider` 0.1.14.

## [0.1.23] - 2026-09-23

### Fixed

- **Muse Spark models now offer the Thinking Effort picker.** All five ids in `EFFORTS_MAP` (`meta/muse-spark-1.1`, `-1.2`, `-1.2-contributor`, `-1.3`, `-1.3-contributor`) gain the five-rung ladder `low, medium, high, xhigh, max`, mirroring the DSH `CATALOG` entries shipped as `dsh-commandcode-goat-provider` 0.1.13. The ladder was probed live against `POST https://api.commandcode.ai/provider/v1/chat/completions` on 2026-09-23 with the account key: every rung of `low..max` returns HTTP 200 and `completion_tokens_details.reasoning_tokens` differentiates by effort (`muse-spark-1.3-contributor`: 450 at `low` → 971 at `max`; plain `muse-spark-1.3`: 382 → 502; `1.2`: 626 → 829; `1.2-contributor`: 573 → 690; `1.1`: 406 → 829), while `minimal` and `ultra` are rejected 400 with `expected one of "low"|"medium"|"high"|"xhigh"|"max"` — the gateway enum is exactly this ladder, and `/provider/v1/models` advertises `supported_endpoints: ["/chat/completions", "/responses"]` for all five ids (the extension keeps routing them `openai` via `PROTOCOL_MAP`).
- Before this, the ids were absent from `EFFORTS_MAP`, so `supportsThinking` was false: `provider.ts` dropped every `reasoningEffort` ("Dropping reasoningEffort ... for non-thinking model"), no enum appeared in the model configuration, and the README family row's "Configurable effort" claim did not hold. `commandcode.ai/models` documents the contributor variants as thinking-capable and the upstream honors the parameter — the omission was conservative curation, now replaced by measurement. Same omission is fixed in the sibling DSH plugin (0.1.13), which previously showed no effort picker and dropped the effort on failover (`modelSupportsEffort()` returned false).
- `docs/models.md`: the five Muse Spark rows carry the probed ladder. The contributor rows previously read `minimal,low,medium,high,xhigh` (the ladder a different gateway expects on `/responses`) and the plain rows read `-`; both disagreed with Command Code's own `/provider/v1/chat/completions`.
- `README.md`: the Meta Muse row lists the 1.3 pair alongside the 1.2 pair.
- `tests/model-catalog.test.ts` pins `supportsThinking` and the five-rung ladder for contributor, plain and 1.1 ids.

## [0.1.22] - 2026-09-22

### Added

- Catalog sync with the live provider API, which now serves 77 models; both catalogs gain the four new ids (`claude-opus-5-5`, `xiaomi/mimo-v2.6-pro`, `xiaomi/mimo-v2.6-pro-ultraspeed`, `xiaomi/mimo-v2.6-flash`):
  - `claude-opus-5-5` — "Claude Opus 5.5", 1M context, Vision on (Anthropic's models overview: "All current models support text and image input"), protocol `anthropic` (`claude-*` id → `/provider/v1/messages`), efforts `low, medium, high, xhigh, max` with `defaultEffort: high` following the Opus family entries in this catalog (Anthropic's own default-effort table reads `medium` for Opus 5.5, but `defaultEffort` records Command Code's per-family choice, which the sibling Opus entries carry as `high`). Pricing $4 / $20 per 1M tokens — `commandcode.ai/models/claude-opus-5-5` and Anthropic's pricing table agree on it — with `tier: provider` / `label: Provider` for its "Available on Max and above" plan row. `intelligence` omitted: the model page reads "not yet scored". `maxTokens` stays at the family default 65,536.
  - `xiaomi/mimo-v2.6-pro` — "MiMo V2.6 Pro", 1,048,576 context, Vision on (the model page calls it "flagship multimodal agentic coding"), protocol `openai`, no `efforts` (Xiaomi publishes no reasoning-level list for V2.6 and the V2.5 siblings ship without one, so no effort picker), $0.43 / $0.87 per 1M tokens, `tier: go` / `label: Go/GOAT` ("Available on Go and above"). `intelligence` omitted ("not yet scored").
  - `xiaomi/mimo-v2.6-pro-ultraspeed` — "MiMo V2.6 Pro UltraSpeed", same 1,048,576 context, Vision on (it is billed as the "low-latency serving tier of MiMo V2.6 Pro", i.e. the same model behind a faster tier), protocol `openai`, no `efforts`, $4.35 / $8.70 per 1M tokens, `tier: goat` / `label: GOAT` ("Available on GOAT and above").
  - `xiaomi/mimo-v2.6-flash` — "MiMo V2.6 Flash", 1,048,576 context, Vision on ("efficient multimodal agentic coding"), protocol `openai`, no `efforts`, $0.14 / $0.28 per 1M tokens, `tier: go` / `label: Go/GOAT`.
  - The three MiMo entries use `maxTokens: 65536`, the value every DSH `CATALOG` entry already carries (the extension's `staticInfo` derives 131,072 for a non-Claude/Qwen/Kimi/Gemini id, which `docs/models.md` records in its max-output column). No `discount` values were invented — `commandcode.ai/models` shows no deal row for the four models.
- This release carries the catalog change only: `main` was already at the v0.1.21 tag, with no unreleased commits from the 30-minute idle loop to fold in. The sibling DSH plugin ships the same catalog change as v0.1.11, whose bump additionally folds in its four idle commits (align the `@deepseek-ai/*` peer ranges with harness 0.1.6-alpha.2, declare the type-only `@deepseek-ai` imports with correct peer ranges, migrate the settings card to the `settings.models.provider-card` slot, and reduce the usage badge to the quota-only rendering with the auto-switch UI removed).
- `tests/model-catalog.test.ts` pins `FALLBACK_MODELS` at 77 (was 73), and `docs/models.md` plus the `README.md` family tables carry the four ids — the README's Anthropic row gains `claude-opus-5-5` and its Other Partners row gains the two paid MiMo V2.6 ids (the Xiaomi family had no README row at all until now).

## [0.1.21] - 2026-09-21

### Added

- Catalog sync with the live provider API, which now serves 73 models (`stepfun/Step-5-Preview`, `xai/grok-4.7`); both catalogs gain the two ids. `xai/grok-4.7`: vision on (`commandcode.ai/models/grok-4-7` lists Image input and 500K context, "Available on GOAT and above", $2 / $6 per 1M tokens), efforts `low/medium/high/xhigh` and `defaultEffort: medium` follow the `grok-4.6` sibling, intelligence omitted because the page is not yet scored. `stepfun/Step-5-Preview`: vision on and efforts `low/medium/high` taken from StepFun's official model docs (1M context, text/image input, 64k max output → `maxTokens: 65536`, `reasoning_effort` levels), prices $0.99 / $2.82 converted from the published ¥7 / ¥20 per 1M tokens at the same rate as the `Step-3.7-Flash` entry; Command Code does not publish a page for it yet, so its tier follows the stepfun family (`go`). `PROTOCOL_MAP` carries both ids as `openai`.
- `tests/model-catalog.test.ts` pins `FALLBACK_MODELS` at 73, and `docs/models.md` plus the `README.md` family tables carry the two ids.

## [0.1.20] - 2026-09-19

### Changed

- Catalog sync with the live provider API, which still serves 71 models but swapped one id: `meituan/LongCat-2.0:free` is gone and `meituan/LongCat-2.0` is new. Command Code moved LongCat 2.0 off the free tier onto Go — `commandcode.ai/models/longcat-2-0` lists it at $0.30 / $1.20 per 1M tokens with cache reads at $0.006/M and an effective agent-loop input rate of about $0.09/M, and its plan row reads "Available on Go and above". Both catalogs the drift gate holds together (this repo's `src/constants.ts` and `commandcode-goat-dsh-provider/src/catalog/data.ts`) now carry the paid id; the DSH `CATALOG` entry moves `tier` `free` → `go`, `label` `Free` → `Go/GOAT`, `inputPrice` / `outputPrice` `'free'` → `0.30` / `1.20`, and gains the `intelligence` of 19.7 that the model page publishes.
- Capabilities were re-confirmed against the model page instead of carried over from the free id, and both come out unchanged. Its modality row is **Text input / Text output** with no **Image input**, so the entry stays text-only and out of `VISION_SET`. The **Reasons before answering** marker is present, but the model record's `reasoningEfforts` list is empty, so the entry keeps no `efforts`, stays out of `EFFORTS_MAP` and offers no effort picker — exactly how the free id was treated. The id does not start with `claude-`, so `PROTOCOL_MAP` keeps it on `openai`, which is also the only endpoint the API advertises for it (`/chat/completions`).
- `maxTokens` stays at 65,536 rather than the 131,072 this repo's `staticInfo` derives for a non-Claude/Qwen/Kimi/Gemini id. `GET /provider/v1/models` serves only `id` / `name` / `context_length` and the model page publishes no maximum-output figure, so the conservative value already shipped for this model — and already used by every other `CATALOG` entry (`DEFAULT_MAX_OUTPUT_TOKENS`) — was kept instead of guessed upward. `docs/models.md` continues to record the extension's derived 131,072 in its max-output column.
- `src/provider.ts`: the comment that used `meituan/LongCat-2.0:free` as its example of a real vendor id containing `:` now points at `inclusionai/ling-3.0-flash-sante:free`, which the API still serves. The guard itself is id-agnostic and unchanged.
- This release carries the catalog change only: `main` was already at the v0.1.19 tag, with no unreleased commits from the 30-minute idle loop to fold in. The sibling DSH plugin ships the same catalog change as v0.1.9, whose bump additionally folds in its two idle commits (drop a reasoning effort the failover target cannot use, and default `fallbackToFree` to `false` together with the laguna `maxTokens` correction).
- `tests/model-catalog.test.ts` keeps `FALLBACK_MODELS` pinned at 71 because the swap is one-for-one, and `docs/models.md` plus the `README.md` family table carry the new id. Suite total is 14 suites / 217 tests (unchanged). `bun run check:models` is clean at 71 live / 71 VS Code / 71 DSH models.

## [0.1.19] - 2026-09-18

### Added

- Catalog sync with the live provider API, which gained two ids since v0.1.18 and now serves 71 models. Both are curated into the two catalogs that the drift gate holds together (this repo's `src/constants.ts` and `commandcode-goat-dsh-provider/src/catalog/data.ts`) and land here as `OFFICIAL_MODELS` + `VISION_SET` + `EFFORTS_MAP` + `PROTOCOL_MAP` rows:
  - `z-ai/glm-5.3-flashx` — "GLM-5.3 FlashX", 1M context, Vision, Reasoning `low, high, max`, $0.37 / $1.25 per 1M tokens, Go and above. Z.AI's parameter reference documents `reasoning_effort` for GLM-5.2 and above with the values `low`, `high` and `max`, and its GLM-5.3-Flash/FlashX page lists image input and `reasoning_effort: max` as the recommended setting, so the level set is the vendor's. The default effort follows `z-ai/glm-5.3-flash` (`high`) instead of the vendor default (`max`): `defaultEffort` records Command Code's choice for a family, and the two GLM-5.3 entries stay consistent.
  - `Qwen/Qwen3.8-Omni-Flash` — "Qwen 3.8 Omni Flash", 1M context, Vision, Reasoning `low, medium, xhigh`, $0.15 / $0.47 per 1M tokens, Go and above. Alibaba's Qwen3.8 guidance names `xhigh`, `medium` and `low` as the supported `reasoning_effort` levels with `xhigh` as the vendor default; the entry reuses the Qwen3.8 family's `low, medium, xhigh` and `medium` default already carried by Qwen 3.8 Max / Max 0902 / Flash / 27B, for the same reason.
- This release carries the catalog change only: `main` was already at the v0.1.18 tag, with no unreleased commits from the 30-minute idle loop to fold in.

### Changed

- `GET /provider/v1/models` serves only `id`, `name` and `context_length`, so the capabilities above come from `commandcode.ai/models` (capability labels **Text input, Vision, Reasoning**) and the vendor docs. `commandcode.ai/models` publishes no intelligence index for either model ("not yet scored"), so no `intelligence` value was invented and nothing derived from it moved.
- `maxTokens` stays at the family default the sibling entries already use (65,536). Z.AI documents 128K maximum output for GLM-5.3-Flash/FlashX, so the static value is a conservative under-estimate rather than the vendor ceiling; raising it is a separate change.
- `tests/model-catalog.test.ts` pins `FALLBACK_MODELS` at 71 (was 69), and `docs/models.md` plus the `README.md` family table carry both ids. Suite total is 14 suites / 217 tests (test count unchanged). `bun run check:models` is clean at 71 live / 71 VS Code / 71 DSH models.

## [0.1.18] - 2026-09-17

### Fixed

- `bun run check:models`: `dshCatalogBlock()` no longer reads a helper as catalog code when the DSH `CATALOG` close is written in a shape its pattern does not recognise. The locator took the first column-0 `]` line after the declaration, so an unrecognised close (an indented `  ] as const`, a trailing `// ...`) let the scan run on to the next literal's bracket — the following helper's `]` — and the returned slice then held helper code. The row guards added in 0.1.17 flag any line inside the block that opens a row (`{`) without matching the row regex, so the helper's indented `  {` was reported as `malformed CATALOG row`, naming code that has nothing to do with the catalog's shape; and a row-shaped one-liner down there would have joined the catalog without a word. The rows are indented, so any other column-0 line above the close says the literal ended before it: the scan stops there and throws `cannot locate the close of the CATALOG literal` instead of reading on, while the literal's own column-0 comments (`//`, `/*`, `*`) are stepped over. The live path is unchanged: `bun scripts/check-live-models.ts --json` exits 0 with 69/69/69 models and no drift.
- `tests/check-live-models.test.ts`: the unrecognised-close-plus-helper case now pins the catalog as the culprit (`cannot locate the close of the CATALOG literal`) instead of accepting the `malformed CATALOG row` thrown at the helper, which is what the locator did when it read past the literal; a new case pins a column-0 section divider inside the literal as readable, so the guard that stops the scan cannot reject the literal's own comments. Suite total is 14 suites / 217 tests (was 216 at 0.1.17).

## [0.1.17] - 2026-09-16

### Added

- `tests/check-changelog.test.ts` (10 cases) plus `scripts/changelog.ts`: the release check that `bun run package:vsix` runs first had no test — `scripts/check-changelog.ts` ends in `process.exit`, so importing it from a test runs the gate and kills the Jest worker. The pure half now lives in `scripts/changelog.ts`, the same split as `scripts/model-catalog.ts` for the drift gate: `hasChangelogEntry(version, changelog)` and the new `findChangelogProblems(changelog)`, both taking text, while `check-changelog.ts` keeps the file I/O and the exit codes. The first case pins the heading match against this repo's own `package.json` + `CHANGELOG.md`, so a reflow that stops the regex finding the shipping version fails the suite instead of only failing at package time; the rest cover the accepted spacing variants, the rejections (`0.1.160` / `0.1.1` / `###` heading / inline mention / `[Unreleased]`), the semver build suffix, same-day releases and numbering gaps staying clean, and the three failure messages.
- `tests/check-live-models.test.ts`: 9 cases for the drift gate's parsers — a row a prettier reflow splits across lines on both sides (`OFFICIAL_MODELS` and `CATALOG`), the `CATALOG` block ending at the literal's close rather than at the helpers after it, a bracket closed inside a row not cutting the block short, and the `] as const satisfies T` close. Suite total is 14 suites / 216 tests (was 13 / 197 at 0.1.16).

### Changed

- The drift gate reads the DSH `CATALOG` literal only: `dshCatalogBlock()` slices from `export const CATALOG` to the literal's own close — the only line that opens with `]` at column 0 and holds nothing after it (`]`, `] as const`, `] as const satisfies T`, `];`) — and both `parseDshCatalog` and `parseDshCapabilities` read that slice. The block used to run to the end of the file, so the row guards also covered the helpers after the literal, where an array of multi-line objects threw `malformed CATALOG row` at code with nothing to do with the catalog and a row-shaped one-liner was silently added to it. Sharing the locator also makes `parseDshCapabilities` throw on a missing `CATALOG` instead of returning an empty map. A close the pattern cannot read throws `cannot locate the close of the CATALOG literal` instead of falling back to the end-of-file scan. Latent, not broken: the sibling DSH `src/catalog/data.ts` closes at line 114 with `] as const` and has 0 lines opening with `{` after it.

### Fixed

- `bun run check:models` no longer reads an unreadable catalog row as filler: a line inside the catalog block that opens a row (`[` after trim for `OFFICIAL_MODELS` in `src/constants.ts`, `{` for the DSH `CATALOG`) but does not match the row regex now throws the same `malformed OFFICIAL_MODELS row` / `malformed CATALOG row` error as a row that matches without a name or context window. Reflowing one row into prettier's wrapped shape used to drop it silently — `parseDshCatalog` and `parseDshCapabilities` returned 68 entries where the DSH catalog ships 69, `parseVsceCatalog` 68 where the extension ships 69 — and the gate then reported that row as "NEW — in live API, missing from both catalogs", sending the daily watch after a model already sitting in the file. The parser suite pinned the VS Code side against `FALLBACK_MODELS`, but the gate runs on a timer with no test behind it; only the `entries.size === 0` guard stood between a reflow and a quietly shorter catalog. The live path is unchanged: `bun scripts/check-live-models.ts --json` exits 0 with 69/69/69 models and no drift.
- `bun run package:vsix`'s release check no longer passes a CHANGELOG whose version history is unreadable: `findChangelogProblems` fails the gate (exit 1, same banner style) on a version whose section appears twice — how a rebase that lands two version bumps on the same number goes unnoticed — a version heading below an older one, and a section dated after the newer section above it. Same-day releases and gaps in the numbering stay allowed. The extracted heading match also fixes a latent bug: only dots were escaped before, so a semver build suffix (`0.1.17+build.1`) was read as a quantifier and could never match its own heading.

## [0.1.16] - 2026-09-15

### Added

- `tests/check-live-models.test.ts` (10 cases) plus `scripts/model-catalog.ts`: the drift gate's five catalog parsers (`parseVsceCatalog`, `parseDshCatalog`, `parseVsceCapabilities`, `parseDshCapabilities`, `compareCapabilities`/`compare`) moved out of `check-live-models.ts` into a module that takes source text and throws instead of calling `die()`; `check-live-models.ts` keeps the I/O. Two cases pin the parsers against this extension's own tables — `parseVsceCatalog` must return exactly `FALLBACK_MODELS` and `parseVsceCapabilities` exactly its capabilities — so a prettier reflow of the `OFFICIAL_MODELS` literal, which the regexes read line by line, fails the suite instead of quietly shrinking the catalog. Remaining cases cover the DSH fixture shapes, the loud failures (malformed row, missing block, zero rows) and both comparators. The live path is behaviour-neutral: `--json` output is byte-identical (69 live models, no drift, exit 0).

### Changed

- `scripts/` are now gated: new `tsconfig.scripts.json` (noEmit, module preserve) is chained into `compile`, and `lint` / `lint:fix` / `format` cover `scripts/`, so `check-changelog.ts` (the release check `package:vsix` runs) and the 13.5 KB drift gate can no longer carry type errors or formatting drift unnoticed. The new typecheck immediately caught one real error — `check-live-models.ts` passed `ApiModel[] | { error: string }` to `compare()` because the guard tested `report.ok`, a boolean control-flow analysis cannot map back to the union — fixed by spelling the same test `"error" in live`. The 26 pre-existing prettier errors in `scripts/` are resolved by formatting only (drift-gate `--json` stdout/stderr byte-identical). `.vscodeignore` keeps the new dev config out of the shipped VSIX.
- Jest now sees untested `src` modules: `roots` gained `<rootDir>/src` so `collectCoverageFrom: ["src/**/*.ts"]` reports a module no test imports yet at 0% instead of leaving it out of the file list and the totals (CoverageReporter._addUntestedFiles walks `context.hasteFS`, which `roots` scopes). All 18 `src/**/*.ts` files are already reached through tests, so today's totals are unchanged (77.97 / 61.84 / 82.65 / 78.72).
- `publish.yml` publishes only from a `v*` tag: the Marketplace step is guarded by `if: startsWith(github.ref, 'refs/tags/v')`, so a manual `workflow_dispatch` run now validates the build up to the VSIX and stops, instead of reaching `vsce publish` with a version already on the Marketplace and failing with "already exists". The extension stays VS Code Marketplace only (not Open VSX).
- `scripts/daily-model-watch.sh`: the header states the release policy — releases (version bump + tag push) belong to this daily job and `daily-pi-provider-sync.sh`, the 30-minute idle loop does not publish unless a backlog item says so, and this extension ships to the VS Code Marketplace only. Its agent prompt now also tells the CHANGELOG to cover the unreleased idle commits that ride along in one version ("what this version shipped" stays readable after the fact). The gate itself stays on catalog drift only: the "also release accumulated commits" trigger was reverted, so only the CHANGELOG instruction from that change survives.

### Fixed

- `.vscodeignore`: added `logs/**`, so a locally built VSIX no longer carries `logs/daily-model-watch.log` / `logs/daily-model-watch.service.log` (`vsce ls` 28 → 26 entries; `package:vsix` reports 28 files, was 30, with no `logs/` entry). CI-built artifacts were unaffected — both files are untracked and `*.log` is gitignored, so a CI checkout never has them.
- `.vscodeignore`: dropped the dead exclusion for `images/opencode_go_provider_summary.png`, an image deleted earlier and referenced nowhere else in the working tree; the line excluded nothing. `vsce ls` output is unchanged (26 entries) and all three real images remain in the artifact.

## [0.1.15] - 2026-09-12

### Fixed

- Removed the dead `#!/usr/bin/env node` shebang from `scripts/check-live-models.ts`. No caller ever executes the file directly: its mode is `0600`, so `test -x` fails and `./scripts/check-live-models.ts` exits 126 "Permission denied", verified here. Both real callers go through bun — `package.json`'s `"check:models": "bun scripts/check-live-models.ts"` and `scripts/daily-model-watch.sh:48` (`bun run check:models`) — and the sibling `scripts/check-changelog.ts`, also non-executable and also bun-run, carries no shebang at all. The line was worse than redundant: it named the interpreter this repo cannot usefully use, since node 22.23.2 prints `MODULE_TYPELESS_PACKAGE_JSON` for this ESM-syntax file in a CommonJS package (see 0.1.12). Rewriting it to `#!/usr/bin/env bun` was rejected for the same reason — a non-executable file cannot use a shebang — so the line is deleted rather than retargeted. Verified behaviour-neutral: `bun run check:models --json` emitted byte-identical JSON before and after (exit 0, 69 live models, no drift), and `bun scripts/check-live-models.ts --json --repo <dsh>` still exits 0. No dependency, workflow or runtime behaviour changed.

## [0.1.14] - 2026-09-12

### Fixed

- Docs: the closing note in `docs/model-sync.md` claimed the drift gate "also runs … inside CI's `ci.yml` via `package:vsix`". `package:vsix` is `bun run check-changelog && bun run compile && vsce package`, and no workflow has a `check:models` step — `ci.yml`, `publish.yml` and `pages.yml` were read end to end, and the only callers in the repo are `scripts/daily-model-watch.sh` and a manual `bun run check:models`. The note now states the gate runs only by hand and in the daily watch, which is what the paragraph below it (no scheduled CI-side drift job: the comparison needs the sibling DSH checkout, present only on homepi) already implied. The same sentence's stale "timer below" — section 6 describes the timer above it — is corrected to "above". No script, workflow, or runtime behaviour changed.

## [0.1.13] - 2026-09-12

### Fixed

- CI/Publish: install with `--frozen-lockfile` (`bun install --frozen-lockfile --ignore-scripts`). The committed `bun.lock` is now the only dependency set CI and a tagged release install. With bun 1.4.0 a plain `bun install` resolves from the lockfile when the two files agree — verified here: `bun install --frozen-lockfile --ignore-scripts --dry-run` exits 0 against the committed lock — but when `package.json` and the lockfile drift it exits 0 anyway and rewrites the lock, so CI reported green while installing a set no committed file records. Reproduced in a scratch copy: pinning `prettier` to `3.9.5` against a lock holding `3.9.6` rewrote `bun.lock` (sha256 `c6c8cbb6…` → `2095d3b9…`) under a plain install, while the same drift with the flag exits 1 with `error: lockfile had changes, but lockfile is frozen`. Both workflows now match the sibling repos that already pass the flag (`commandcode-goat-dsh-provider`, `inline-sql-toolkit`, `noteeees`, `nvidia-nim-provider`, `goen-net`). `docs/model-sync.md` section 4 updated to state the frozen install; no lockfile or dependency changed.

## [0.1.12] - 2026-09-12

### Fixed

- Docs: `docs/model-sync.md` section 1 and the usage header of `scripts/check-live-models.ts` now document the drift gate as `bun run check:models` instead of `node scripts/check-live-models.ts`. Node 22.23.2 does run the script (exit 0, verified), but it prints `MODULE_TYPELESS_PACKAGE_JSON` on every invocation because the file is ESM syntax in a package without `"type": "module"` — and that field cannot be added here, since the extension is compiled to CommonJS. Every other caller already uses bun (README, `package.json`, `scripts/daily-model-watch.sh`, CI pin 1.4.0), so the two stale command lines were the only place a reader was pointed at the warning-producing form. No script behaviour or invocation changed.

## [0.1.11] - 2026-09-12

### Changed

- CI/Publish: pin `bun-version` to **1.4.0** (was 1.3.8) so both workflows run the same toolchain as this checkout, matching the DSH sibling repo. `bun.lock` here is still `lockfileVersion: 1` and 1.4.0 keeps it that way (`bun install` and `bun add` both leave it untouched), but a lockfile regenerated from scratch is `lockfileVersion: 2`: `bunx bun@1.3.8` against that file fails `--frozen-lockfile` with `Unknown lockfile version`, and without `--frozen-lockfile` — which is what these workflows run — it merely warns "Ignoring lockfile", re-resolves from `package.json` and rewrites the lock, so the committed pins silently stop being what CI installs. 1.4.0 reads both formats, so the pin no longer depends on nobody regenerating the lockfile. `docs/model-sync.md` section 4 updated to match; no lockfile or dependency changed.

## [0.1.10] - 2026-09-12

### Fixed

- `docs/model-sync.md`: the bun-pin note in section 3 ("pins **bun 1.4.0** … this repo's `bun.lock` is `lockfileVersion: 2`") describes the **DSH sibling repo's** CI, but read from this checkout "this repo" looks like the extension repo, which pins `bun 1.3.8` in `ci.yml`/`publish.yml` against a `lockfileVersion: 1` lockfile. The paragraph now names the DSH repo explicitly, and section 4 states this repo's opposite case. Both sides were verified rather than assumed: the DSH `ci.yml` pins `1.4.0` with a `lockfileVersion: 2` lockfile, and bun 1.4.0 keeps this repo's lockfile at `lockfileVersion: 1` (unchanged after `bun install` and after `bun add`), so no version pin or lockfile changed here.

## [0.1.9] - 2026-09-12

### Changed

- Pages deploy: bump `actions/configure-pages` v5 to v6, `actions/deploy-pages` v4 to v5 and `actions/upload-pages-artifact` v3 to v5 so every step runs on its native Node.js 24 runtime. All three previous pins declared `runs.using: node20` (v3 of `upload-pages-artifact` also pulled in `actions/upload-artifact@v4`), which made GitHub print the "Node.js 20 is deprecated … forced to run on Node.js 24" annotation on every Pages run (e.g. run 34684833813). Inputs used here (`path: docs/`) and the `steps.deployment.outputs.page_url` output are unchanged, and `docs/` contains no dotfiles, so the v4 hidden-file default does not apply.

## [0.1.8] - 2026-09-12

### Changed

- CI: bump `actions/upload-artifact` from v4 to v7 so the coverage upload runs on its native Node.js 24 runtime. v4 declares `runs.using: node20`, which made GitHub print the "Node.js 20 is deprecated … forced to run on Node.js 24" annotation on every CI run (e.g. run 34679722959); v5 still declares `node20`, so only v6+ clears it. No change to the uploaded `coverage-report` artifact or its retention.

## [0.1.7] - 2026-09-12

### Changed

- Daily model watch: document `logs/daily-model-watch.service.log` as the canonical service log. The unit writes stdout/stderr there with `StandardOutput/StandardError=append:`, which bypasses journald — `journalctl --user -u daily-model-watch.service` records only the unit start/finish lines — so the stale "journald is canonical" comment in the unit and the playbook now match reality. No runtime behaviour change.

## [0.1.6] - 2026-09-12

### Changed

- Daily model watch (`scripts/daily-model-watch.sh`): mirror the `~/bin/dsh-headless-route` decision to the service log (`logs/daily-model-watch.service.log`) as a single `model route:` line. Previously that reasoning only reached the transcript, so the service log alone could not tell whether a daily run booted on Go or goat.

## [0.1.5] - 2026-09-10

### Added

- Sync catalog with live API (`GET /provider/v1/models`, 69 models): add `deepseek/deepseek-v4.1-flash` (DeepSeek V4.1 Flash): 1M context, OpenAI protocol, OpenAI reasoning efforts `high`/`max`, vision-capable. Previously it appeared as an unknown model with all capabilities disabled.

## [0.1.4] - 2026-09-10

### Added

- Sync catalog with live API (`GET /provider/v1/models`, 68 models): add `inclusionai/ling-3.0-flash-sante:free` (Ling 3.0 Flash Sante, 262,144 context, text-only free tier). Previously it appeared as an unknown model with all capabilities disabled.

### Fixed

- Align static context windows with the live API (12 models: Step 3.5 Flash, Kimi K2.5/K2.6/K2.7 Code HighSpeed, GLM-5/5.1, MiniMax M2.5/M2.7, Qwen 3.6 Plus/Max Preview, Inkling, Tencent Hy3).
- Refresh display names to match the live API: DeepSeek V4 Pro/Flash `(latest)`, DeepSeek V4 Flash Vision `(exp)`, Kimi K2.7 Code HighSpeed, Tencent Hy3, Laguna S 2.1.

## [0.1.3] - 2026-09-05

### Added

- Sync catalog with live API (`GET /provider/v1/models`, 67 models): add `claude-fable-5-1`, `google/gemini-3.8-flash`, `meta/muse-spark-1.3` (+contributor), `Qwen/Qwen3.8-Max-0902`, `meituan/LongCat-2.0:free`. Previously they appeared as unknown models with all capabilities disabled.
- Guard `resolveApiModelId` so registered ids containing `:` (e.g. `meituan/LongCat-2.0:free`) are sent verbatim instead of being truncated as IDE variant suffixes.

### Removed

- Drop `minimax/minimax-m2.7-free` and `minimax/minimax-m3-free` from the static catalog (no longer served by the API).

## [0.1.2] - 2026-08-31

### Added

- Add `deepseek/deepseek-v4-flash-fast` (DeepSeek V4 Flash Fast): low-latency V4 Flash deployment, 1M context, OpenAI protocol, OpenAI reasoning efforts `high`/`max`, text-only. Available on Go plan and above (per [Command Code model page](https://commandcode.ai/models/deepseek-v4-flash-fast)).

## [0.1.1] - 2026-08-30

### Fixed

- Sync model catalog from DSH (`commandcode.ai/docs` via `pnpm generate:knowledge`): replace regex-guessed vision/thinking/efforts with explicit `VISION_SET`/`EFFORTS_MAP`/`PROTOCOL_MAP`. Fixes MiniMax duplicate display name (now `MiniMax M3 (Free)`), corrects thinking levels per docs (Claude/Gemini/GPT with proper efforts, Kimi-K3/MiniMax/Step without thinking, GLM escaping bug fixed).
- Regenerate `docs/models.md` from authoritative catalog.

## [0.1.0] - 2026-08-30

### Added

- Initial release of Command Code GOAT Provider for GitHub Copilot in VS Code.
- Language model provider registration under vendor `commandcode-goat`.
- Official Command Code model catalog support (62 models including Claude 5/4.6/4.8/4.7, DeepSeek V4, Kimi K3/K2.7, GLM 5.3, MiniMax M3, Qwen 3.8/3.7, Gemini, Step, Tencent Hy4, Grok 4.6/4.5, Muse Spark, and more).
- Dual protocol routing: Anthropic `/messages` format for Claude models and OpenAI `/chat/completions` format for other models.
- SecretStorage integration for `commandcode-goat.apiKey` with on-change model refresh.
- Dynamic model discovery from `GET https://api.commandcode.ai/provider/v1/models` with static capability fallback and non-selectable fallback for unknown models.
- Zero Data Retention (ZDR) mode toggle (`commandcode-goat.enableZdr`) sending `x-cmd-zdr: 1`.
- Comprehensive error normalization for standard and `success: false` envelopes, 401/403 API key guidance, 422 ZDR rejection, 429 rate limits, 400 token limits, and 5xx failures.
- Native streaming response parts, fragmented tool call assembly, thinking/reasoning parts, and silent retry logic for empty or truncated responses.
- Management commands: `Command Code GOAT: Manage API Key`, `Command Code GOAT: Toggle Debug Logging`, `Command Code GOAT: Open Debug Log`.

# Model Catalog Sync & Release Playbook

Procedure for the daily model-catalog sync (`scripts/daily-model-watch.sh` → DSH headless agent run)
and for the same work done by hand. Both catalogs must stay in sync:

| Repo | File | Role |
|---|---|---|
| `~/projects/commandcode-goat-dsh-provider` | `src/catalog/data.ts` (`CATALOG`) | Upstream truth: id, name, contextWindow, maxTokens, protocol, modalities, efforts, pricing, tier |
| `~/projects/commandcode-goat-provider` (this repo) | `src/constants.ts` (`OFFICIAL_MODELS`, `VISION_SET`, `EFFORTS_MAP`, `PROTOCOL_MAP`) | VS Code extension: derived capability tables + `docs/models.md` |

`GET https://api.commandcode.ai/provider/v1/models` (public, no auth) is the discovery source, but it
returns **only** `id` / `name` / `context_length`. Capabilities, protocol and pricing are not served
by the API — they must be curated from `commandcode.ai/models` and the provider docs.

## 1. Detect drift (no LLM)

```bash
cd ~/projects/commandcode-goat-provider
node scripts/check-live-models.ts          # exit 0 = clean, 2 = drift, 1 = API/catalog error
```

Sections worth acting on:

- **NEW** — served by the API but absent from the VS Code catalog → section 2.
- **CHANGED** — context window or display name differs from the API (reported per side: `VS Code` / `DSH`) →
  align the static value with the API.
- **MISSING FROM DSH** — present in the extension but absent from the DSH `CATALOG` → add it to the DSH entry too.
- **REMOVED** — in the extension catalog but no longer served by the API → drop it from the static catalog
  (do not keep dead ids; `minimax/minimax-m2.7-free` and `minimax/minimax-m3-free` were removed this way).
- **CAPABILITY** — the extension's `VISION_SET` / `EFFORTS_MAP` / `PROTOCOL_MAP` disagree with the DSH
  `CATALOG` for the same id. The two repositories are separate on purpose (different hosts, different
  consumers), so the capability data is copied rather than imported; this section is the machine check that
  keeps the copy honest. It compares `modalities`/`efforts`/`protocol` against vision/efforts/protocol and
  must stay empty.

A clean run across all five sections is the expected steady state: two independent repositories consuming one
live API, with no drift between them.

## 2. Curate a new model

Collect from `https://commandcode.ai/models` (and `/docs`) before editing; fall back to the provider docs
when the listing is ambiguous:

| Field | Source / rule |
|---|---|
| `protocol` | `claude-*` ids → `anthropic` (`/provider/v1/messages`); everything else → `openai` |
| `modalities` (Vision) | `VISION_SET` in the extension + `modalities` in the DSH entry |
| `efforts` (Thinking) | Vendor reasoning levels, e.g. DeepSeek → `high, max`; drop the model from Thinking entirely when unknown |
| `maxTokens` | Family default used in `staticInfo` (Claude/Qwen/Kimi/Gemini → 65536, others → 131072) unless known otherwise |
| `name` / `contextWindow` | Authoritative value from the API response |
| pricing / tier / intelligence | DSH `CATALOG` only; skip when not published — never invent numbers |

If a capability cannot be confirmed, leave it out (text-only, no reasoning UI) and state the limitation in
the final report and commit message. Shipping a wrong capability flag is worse than shipping none.
Keep vendor-id quirks in mind: ids containing `:` are sent verbatim
(`resolveApiModelId` handles this — do not "fix" it).

## 3. Update the DSH plugin first

```bash
cd ~/projects/commandcode-goat-dsh-provider
# edit src/catalog/data.ts (single source of truth; derived maps compute from it)
bun run test && bun run build          # the gate that must be green
bun run typecheck                      # optional: known pre-existing ToolCallId errors (unrelated to catalogs)
```

Bump `version` in `package.json` (patch) and commit, e.g.
`feat(catalog): add <id> (Command Code)`. Push to `main`.
The DSH profile loads this checkout through a symlink
(`~/.dsh/profiles/node_modules/dsh-commandcode-goat-provider`), so `bun run build` is the deploy step —
a restart of `dsh web` picks it up; no npm publish exists for this package.

## 4. Then the VS Code extension

```bash
cd ~/projects/commandcode-goat-provider
# edit src/constants.ts (OFFICIAL_MODELS + VISION_SET / EFFORTS_MAP / PROTOCOL_MAP), tests/model-catalog.test.ts,
# docs/models.md, README.md model table
bun run lint && bun run test -- --runInBand && bun run compile
```

Requirements before tagging:

1. Bump `version` in `package.json` (patch).
2. Add a `## [x.y.z] - YYYY-MM-DD` entry to `CHANGELOG.md` — `bun run check-changelog` fails the VSIX build without it.
3. Commit (`feat: add <model> to catalog (vX.Y.Z)`) and push `main`.

Publish is **tag-driven**; do not run `vsce publish` locally (there is no PAT on this machine):

```bash
git tag -a vX.Y.Z -m "vX.Y.Z: <summary>" && git push origin main --follow-tags   # or: git push origin vX.Y.Z
gh run list --limit 5                     # wait for CI + Publish
```

`publish.yml` publishes to the VS Code Marketplace with the `VSCE_PAT` GitHub secret.
**The tag version must exactly match `package.json`** — a mismatch ships the wrong version or fails.
GitHub Pages redeploys the docs site from `main` automatically.

## 5. Verify and report

```bash
gh run list --limit 5
gh run view <run-id> --log-failed          # only when a run failed
```

Done means: CI green **and** the `Publish` run for the pushed tag green. If publish fails, fix the cause,
bump the patch version again (a version already accepted by the Marketplace cannot be reused) and repeat
from step 4. Never leave a broken build pushed without reporting it.

## 6. Automated daily run

`daily-model-watch.timer` (systemd user unit) runs `scripts/daily-model-watch.sh` daily:

1. `check-live-models.ts` gates for free; with no drift the run ends in seconds and no LLM quota is spent.
2. On drift, a DSH headless agent session is started with this playbook as its prompt
   (`dsh --profile headless`), which performs sections 2–5 autonomously.
3. Transcripts: `logs/daily-model-watch.log` (gitignored) plus the persisted DSH session, viewable in the Web GUI.

```bash
systemctl --user list-timers daily-model-watch.timer
systemctl --user start daily-model-watch.service     # manual run
scripts/daily-model-watch.sh --dry-run --force       # show the agent prompt without running it
```

Related: the gate also runs by hand (`bun run check:models`) and inside CI's `ci.yml` via `package:vsix`.
There is deliberately **no** scheduled CI-side drift job: the comparison needs the sibling DSH checkout,
which only exists on homepi, and the timer below already covers it (`Persistent=true` catches up after a
host that was off at the scheduled time).

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
bun run check:models                       # exit 0 = clean, 2 = drift, 1 = API/catalog error
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

The **DSH repo's** CI (`.github/workflows/ci.yml` — a different file from this extension repo's, see
section 4) runs install → OSV scan → lint → test → build on every push/PR and pins **bun 1.4.0**: that
checkout's `bun.lock` was created as `lockfileVersion: 2`, which bun 1.3.x cannot parse, so a lockfile
rewritten by an older bun breaks the build with `Unknown lockfile version` before any test runs.

Bump `version` in `package.json` (patch) and commit, e.g.
`feat(catalog): add <id> (Command Code)`. Push to `main`.
The DSH profile loads this checkout through a symlink
(`~/.dsh/profiles/node_modules/dsh-commandcode-goat-provider`), so `bun run build` is the deploy step —
a `dsh web` restart picks it up; no npm publish exists for this package.
The restart always goes through the supervisor, never through a hand-started process:
`scripts/restart-dsh-web.sh` runs `sudo -n systemctl restart dsh-web.service` on homepi and
`launchctl kickstart -k gui/$UID/com.dsh.web` on the Mac. One `bun run build` deploys both hosts because
`~/projects` is Mutagen-synced (`/Users/hidenobunagai/projects` ↔ `pi@homepi:/home/pi/projects`); only the
restart differs per host, and the Mac side is covered by the launchd job `com.dsh.plugin-watch`.

## 4. Then the VS Code extension

```bash
cd ~/projects/commandcode-goat-provider
# edit src/constants.ts (OFFICIAL_MODELS + VISION_SET / EFFORTS_MAP / PROTOCOL_MAP), tests/model-catalog.test.ts,
# docs/models.md, README.md model table
bun run lint && bun run test -- --runInBand && bun run compile
```

`ci.yml` and `publish.yml` pin **bun 1.4.0** and install with **`--frozen-lockfile`**, the same as
section 3 and the local toolchain: the committed `bun.lock` is the only dependency set CI and a release
build install, so a `package.json`/lockfile drift fails the run instead of being re-resolved silently.
This repo's `bun.lock` is still `lockfileVersion: 1` (bun 1.4.0 preserves the existing format even when it
rewrites, `bun add` included), but a lockfile regenerated from scratch is `lockfileVersion: 2`, and bun
1.3.8 cannot read that: with `--frozen-lockfile` it dies with `Unknown lockfile version`, and without the
flag it only warns "Ignoring lockfile" and re-resolves from `package.json`. 1.4.0 reads both formats, so
the pin no longer depends on nobody regenerating the lockfile.

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
   (`dsh --profile headless`), which performs sections 2–5 autonomously. Headless has no
   usage-failover, so the wrapper asks `~/bin/dsh-headless-route` for a `--patch` overlay first: when Go is
   over 80% of a quota window and goat has room, the run boots on the goat provider instead. The decision is
   written to both the transcript and the service log (`logs/daily-model-watch.service.log`, one
   `model route:` line), so the daily outcome can be traced without opening the transcript.
3. When that run exits 0, the wrapper restarts `dsh web` through the supervisor
   (`scripts/restart-dsh-web.sh --wait 600`) so homepi serves the rebuilt plugin. The script no-ops when the
   running server is already newer than `lib/`, and defers while a session was written within the last 120s
   (the agent's own session log stays busy until the run ends, which is what `--wait` is for). The agent
   itself must not restart the server.
4. Logs: `logs/daily-model-watch.service.log` is the **canonical** service log. The unit
   (`~/.config/systemd/user/daily-model-watch.service`, not versioned in this repo) sends stdout/stderr
   straight to it with `StandardOutput=append:` / `StandardError=append:` rather than to journald, so
   `journalctl --user -u daily-model-watch.service` holds only systemd's `Starting`/`Finished` lines —
   read the file (or `tail -f` it) for the gate output, the `model route:` line and the agent status.
   The file is not rotated; a normal run appends a handful of lines. The full agent transcript is
   `logs/daily-model-watch.log` (gitignored) plus the persisted DSH session, viewable in the Web GUI.

The Mac is not part of the daily run: `~/projects` reaches it by Mutagen, and its launchd job
`com.dsh.plugin-watch` (`~/Library/LaunchAgents/com.dsh.plugin-watch.plist`) restarts the Mac server on
`lib/` changes, with a 10-minute interval as a fallback. Both hosts run the same `restart-dsh-web.sh`.

```bash
systemctl --user list-timers daily-model-watch.timer
systemctl --user start daily-model-watch.service     # manual run
scripts/daily-model-watch.sh --dry-run --force       # show the agent prompt without running it
```

Related: the gate also runs by hand (`bun run check:models`) and inside CI's `ci.yml` via `package:vsix`.
There is deliberately **no** scheduled CI-side drift job: the comparison needs the sibling DSH checkout,
which only exists on homepi, and the timer below already covers it (`Persistent=true` catches up after a
host that was off at the scheduled time).
